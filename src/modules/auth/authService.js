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
  const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
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
    [displayName, email.toLowerCase(), passwordHash, phone || null, role]
  );

  const newUser = result.rows[0];

  // Generate JWT token
  const token = generateToken(newUser);

  return { user: newUser, token };
};

/**
 * Authenticate existing user with email and password
 */
const loginUser = async ({ email, password }) => {
  const result = await db.query(
    `SELECT id, display_name, email, password_hash, role, phone, created_at
     FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invalid email or password credentials.', 401);
  }

  const user = result.rows[0];
  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new AppError('Invalid email or password credentials.', 401);
  }

  // Remove password_hash from return payload
  delete user.password_hash;

  const token = generateToken(user);

  return { user, token };
};

/**
 * Generate signed JWT token
 */
const generateToken = (user) => {
  const secret = process.env.JWT_SECRET || 'ralahami_fallback_secret_key';
  const expiresIn = process.env.JWT_EXPIRES_IN || '1d';

  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.display_name,
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
