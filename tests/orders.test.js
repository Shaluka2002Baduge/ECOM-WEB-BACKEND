const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/db');
const orderService = require('../src/modules/orders/orderService');
const { AppError } = require('../src/middleware/errorAspect');

describe('Order State Machine & ACID Transaction Integrity', () => {
  const secret = process.env.JWT_SECRET || 'ralahami_super_secret_jwt_key_2026_change_in_production';

  const mockCustomerToken = jwt.sign(
    { id: '11111111-1111-1111-1111-111111111111', email: 'cust@ralahami.com', role: 'CUSTOMER' },
    secret
  );

  const mockStaffToken = jwt.sign(
    { id: '22222222-2222-2222-2222-222222222222', email: 'staff@ralahami.com', role: 'KITCHEN_STAFF' },
    secret
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('State Machine Transition Matrix Integrity', () => {
    test('Allows legal state progression: PLACED -> CONFIRMED', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 101, status: 'PLACED' }] }) // current status lookup
        .mockResolvedValueOnce({ rows: [{ id: 101, status: 'CONFIRMED' }] }); // update execution

      const result = await orderService.transitionOrderStatus(101, 'CONFIRMED');
      expect(result.status).toBe('CONFIRMED');
    });

    test('Allows legal cancellation: PLACED -> CANCELLED', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 102, status: 'PLACED' }] })
        .mockResolvedValueOnce({ rows: [{ id: 102, status: 'CANCELLED' }] });

      const result = await orderService.transitionOrderStatus(102, 'CANCELLED');
      expect(result.status).toBe('CANCELLED');
    });

    test('Strictly forbids illegal transition skipping steps: PLACED -> COMPLETED', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [{ id: 103, status: 'PLACED' }],
      });

      await expect(
        orderService.transitionOrderStatus(103, 'COMPLETED')
      ).rejects.toThrow(/Invalid state transition/i);
    });

    test('Enforces terminal state integrity: COMPLETED cannot transition to any state', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [{ id: 104, status: 'COMPLETED' }],
      });

      await expect(
        orderService.transitionOrderStatus(104, 'PLACED')
      ).rejects.toThrow(/Invalid state transition/i);
    });
  });

  describe('ACID Transaction Order Creation', () => {
    test('Calculates total price from database and commits transaction on success', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };

      jest.spyOn(db, 'getClient').mockResolvedValueOnce(mockClient);

      // Mock sequence of queries inside transaction:
      // 1. BEGIN
      // 2. Fetch menu items
      // 3. Insert order
      // 4. Insert order_items
      // 5. COMMIT
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            { id: 1, name: 'Dish A', price: '10.00', is_available: true },
            { id: 2, name: 'Dish B', price: '5.50', is_available: true },
          ],
        }) // menu items lookup
        .mockResolvedValueOnce({
          rows: [
            {
              id: 50,
              user_id: '11111111-1111-1111-1111-111111111111',
              status: 'PLACED',
              total_amount: '25.50',
            },
          ],
        }) // order insert
        .mockResolvedValueOnce({}) // line item 1
        .mockResolvedValueOnce({}) // line item 2
        .mockResolvedValueOnce({}); // COMMIT

      const orderPayload = {
        items: [
          { menuItemId: 1, quantity: 2 }, // 2 * 10.00 = 20.00
          { menuItemId: 2, quantity: 1 }, // 1 * 5.50 = 5.50 -> Total = 25.50
        ],
        orderType: 'DINE_IN',
      };

      const created = await orderService.createOrder('11111111-1111-1111-1111-111111111111', orderPayload);

      expect(created.id).toBe(50);
      expect(created.total_amount).toBe('25.50');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('Rolls back transaction if a dish is marked unavailable', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };

      jest.spyOn(db, 'getClient').mockResolvedValueOnce(mockClient);

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 99, name: 'Sold-out Dish', price: '12.00', is_available: false }],
        }) // unavailable item
        .mockResolvedValueOnce({}); // ROLLBACK

      const orderPayload = {
        items: [{ menuItemId: 99, quantity: 1 }],
      };

      await expect(
        orderService.createOrder('11111111-1111-1111-1111-111111111111', orderPayload)
      ).rejects.toThrow(/currently unavailable/i);

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('HTTP Route Guards & Role Access', () => {
    test('Denies status transition to unauthenticated users with 401', async () => {
      const response = await request(app)
        .patch('/api/orders/1/status')
        .send({ status: 'CONFIRMED' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    test('Denies status transition to standard customers with 403 Forbidden', async () => {
      const response = await request(app)
        .patch('/api/orders/1/status')
        .set('Authorization', `Bearer ${mockCustomerToken}`)
        .send({ status: 'CONFIRMED' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/Forbidden/i);
      expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    test('Allows authorized Kitchen Staff to transition status', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'CONFIRMED' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'PREPARING' }] });

      const response = await request(app)
        .patch('/api/orders/1/status')
        .set('Authorization', `Bearer ${mockStaffToken}`)
        .send({ status: 'PREPARING' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('PREPARING');
    });
  });
});
