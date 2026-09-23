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
      expect(response.body.data.user.email).toBe('test.customer@ralahami.com');
      expect(response.body.data.token).toBeDefined();

      // Verify token authenticity
      const decoded = jwt.decode(response.body.data.token);
      expect(decoded.email).toBe('test.customer@ralahami.com');
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
  });
});
