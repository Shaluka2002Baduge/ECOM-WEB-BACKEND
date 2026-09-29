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

  const mockAdminToken = jwt.sign(
    { id: '33333333-3333-3333-3333-333333333333', email: 'admin@ralahami.lk', role: 'ADMIN' },
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

    test('GET /api/orders/track/:identifier exposes tracking details with formatted fulfillment_type', async () => {
      const mockUpdatedAt = new Date().toISOString();
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({
          rows: [
            {
              id: 777,
              order_number: 'RAALAHAMI-777888',
              user_id: null,
              status: 'PREPARING',
              total_amount: '3500.00',
              order_type: 'DINE_IN',
              recipient_name: 'Noble Guest',
              updated_at: mockUpdatedAt,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              menu_item_id: 5,
              name: 'Jaffna Crab Curry',
              quantity: 1,
              unit_price: '3500.00',
              special_instructions: 'Medium spicy',
              line_total: '3500.00',
            },
          ],
        });

      const response = await request(app).get('/api/orders/track/RAALAHAMI-777888');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        id: 777,
        order_number: 'RAALAHAMI-777888',
        fulfillment_type: 'Dine-In',
        status: 'PREPARING',
        total_amount: '3500.00',
        updated_at: mockUpdatedAt,
      });
      expect(response.body.data.items).toHaveLength(1);
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

  describe('Unified Admin Order Status API: PATCH /api/admin/orders/:id/status', () => {
    test('Denies access to non-admin users with 403 Forbidden', async () => {
      const response = await request(app)
        .patch('/api/admin/orders/1/status')
        .set('Authorization', `Bearer ${mockCustomerToken}`)
        .send({ status: 'COOKING' });

      expect(response.status).toBe(403);
    });

    test('Allows Admin to update Delivery order to KITCHEN_CONFIRMED, COOKING, OUT_FOR_DELIVERY, DELIVERED', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 50, order_number: 'RAALAHAMI-50', order_type: 'DELIVERY', status: 'PENDING' }] })
        .mockResolvedValueOnce({ rows: [{ id: 50, order_number: 'RAALAHAMI-50', order_type: 'DELIVERY', status: 'COOKING' }] });

      const response = await request(app)
        .patch('/api/admin/orders/50/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'COOKING' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('COOKING');
      expect(response.body.data.fulfillment_type).toBe('Home Delivery');
    });

    test('Allows Admin to update Delivery order with natural text "Out for delivery"', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 51, order_number: 'RAALAHAMI-51', order_type: 'DELIVERY', status: 'COOKING' }] })
        .mockResolvedValueOnce({ rows: [{ id: 51, order_number: 'RAALAHAMI-51', order_type: 'DELIVERY', status: 'OUT_FOR_DELIVERY' }] });

      const response = await request(app)
        .patch('/api/admin/orders/51/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'Out for delivery' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('OUT_FOR_DELIVERY');
      expect(response.body.data.fulfillment_type).toBe('Home Delivery');
    });

    test('Allows Admin to update Takeaway order to READY_FOR_PICKUP and COMPLETED', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 60, order_number: 'RAALAHAMI-60', order_type: 'TAKEAWAY', status: 'PREPARING' }] })
        .mockResolvedValueOnce({ rows: [{ id: 60, order_number: 'RAALAHAMI-60', order_type: 'TAKEAWAY', status: 'READY_FOR_PICKUP' }] });

      const response = await request(app)
        .patch('/api/admin/orders/60/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'READY_FOR_PICKUP' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('READY_FOR_PICKUP');
      expect(response.body.data.fulfillment_type).toBe('Takeaway');
    });

    test('Allows Admin to update Dine-In order to PREPARING', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 70, order_number: 'RAALAHAMI-70', order_type: 'DINE_IN', status: 'CONFIRMED' }] })
        .mockResolvedValueOnce({ rows: [{ id: 70, order_number: 'RAALAHAMI-70', order_type: 'DINE_IN', status: 'PREPARING' }] });

      const response = await request(app)
        .patch('/api/admin/orders/70/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'PREPARING' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('PREPARING');
      expect(response.body.data.fulfillment_type).toBe('Dine-In');
    });

    test('Allows Admin to update Dine-In order to SERVED and marks COMPLETED', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 71, order_number: 'RAALAHAMI-71', order_type: 'DINE_IN', status: 'PREPARING' }] })
        .mockResolvedValueOnce({ rows: [{ id: 71, order_number: 'RAALAHAMI-71', order_type: 'DINE_IN', status: 'COMPLETED' }] })
        .mockResolvedValueOnce({ rows: [{ id: 10, table_id: 2, hall_name: 'Main', table_number: 'T-2' }] }) // update reservations
        .mockResolvedValueOnce({ rows: [] }); // update tables

      const response = await request(app)
        .patch('/api/admin/orders/71/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'SERVED' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('COMPLETED');
      expect(response.body.data.fulfillment_type).toBe('Dine-In');
    });

    test('Allows Admin to update Dine-In order to SEATED and COMPLETED', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 70, order_number: 'RAALAHAMI-70', order_type: 'DINE_IN', status: 'CONFIRMED' }] })
        .mockResolvedValueOnce({ rows: [{ id: 70, order_number: 'RAALAHAMI-70', order_type: 'DINE_IN', status: 'SEATED' }] });

      const response = await request(app)
        .patch('/api/admin/orders/70/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'SEATED' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('SEATED');
      expect(response.body.data.fulfillment_type).toBe('Dine-In');
    });

    test('Permissively coerces mismatched status for fulfillment type (Takeaway OUT_FOR_DELIVERY -> READY_FOR_PICKUP)', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 80, order_number: 'RAALAHAMI-80', order_type: 'TAKEAWAY', status: 'PREPARING' }] })
        .mockResolvedValueOnce({ rows: [{ id: 80, order_number: 'RAALAHAMI-80', order_type: 'TAKEAWAY', status: 'READY_FOR_PICKUP' }] });

      const response = await request(app)
        .patch('/api/admin/orders/80/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'OUT_FOR_DELIVERY' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('READY_FOR_PICKUP');
      expect(response.body.data.fulfillment_type).toBe('Takeaway');
    });

    test('Permissively coerces Takeaway COOKING -> PREPARING and DELIVERED -> COMPLETED', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 81, order_number: 'RAALAHAMI-81', order_type: 'TAKEAWAY', status: 'PENDING' }] })
        .mockResolvedValueOnce({ rows: [{ id: 81, order_number: 'RAALAHAMI-81', order_type: 'TAKEAWAY', status: 'PREPARING' }] });

      const res1 = await request(app)
        .patch('/api/admin/orders/81/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'COOKING' });

      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe('PREPARING');

      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 81, order_number: 'RAALAHAMI-81', order_type: 'TAKEAWAY', status: 'READY_FOR_PICKUP' }] })
        .mockResolvedValueOnce({ rows: [{ id: 81, order_number: 'RAALAHAMI-81', order_type: 'TAKEAWAY', status: 'COMPLETED' }] });

      const res2 = await request(app)
        .patch('/api/admin/orders/81/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'DELIVERED' });

      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe('COMPLETED');
    });

    test('Permissively coerces Home Delivery PREPARING -> COOKING and Dine-In COOKING -> PREPARING', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 82, order_number: 'RAALAHAMI-82', order_type: 'DELIVERY', status: 'PENDING' }] })
        .mockResolvedValueOnce({ rows: [{ id: 82, order_number: 'RAALAHAMI-82', order_type: 'DELIVERY', status: 'COOKING' }] });

      const res1 = await request(app)
        .patch('/api/admin/orders/82/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'PREPARING' });

      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe('COOKING');

      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 83, order_number: 'RAALAHAMI-83', order_type: 'DINE_IN', status: 'CONFIRMED' }] })
        .mockResolvedValueOnce({ rows: [{ id: 83, order_number: 'RAALAHAMI-83', order_type: 'DINE_IN', status: 'PREPARING' }] });

      const res2 = await request(app)
        .patch('/api/admin/orders/83/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'COOKING' });

      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe('PREPARING');
    });

    test('GET /api/admin/orders returns all orders including Home Delivery and Takeaway', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({
          rows: [
            {
              id: 901,
              order_number: 'RAALAHAMI-901',
              customer_name: 'Anoma Delivery Guest',
              phone: '+94771112233',
              email: 'anoma@example.lk',
              delivery_address: '45 Galle Road, Colombo',
              status: 'PENDING',
              total_amount: '4500.00',
              order_type: 'DELIVERY',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              hall_name: null,
              table_number: null,
            },
            {
              id: 902,
              order_number: 'RAALAHAMI-902',
              customer_name: 'Sunil Takeaway Guest',
              phone: '+94772223344',
              email: 'sunil@example.lk',
              delivery_address: '',
              status: 'READY_FOR_PICKUP',
              total_amount: '2200.00',
              order_type: 'TAKEAWAY',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              hall_name: null,
              table_number: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              order_id: 901,
              menu_item_id: 1,
              name: 'Fish Cutlets',
              quantity: 2,
              unit_price: '650.00',
              line_total: '1300.00',
            },
          ],
        });

      const response = await request(app)
        .get('/api/admin/orders')
        .set('Authorization', `Bearer ${mockAdminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].fulfillment_type).toBe('Home Delivery');
      expect(response.body.data[0].delivery_address).toBe('45 Galle Road, Colombo');
      expect(response.body.data[1].fulfillment_type).toBe('Takeaway');
    });

    test('POST /api/orders prevents duplicate submissions within 4 seconds', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [
          {
            id: 999,
            order_number: 'RAALAHAMI-999',
            total_amount: '1200.00',
            order_type: 'DELIVERY',
            status: 'PENDING',
            recipient_name: 'Repeat Patron',
            customer_name: 'Repeat Patron',
          },
        ],
      });

      const response = await request(app)
        .post('/api/orders')
        .send({
          email: 'repeat@example.com',
          totalAmount: 1200.00,
          fulfillment_type: 'Home Delivery',
          items: [{ id: 1, quantity: 1 }],
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toMatch(/already received/i);
      expect(response.body.data.id).toBe(999);
    });

    test('GET /api/orders/history/:email returns all orders matching patron email with line items', async () => {
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({
          rows: [
            {
              id: 501,
              order_number: 'RAALAHAMI-501',
              customer_name: 'Shaluka Feast Guest',
              recipient_name: 'Shaluka Feast Guest',
              email: 'shaluka@example.com',
              customer_email: 'shaluka@example.com',
              phone: '+94771234567',
              customer_phone: '+94771234567',
              fulfillment_type: 'Home Delivery',
              fulfillmentType: 'Home Delivery',
              order_type: 'DELIVERY',
              status: 'COOKING',
              total_amount: '3500.00',
              delivery_address: '12 Temple Road, Colombo',
              table_number: null,
              hall_name: null,
              notes: 'Extra spice please',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            {
              id: 502,
              order_number: 'RAALAHAMI-502',
              customer_name: 'Shaluka Feast Guest',
              recipient_name: 'Shaluka Feast Guest',
              email: 'shaluka@example.com',
              customer_email: 'shaluka@example.com',
              phone: '+94771234567',
              customer_phone: '+94771234567',
              fulfillment_type: 'Dine-In',
              fulfillmentType: 'Dine-In',
              order_type: 'DINE_IN',
              status: 'COMPLETED',
              total_amount: '5200.00',
              delivery_address: null,
              table_number: 'Table 5',
              hall_name: 'Royal Dining Hall',
              notes: 'Anniversary celebration',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              order_id: 501,
              menu_item_id: 2,
              name: 'Jaffna Crab Curry',
              quantity: 1,
              unit_price: '3500.00',
              line_total: '3500.00',
              image_url: '/assets/crab.jpg',
            },
            {
              id: 2,
              order_id: 502,
              menu_item_id: 4,
              name: 'Lamprais Special',
              quantity: 2,
              unit_price: '2600.00',
              line_total: '5200.00',
              image_url: '/assets/lamprais.jpg',
            },
          ],
        });

      const response = await request(app)
        .get('/api/orders/history/shaluka@example.com');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.total).toBe(2);
      expect(response.body.orders).toHaveLength(2);
      expect(response.body.orders[0].id).toBe(501);
      expect(response.body.orders[0].items).toHaveLength(1);
      expect(response.body.orders[0].items[0].name).toBe('Jaffna Crab Curry');
      expect(response.body.orders[1].id).toBe(502);
      expect(response.body.orders[1].fulfillment_type).toBe('Dine-In');
      expect(response.body.orders[1].table_number).toBe('Table 5');
    });

    test('GET /api/orders/history/:email returns 400 for invalid email parameter', async () => {
      const response = await request(app)
        .get('/api/orders/history/not-an-email');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/valid email is required/i);
    });
  });

  describe('End-to-End Multi-Pipeline Lifecycle Verification', () => {
    test('Pipeline A: HOME DELIVERY (5 Stages: PENDING -> KITCHEN_CONFIRMED -> COOKING -> OUT_FOR_DELIVERY -> DELIVERED)', async () => {
      // 1. Stage 1: PENDING
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 1001, order_number: 'RAALAHAMI-1001', order_type: 'DELIVERY', status: 'PENDING' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1001, order_number: 'RAALAHAMI-1001', order_type: 'DELIVERY', status: 'KITCHEN_CONFIRMED' }] });

      const res1 = await request(app)
        .patch('/api/admin/orders/1001/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'KITCHEN_CONFIRMED' });
      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe('KITCHEN_CONFIRMED');

      // 2. Stage 2 -> 3: COOKING
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 1001, order_number: 'RAALAHAMI-1001', order_type: 'DELIVERY', status: 'KITCHEN_CONFIRMED' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1001, order_number: 'RAALAHAMI-1001', order_type: 'DELIVERY', status: 'COOKING' }] });

      const res2 = await request(app)
        .patch('/api/admin/orders/1001/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'COOKING' });
      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe('COOKING');

      // 3. Stage 3 -> 4: OUT_FOR_DELIVERY
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 1001, order_number: 'RAALAHAMI-1001', order_type: 'DELIVERY', status: 'COOKING' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1001, order_number: 'RAALAHAMI-1001', order_type: 'DELIVERY', status: 'OUT_FOR_DELIVERY' }] });

      const res3 = await request(app)
        .patch('/api/admin/orders/1001/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'OUT_FOR_DELIVERY' });
      expect(res3.status).toBe(200);
      expect(res3.body.data.status).toBe('OUT_FOR_DELIVERY');

      // 4. Stage 4 -> 5: DELIVERED
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 1001, order_number: 'RAALAHAMI-1001', order_type: 'DELIVERY', status: 'OUT_FOR_DELIVERY' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1001, order_number: 'RAALAHAMI-1001', order_type: 'DELIVERY', status: 'DELIVERED' }] });

      const res4 = await request(app)
        .patch('/api/admin/orders/1001/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'DELIVERED' });
      expect(res4.status).toBe(200);
      expect(res4.body.data.status).toBe('DELIVERED');
    });

    test('Pipeline B: TAKEAWAY (3 Stages: PENDING -> PREPARING -> READY_FOR_PICKUP -> COMPLETED)', async () => {
      // 1. Stage 1 -> 2: PREPARING
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 1002, order_number: 'RAALAHAMI-1002', order_type: 'TAKEAWAY', status: 'PENDING' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1002, order_number: 'RAALAHAMI-1002', order_type: 'TAKEAWAY', status: 'PREPARING' }] });

      const res1 = await request(app)
        .patch('/api/admin/orders/1002/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'PREPARING' });
      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe('PREPARING');

      // 2. Stage 2 -> 3: READY_FOR_PICKUP
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 1002, order_number: 'RAALAHAMI-1002', order_type: 'TAKEAWAY', status: 'PREPARING' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1002, order_number: 'RAALAHAMI-1002', order_type: 'TAKEAWAY', status: 'READY_FOR_PICKUP' }] });

      const res2 = await request(app)
        .patch('/api/admin/orders/1002/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'READY_FOR_PICKUP' });
      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe('READY_FOR_PICKUP');

      // 3. Stage 3 -> COMPLETED
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 1002, order_number: 'RAALAHAMI-1002', order_type: 'TAKEAWAY', status: 'READY_FOR_PICKUP' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1002, order_number: 'RAALAHAMI-1002', order_type: 'TAKEAWAY', status: 'COMPLETED' }] });

      const res3 = await request(app)
        .patch('/api/admin/orders/1002/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'COMPLETED' });
      expect(res3.status).toBe(200);
      expect(res3.body.data.status).toBe('COMPLETED');
    });

    test('Pipeline C: DINE-IN (3 Stages: CONFIRMED -> PREPARING -> SERVED/COMPLETED)', async () => {
      // 1. Stage 1 -> 2: PREPARING
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 1003, order_number: 'RAALAHAMI-1003', order_type: 'DINE_IN', status: 'CONFIRMED' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1003, order_number: 'RAALAHAMI-1003', order_type: 'DINE_IN', status: 'PREPARING' }] });

      const res1 = await request(app)
        .patch('/api/admin/orders/1003/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'PREPARING' });
      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe('PREPARING');

      // 2. Stage 2 -> 3: SERVED -> Coerces and saves as COMPLETED
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 1003, order_number: 'RAALAHAMI-1003', order_type: 'DINE_IN', status: 'PREPARING' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1003, order_number: 'RAALAHAMI-1003', order_type: 'DINE_IN', status: 'COMPLETED' }] })
        .mockResolvedValueOnce({ rows: [{ id: 9, table_id: 1, hall_name: 'Royal Dining Hall', table_number: 'Table 1' }] })
        .mockResolvedValueOnce({ rows: [] }); // table update

      const res2 = await request(app)
        .patch('/api/admin/orders/1003/status')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .send({ status: 'SERVED' });
      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe('COMPLETED');
    });
  });
});
