const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/db');
const authService = require('../src/modules/auth/authService');

describe('Authentication & Authorization Module', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Password Hashing & Verification (Bcrypt)', () => {
    test('Hashes passwords securely and does not store plaintext', async () => {
      const plainPassword = 'SecretPassword123!';
      const hash = await bcrypt.hash(plainPassword, 10);

      expect(hash).not.toBe(plainPassword);
      expect(hash.startsWith('$2b$')).toBe(true);

      const isMatch = await bcrypt.compare(plainPassword, hash);
      expect(isMatch).toBe(true);

      const isWrongMatch = await bcrypt.compare('WrongPassword!', hash);
      expect(isWrongMatch).toBe(false);
    });
  });

  describe('User Registration (POST /api/auth/register)', () => {
    test('Successfully registers a new user with valid credentials', async () => {
      const mockUser = {
        id: '11111111-1111-1111-1111-111111111111',
        display_name: 'Test Customer',
        email: 'test.customer@ralahami.com',
        phone: '+94770000000',
        role: 'CUSTOMER',
        created_at: new Date().toISOString(),
      };

      // Mock database calls: 1st check returns empty, 2nd insert returns mockUser
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [] }) // Email availability check
        .mockResolvedValueOnce({ rows: [mockUser] }); // Insert statement

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          displayName: 'Test Customer',
          email: 'test.customer@ralahami.com',
          password: 'Password123!',
          phone: '+94770000000',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('User registered successfully. Please sign in to continue.');
      expect(response.body.token).toBeUndefined();
      expect(response.headers['set-cookie']).toBeUndefined();
    });


    test('Prevents duplicate email registrations with HTTP 409 Conflict', async () => {
      // Mock database returning an existing user row on email lookup
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [{ id: 'existing-uuid-1234' }],
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          displayName: 'Duplicate User',
          email: 'existing@ralahami.com',
          password: 'Password123!',
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/already exists/i);
    });

    test('Rejects registration when required fields are missing with HTTP 400', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'incomplete@ralahami.com',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/required/i);
    });
  });

  describe('User Login (POST /api/auth/login)', () => {
    test('Rejects invalid password with HTTP 401 Unauthorized', async () => {
      const passwordHash = await bcrypt.hash('CorrectPassword123!', 10);
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [
          {
            id: 'mock-user-id',
            display_name: 'Auth User',
            email: 'auth.user@ralahami.com',
            password_hash: passwordHash,
            role: 'CUSTOMER',
          },
        ],
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'auth.user@ralahami.com',
          password: 'WrongPassword!',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/invalid.*credentials/i);
    });

    test('Rejects non-existent email with HTTP 401 Unauthorized', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@ralahami.lk',
          password: 'Password123!',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/invalid.*credentials/i);
    });

    test('Rejects missing email or password with HTTP 400 Bad Request', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@ralahami.lk' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/required/i);
    });

    test('Authenticates valid user, extracts dynamic role, sets HTTP-Only cookie, and returns correct payload', async () => {
      const password = 'Password123!';
      const passwordHash = await bcrypt.hash(password, 10);

      const mockDbUser = {
        id: '11111111-2222-3333-4444-555555555501',
        display_name: 'System Administrator',
        email: 'admin@ralahami.lk',
        password_hash: passwordHash,
        role: 'ADMIN',
        phone: '+94771234567',
        created_at: new Date().toISOString(),
      };

      jest.spyOn(db, 'query').mockResolvedValueOnce({ rows: [mockDbUser] });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@ralahami.lk',
          password,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeDefined();

      // Verify user object
      expect(response.body.user).toEqual({
        id: '11111111-2222-3333-4444-555555555501',
        displayName: 'System Administrator',
        email: 'admin@ralahami.lk',
        role: 'ADMIN',
      });

      // Verify HTTP-Only cookie header
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some((c) => c.includes('token=') && c.includes('HttpOnly'))).toBe(true);

      // Verify JWT payload contents: { id, displayName, email, role }
      const decoded = jwt.verify(
        response.body.token,
        process.env.JWT_SECRET || 'ralahami_fallback_secret_key'
      );
      expect(decoded.id).toBe('11111111-2222-3333-4444-555555555501');
      expect(decoded.displayName).toBe('System Administrator');
      expect(decoded.email).toBe('admin@ralahami.lk');
      expect(decoded.role).toBe('ADMIN');
    });
  });

  describe('Authorization Middleware & Role Guards (RBAC)', () => {
    const secret = process.env.JWT_SECRET || 'ralahami_fallback_secret_key';

    const adminToken = jwt.sign(
      { id: '1', displayName: 'Admin User', email: 'admin@ralahami.lk', role: 'ADMIN' },
      secret
    );
    const kitchenToken = jwt.sign(
      { id: '2', displayName: 'Chef Silva', email: 'kitchen@ralahami.lk', role: 'KITCHEN_STAFF' },
      secret
    );
    const customerToken = jwt.sign(
      { id: '3', displayName: 'Patron', email: 'patron@ralahami.lk', role: 'CUSTOMER' },
      secret
    );

    test('Allows access via HTTP-Only cookie to /api/auth/me', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`token=${adminToken}`]);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user.role).toBe('ADMIN');
      expect(response.body.user.displayName).toBe('Admin User');
    });

    test('Strictly restricts /api/admin/* to ADMIN/MANAGER and rejects unauthorized with HTTP 403', async () => {
      // Mock db queries for dashboard
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ total_users: 10, role: 'CUSTOMER', role_count: 10 }] })
        .mockResolvedValueOnce({ rows: [{ total_orders: 5, total_revenue: '100.00', status: 'COMPLETED' }] })
        .mockResolvedValueOnce({ rows: [{ low_stock_items: 2 }] })
        .mockResolvedValueOnce({ rows: [{ total_reservations: 3, status: 'CONFIRMED' }] });

      // Admin access -> 200
      const adminRes = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.success).toBe(true);

      // Customer access -> 403 Forbidden
      const customerRes = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(customerRes.status).toBe(403);
      expect(customerRes.body.code).toBe('INSUFFICIENT_PERMISSIONS');

      // Kitchen Staff access -> 403 Forbidden
      const kitchenRes = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${kitchenToken}`);
      expect(kitchenRes.status).toBe(403);
      expect(kitchenRes.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    test('Strictly restricts /api/inventory/* to ADMIN/MANAGER and rejects KITCHEN_STAFF with HTTP 403', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({ rows: [] });

      // Admin access -> 200
      const adminRes = await request(app)
        .get('/api/inventory')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRes.status).toBe(200);

      // Kitchen Staff -> 403 Forbidden
      const kitchenRes = await request(app)
        .get('/api/inventory')
        .set('Authorization', `Bearer ${kitchenToken}`);
      expect(kitchenRes.status).toBe(403);
      expect(kitchenRes.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    test('Strictly restricts /api/orders/:id/status to KITCHEN_STAFF and ADMIN', async () => {
      // Mock status transitions: from CONFIRMED -> PREPARING
      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'CONFIRMED' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'PREPARING' }] });

      // Kitchen Staff -> 200
      const kitchenRes = await request(app)
        .patch('/api/orders/1/status')
        .set('Authorization', `Bearer ${kitchenToken}`)
        .send({ status: 'PREPARING' });
      expect(kitchenRes.status).toBe(200);


      // Customer -> 403 Forbidden
      const customerRes = await request(app)
        .patch('/api/orders/1/status')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ status: 'PREPARING' });
      expect(customerRes.status).toBe(403);
      expect(customerRes.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });
});

