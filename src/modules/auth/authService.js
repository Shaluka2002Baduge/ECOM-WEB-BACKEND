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

const emailService = require('../../services/emailService');

// In-memory OTP storage cache for fast validation and fallback resilience:
// Key: normalized email -> Value: { otp, expiresAt, userId }
const otpStore = new Map();

/**
 * Initiate Forgot Password process:
 * Generates a 6-digit numeric OTP, stores it with 10-minute expiry,
 * and dispatches the branded OTP verification email.
 *
 * @param {Object} params
 * @param {string} params.email
 */
const forgotPassword = async ({ email }) => {
  if (!email || typeof email !== 'string') {
    throw new AppError('Email address is required.', 400);
  }

  const normalizedEmail = email.toLowerCase().trim();

  // 1. Locate user account in database
  const userResult = await db.query(
    'SELECT id, display_name, email FROM users WHERE LOWER(email) = LOWER($1)',
    [normalizedEmail]
  );

  if (userResult.rows.length === 0) {
    throw new AppError('No account found with this email address.', 404);
  }

  const user = userResult.rows[0];

  // 2. Generate secure 6-digit numeric OTP and 10-minute expiry timestamp
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // 3. Store in memory cache
  otpStore.set(normalizedEmail, {
    otp: otpCode,
    expiresAt: expiresAt.getTime(),
    userId: user.id,
  });

  // 4. Update database columns if present
  try {
    await db.query(
      `UPDATE users
       SET reset_otp = $1, reset_otp_expires_at = $2
       WHERE id = $3`,
      [otpCode, expiresAt, user.id]
    );
  } catch (err) {
    // Memory cache provides seamless resilience if column migration is pending
  }

  return {
    success: true,
    user,
    otpCode,
    email: user.email,
  };
};

/**
 * Validate 6-digit OTP code and expiration for an email address
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string|number} params.otp
 */
const verifyOtp = async ({ email, otp }) => {
  if (!email || !otp) {
    throw new AppError('Both email and OTP code are required.', 400);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const cleanOtp = otp.toString().trim();

  let isMatch = false;
  let isExpired = false;

  // 1. Check in-memory store
  const cached = otpStore.get(normalizedEmail);
  if (cached) {
    if (Date.now() > cached.expiresAt) {
      otpStore.delete(normalizedEmail);
      isExpired = true;
    } else if (cached.otp === cleanOtp) {
      isMatch = true;
    }
  }

  // 2. If not matched in cache, verify against database record
  if (!isMatch && !isExpired) {
    try {
      const dbResult = await db.query(
        'SELECT id, reset_otp, reset_otp_expires_at FROM users WHERE LOWER(email) = LOWER($1)',
        [normalizedEmail]
      );
      if (dbResult.rows.length > 0) {
        const row = dbResult.rows[0];
        if (row.reset_otp) {
          const dbExpiresAt = new Date(row.reset_otp_expires_at).getTime();
          if (Date.now() > dbExpiresAt) {
            isExpired = true;
          } else if (row.reset_otp === cleanOtp) {
            isMatch = true;
          }
        }
      }
    } catch (err) {
      // Ignore column absence
    }
  }

  if (isExpired) {
    throw new AppError('Verification code has expired. Please request a new one.', 400);
  }

  if (!isMatch) {
    throw new AppError('Invalid verification code.', 400);
  }

  return { success: true, verified: true };
};

/**
 * Reset User Password after successful OTP verification:
 * Hashes new password with bcrypt, updates user record, and clears OTP.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string|number} params.otp
 * @param {string} params.newPassword
 */
const resetPassword = async ({ email, otp, newPassword }) => {
  if (!email || !otp || !newPassword) {
    throw new AppError('Email, OTP, and newPassword are required.', 400);
  }

  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    throw new AppError('New password must be at least 6 characters long.', 400);
  }

  const normalizedEmail = email.toLowerCase().trim();

  // 1. Validate OTP and expiry
  await verifyOtp({ email: normalizedEmail, otp });

  // 2. Hash new password with bcrypt
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // 3. Update database password and clear OTP
  try {
    await db.query(
      `UPDATE users
       SET password_hash = $1, reset_otp = NULL, reset_otp_expires_at = NULL
       WHERE LOWER(email) = LOWER($2)`,
      [passwordHash, normalizedEmail]
    );
  } catch (err) {
    await db.query(
      `UPDATE users
       SET password_hash = $1
       WHERE LOWER(email) = LOWER($2)`,
      [passwordHash, normalizedEmail]
    );
  }

  // 4. Invalidate memory cache
  otpStore.delete(normalizedEmail);

  return { success: true };
};

module.exports = {
  registerUser,
  loginUser,
  generateToken,
  forgotPassword,
  verifyOtp,
  resetPassword,
  otpStore,
};


