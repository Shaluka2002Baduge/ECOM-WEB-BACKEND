const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');

const SALT_ROUNDS = 10;

/**
 * Register a new customer or user account
 */
const registerUser = async ({ displayName, email, password, phone, role = 'CUSTOMER' }) => {
  // Validate duplicate email
  const existingUser = await db.query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
    [email.trim()]
  );
  if (existingUser.rows.length > 0) {
    throw new AppError('An account with this email address already exists.', 409);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Insert user record
  const result = await db.query(
    `INSERT INTO users (display_name, email, password_hash, phone, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, display_name, email, phone, role, created_at`,
    [displayName.trim(), email.toLowerCase().trim(), passwordHash, phone ? phone.trim() : null, role]
  );

  const newUser = result.rows[0];

  const userPayload = {
    id: newUser.id,
    displayName: newUser.display_name,
    display_name: newUser.display_name,
    email: newUser.email,
    role: newUser.role,
    phone: newUser.phone,
    createdAt: newUser.created_at,
  };

  // Generate JWT token containing { id, displayName, email, role }
  const token = generateToken(userPayload);

  return { user: userPayload, token };
};

/**
 * Authenticate existing user strictly with email and password
 * Extracts the user's authentic role stored in the database ('CUSTOMER', 'KITCHEN_STAFF', 'MANAGER', 'ADMIN')
 *
 * @param {Object} credentials
 * @param {string} credentials.email
 * @param {string} credentials.password
 * @returns {Promise<{ user: { id: string, displayName: string, email: string, role: string }, token: string }>}
 */
const loginUser = async ({ email, password }) => {
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    throw new AppError('Both email and password are required.', 400);
  }

  const result = await db.query(
    `SELECT id, display_name, email, password_hash, role, phone, created_at
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invalid email or password credentials.', 401);
  }

  const user = result.rows[0];
  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new AppError('Invalid email or password credentials.', 401);
  }

  // Extract authentic role from database and construct standardized virtual identity payload
  const userPayload = {
    id: user.id,
    displayName: user.display_name,
    display_name: user.display_name,
    email: user.email,
    role: user.role, // 'CUSTOMER' | 'KITCHEN_STAFF' | 'MANAGER' | 'ADMIN'
  };

  const token = generateToken(userPayload);

  return { user: userPayload, token };
};

/**
 * Generate signed JWT token
 * Signs a JWT containing { id, displayName, email, role }
 *
 * @param {Object} user
 * @param {string} user.id
 * @param {string} user.displayName
 * @param {string} user.email
 * @param {string} user.role
 * @returns {string}
 */
const generateToken = (user) => {
  const secret = process.env.JWT_SECRET || 'ralahami_fallback_secret_key';
  const expiresIn = process.env.JWT_EXPIRES_IN || '1d';

  return jwt.sign(
    {
      id: user.id,
      displayName: user.displayName || user.display_name,
      email: user.email,
      role: user.role,
    },
    secret,
    { expiresIn }
  );
};

module.exports = {
  registerUser,
  loginUser,
  generateToken,
};

