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

    test('Accepts flexible item ID fields (id, menu_item_id, itemId) seamlessly', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };

      jest.spyOn(db, 'getClient').mockResolvedValueOnce(mockClient);

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            { id: 5, name: 'Hoppers Trio', price: '400.00', is_available: true },
            { id: 8, name: 'Faluda Royal', price: '350.00', is_available: true },
          ],
        }) // menu items lookup
        .mockResolvedValueOnce({
          rows: [
            {
              id: 77,
              user_id: null,
              status: 'PLACED',
              total_amount: '750.00',
              order_number: 'RAALAHAMI-77',
            },
          ],
        }) // order insert
        .mockResolvedValueOnce({}) // line item 1
        .mockResolvedValueOnce({}) // line item 2
        .mockResolvedValueOnce({}); // COMMIT

      // Item 1 uses `id`, Item 2 uses `itemId`
      const orderPayload = {
        items: [
          { id: 5, quantity: 1 },
          { itemId: 8, qty: 1 },
        ],
        orderType: 'DELIVERY',
      };

      const created = await orderService.createOrder(null, orderPayload);

      expect(created.id).toBe(77);
      expect(created.items).toHaveLength(2);
      expect(created.items[0].menuItemId).toBe(5);
      expect(created.items[1].menuItemId).toBe(8);
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    test('Throws descriptive 400 error when an item in cart is missing an ID', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };

      jest.spyOn(db, 'getClient').mockResolvedValueOnce(mockClient);
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const orderPayload = {
        items: [
          { name: 'Mystery Dish', quantity: 2 }, // Missing id, itemId, menuItemId
        ],
      };

      await expect(
        orderService.createOrder(null, orderPayload)
      ).rejects.toThrow(/Invalid item in cart. Missing item ID./i);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ORDER ERROR] Received item without ID:'),
        expect.anything()
      );

      consoleErrorSpy.mockRestore();
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

  describe('Flexible Order Lookup by ID and Alphanumeric Order Number', () => {
    test('Successfully retrieves order by alphanumeric order number (e.g. RAALAHAMI-515712)', async () => {
      // Mock order query and items query
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({
          rows: [
            {
              id: 99,
              order_number: 'RAALAHAMI-515712',
              user_id: null,
              status: 'PLACED',
              total_amount: '2500.00',
              order_type: 'DELIVERY',
              customer_name: 'Royal Patron',
              customer_email: 'patron@example.com',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              menu_item_id: 10,
              name: 'Royal Biryani',
              quantity: 2,
              unit_price: '1250.00',
              special_instructions: 'Extra raita',
              line_total: '2500.00',
            },
          ],
        });

      const response = await request(app).get('/api/orders/RAALAHAMI-515712');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.order_number).toBe('RAALAHAMI-515712');
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].name).toBe('Royal Biryani');
    });

    test('Successfully retrieves order by numeric ID (e.g. 101)', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({
          rows: [
            {
              id: 101,
              order_number: 'RAALAHAMI-101',
              user_id: null,
              status: 'CONFIRMED',
              total_amount: '1800.00',
              order_type: 'DINE_IN',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 2,
              menu_item_id: 12,
              name: 'Lamprais',
              quantity: 1,
              unit_price: '1800.00',
              line_total: '1800.00',
            },
          ],
        });

      const response = await request(app).get('/api/orders/101');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(101);
      expect(response.body.data.items).toHaveLength(1);
    });

    test('Returns 404 when order is not found by identifier', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/orders/RAALAHAMI-NONEXISTENT');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/Order not found/i);
    });
  });

  describe('Dine-In Order & Table Status Integration', () => {
    test('Dine-In checkout creates live reservation entry with status CONFIRMED', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'Clay Pot Rice', price: '1200.00', is_available: true }],
        }) // menu query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 555,
              order_number: 'RAALAHAMI-555000',
              status: 'PLACED',
              total_amount: '1200.00',
              order_type: 'DINE_IN',
              recipient_name: 'Dr. Senaka Perera',
            },
          ],
        }) // order insert
        .mockResolvedValueOnce({}) // order item insert
        .mockResolvedValueOnce({}); // COMMIT

      jest.spyOn(db, 'getClient').mockResolvedValueOnce(mockClient);

      // db.query for conflict check (table lookup, conflict query) and reservation insert (table lookup, insert)
      const dbQuerySpy = jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 4, hall_name: 'Royal Dining Hall', table_number: 'Table 1', status: 'AVAILABLE' }] }) // conflict table lookup
        .mockResolvedValueOnce({ rows: [] }) // conflict query (no conflict)
        .mockResolvedValueOnce({ rows: [{ id: 4, hall_name: 'Royal Dining Hall', table_number: 'Table 1' }] }) // reservation table lookup
        .mockResolvedValueOnce({
          rows: [
            {
              id: 99,
              user_id: null,
              table_id: 4,
              patron_name: 'Dr. Senaka Perera',
              phone: '+94771234567',
              party_size: 4,
              reservation_time: '2026-10-01T19:30:00.000Z',
              status: 'CONFIRMED',
              order_id: 555,
            },
          ],
        }); // reservation insert

      const response = await request(app)
        .post('/api/orders')
        .send({
          fulfillment_type: 'Dine-In',
          recipientName: 'Dr. Senaka Perera',
          phone: '+94771234567',
          party_size: 4,
          reservation_time: '2026-10-01T19:30:00.000Z',
          items: [{ id: 1, quantity: 1 }],
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(555);
      expect(response.body.data.reservation).toBeDefined();
      expect(response.body.data.reservation.status).toBe('CONFIRMED');
      expect(response.body.data.reservation.patron_name).toBe('Dr. Senaka Perera');
    });

    test('PUT /api/reservations/tables/:id toggles table status', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 2, table_number: 'T-02', seating_capacity: 4 }] }) // table check
        .mockResolvedValueOnce({
          rows: [
            {
              id: 2,
              table_number: 'T-02',
              seating_capacity: 4,
              location_description: 'Window View',
              is_active: false,
              status: 'OCCUPIED',
            },
          ],
        }); // update query

      const response = await request(app)
        .put('/api/reservations/tables/2')
        .send({ status: 'OCCUPIED' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('OCCUPIED');
    });
  });
});
