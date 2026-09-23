const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// Initialize connection configuration based on DATABASE_URL or individual credentials
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'ralahami_restaurant_db',
      ssl: isProduction ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool({
  ...poolConfig,
  max: 20, // Max concurrent connections
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Return an error after 5s if connection cannot be established
});

// Pool error handling for idle clients
pool.on('error', (err) => {
  console.error('[Database Pool Error]: Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Standard query helper with execution timing and error logging
 * Supports parameterized queries to defend against SQL Injection
 * @param {string} text - SQL Query text
 * @param {Array} params - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DB Query Executed] in ${duration}ms | Rows: ${res.rowCount}`);
    }
    return res;
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`[DB Query Failed] in ${duration}ms | Query: ${text} | Error: ${error.message}`);
    throw error;
  }
};

/**
 * Dedicated client checkout for database transactions (BEGIN / COMMIT / ROLLBACK)
 * @returns {Promise<import('pg').PoolClient>}
 */
const getClient = async () => {
  const client = await pool.connect();
  return client;
};

module.exports = {
  pool,
  query,
  getClient,
};
