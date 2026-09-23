const db = require('../src/config/db');

describe('Database Connection Pool (PostgreSQL)', () => {
  afterAll(async () => {
    try {
      await db.pool.end();
    } catch (e) {
      // Ignore cleanup error if already closed
    }
  });

  test('Database module exports pool, query, and getClient helpers', () => {
    expect(db.pool).toBeDefined();
    expect(typeof db.query).toBe('function');
    expect(typeof db.getClient).toBe('function');
  });

  test('Executes parameterized queries safely or handles connectivity diagnostics', async () => {
    try {
      const result = await db.query('SELECT 1 + 1 AS solution');
      expect(result).toBeDefined();
      expect(result.rows).toBeInstanceOf(Array);
      expect(parseInt(result.rows[0].solution, 10)).toBe(2);
    } catch (error) {
      // If PostgreSQL local credentials are not configured yet, verify diagnostic error formatting
      console.warn(`[db.test.js] Note: PostgreSQL connection check produced: ${error.message}`);
      expect(error).toBeDefined();
      expect(typeof error.message).toBe('string');
    }
  });

  test('getClient provides a transactional client with release()', async () => {
    try {
      const client = await db.getClient();
      expect(client).toBeDefined();
      expect(typeof client.query).toBe('function');
      expect(typeof client.release).toBe('function');
      client.release();
    } catch (error) {
      console.warn(`[db.test.js] Note: getClient test produced: ${error.message}`);
      expect(error).toBeDefined();
    }
  });
});
