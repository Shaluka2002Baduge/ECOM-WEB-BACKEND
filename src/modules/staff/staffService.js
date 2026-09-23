const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');
const bcrypt = require('bcrypt');

const VALID_STAFF_ROLES = ['KITCHEN_STAFF', 'WAITER', 'MANAGER', 'ADMIN'];

/**
 * List all staff members with optional role filter
 */
const getStaffList = async (roleFilter) => {
  let queryText = `
    SELECT id, display_name, email, phone, role, created_at, updated_at
    FROM users
    WHERE role != 'CUSTOMER'
  `;
  const params = [];

  if (roleFilter && VALID_STAFF_ROLES.includes(roleFilter)) {
    queryText += ' AND role = $1';
    params.push(roleFilter);
  }

  queryText += ' ORDER BY role ASC, display_name ASC';

  const result = await db.query(queryText, params);
  return result.rows;
};

/**
 * Create a new staff member account (Admin/Manager only)
 */
const createStaffMember = async ({ displayName, email, password, phone, role }) => {
  if (!VALID_STAFF_ROLES.includes(role)) {
    throw new AppError(`Invalid staff role. Must be one of: ${VALID_STAFF_ROLES.join(', ')}`, 400);
  }

  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    throw new AppError('A user with this email address already exists.', 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.query(
    `INSERT INTO users (display_name, email, password_hash, phone, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, display_name, email, phone, role, created_at`,
    [displayName, email.toLowerCase(), passwordHash, phone || null, role]
  );

  return result.rows[0];
};

/**
 * Update a staff member's role or status
 */
const updateStaffRole = async (staffId, newRole) => {
  if (!VALID_STAFF_ROLES.includes(newRole)) {
    throw new AppError(`Invalid staff role. Must be one of: ${VALID_STAFF_ROLES.join(', ')}`, 400);
  }

  const result = await db.query(
    `UPDATE users
     SET role = $1
     WHERE id = $2 AND role != 'CUSTOMER'
     RETURNING id, display_name, email, role, updated_at`,
    [newRole, staffId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Staff member not found or is a customer.', 404);
  }

  return result.rows[0];
};

module.exports = {
  getStaffList,
  createStaffMember,
  updateStaffRole,
  VALID_STAFF_ROLES,
};
