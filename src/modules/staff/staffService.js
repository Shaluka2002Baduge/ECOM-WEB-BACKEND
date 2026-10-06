const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');
const bcrypt = require('bcrypt');

const VALID_STAFF_ROLES = ['KITCHEN_STAFF', 'WAITER', 'MANAGER', 'ADMIN'];

/**
 * List all staff members with optional role filter and search query
 */
const getStaffList = async (roleFilter, searchQuery) => {
  // Ensure department and shift_status columns exist on users table
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(150) DEFAULT 'General Operations';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS shift_status VARCHAR(50) DEFAULT 'Active Shift';
  `);

  let queryText = `
    SELECT id, 
           display_name AS name, 
           display_name, 
           email, 
           phone, 
           role, 
           COALESCE(department, 'General Operations') AS department, 
           COALESCE(shift_status, 'Active Shift') AS status,
           COALESCE(shift_status, 'Active Shift') AS shift_status,
           created_at, 
           updated_at
    FROM users
    WHERE role != 'CUSTOMER'
  `;
  const params = [];

  if (roleFilter && VALID_STAFF_ROLES.includes(roleFilter.toUpperCase())) {
    params.push(roleFilter.toUpperCase());
    queryText += ` AND role = $${params.length}`;
  }

  if (searchQuery && searchQuery.trim()) {
    params.push(`%${searchQuery.trim()}%`);
    const idx = params.length;
    queryText += ` AND (display_name ILIKE $${idx} OR email ILIKE $${idx} OR department ILIKE $${idx} OR role::text ILIKE $${idx})`;
  }

  queryText += ' ORDER BY role ASC, display_name ASC';

  const result = await db.query(queryText, params);
  return result.rows;
};

/**
 * Get staff member by ID
 */
const getStaffById = async (staffId) => {
  const result = await db.query(
    `SELECT id, display_name AS name, display_name, email, phone, role, 
            COALESCE(department, 'General Operations') AS department, 
            COALESCE(shift_status, 'Active Shift') AS status,
            COALESCE(shift_status, 'Active Shift') AS shift_status,
            created_at, updated_at
     FROM users 
     WHERE id = $1 AND role != 'CUSTOMER'`,
    [staffId]
  );
  if (result.rows.length === 0) {
    throw new AppError('Staff member not found.', 404);
  }
  return result.rows[0];
};

/**
 * Create a new staff member account (Admin/Manager only)
 */
const createStaffMember = async ({ displayName, name, email, password, phone, role, department, station, shiftStatus, status }) => {
  const staffName = (displayName || name || '').trim();
  const staffEmail = (email || '').trim().toLowerCase();
  const staffRole = (role || '').trim().toUpperCase();
  const staffDept = (department || station || 'General Operations').trim();
  const staffShift = (shiftStatus || status || 'Active Shift').trim();
  const rawPassword = password || 'Password123!';

  if (!staffName) {
    throw new AppError('Staff display name is required.', 400);
  }
  if (!staffEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffEmail)) {
    throw new AppError('A valid email address is required.', 400);
  }
  if (!VALID_STAFF_ROLES.includes(staffRole)) {
    throw new AppError(`Invalid staff role. Must be one of: ${VALID_STAFF_ROLES.join(', ')}`, 400);
  }

  const existing = await db.query('SELECT id FROM users WHERE email = $1', [staffEmail]);
  if (existing.rows.length > 0) {
    throw new AppError('A user account with this email address already exists.', 409);
  }

  const passwordHash = await bcrypt.hash(rawPassword, 10);
  const result = await db.query(
    `INSERT INTO users (display_name, email, password_hash, phone, role, department, shift_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, display_name AS name, display_name, email, phone, role, department, shift_status AS status, shift_status, created_at, updated_at`,
    [staffName, staffEmail, passwordHash, phone || null, staffRole, staffDept, staffShift]
  );

  return result.rows[0];
};

/**
 * Update an existing staff member (role, department/station, shift status, name, phone)
 */
const updateStaffMember = async (staffId, { displayName, name, phone, role, department, station, shiftStatus, status, password }) => {
  const staff = await getStaffById(staffId);

  const updates = [];
  const params = [staffId];

  if (displayName || name) {
    params.push((displayName || name).trim());
    updates.push(`display_name = $${params.length}`);
  }

  if (phone !== undefined) {
    params.push(phone ? phone.trim() : null);
    updates.push(`phone = $${params.length}`);
  }

  if (role) {
    const r = role.trim().toUpperCase();
    if (!VALID_STAFF_ROLES.includes(r)) {
      throw new AppError(`Invalid staff role. Must be one of: ${VALID_STAFF_ROLES.join(', ')}`, 400);
    }
    params.push(r);
    updates.push(`role = $${params.length}`);
  }

  if (department || station) {
    params.push((department || station).trim());
    updates.push(`department = $${params.length}`);
  }

  if (shiftStatus || status) {
    params.push((shiftStatus || status).trim());
    updates.push(`shift_status = $${params.length}`);
  }

  if (password && password.trim()) {
    const passwordHash = await bcrypt.hash(password.trim(), 10);
    params.push(passwordHash);
    updates.push(`password_hash = $${params.length}`);
  }

  if (updates.length === 0) {
    return staff;
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);

  const result = await db.query(
    `UPDATE users
     SET ${updates.join(', ')}
     WHERE id = $1 AND role != 'CUSTOMER'
     RETURNING id, display_name AS name, display_name, email, phone, role, department, shift_status AS status, shift_status, created_at, updated_at`,
    params
  );

  if (result.rows.length === 0) {
    throw new AppError('Staff member not found or cannot be updated.', 404);
  }

  return result.rows[0];
};

/**
 * Update a staff member's role specifically
 */
const updateStaffRole = async (staffId, newRole) => {
  return updateStaffMember(staffId, { role: newRole });
};

/**
 * Delete a staff member account from the registry
 */
const deleteStaffMember = async (staffId) => {
  const result = await db.query(
    `DELETE FROM users
     WHERE id = $1 AND role != 'CUSTOMER'
     RETURNING id, display_name, email`,
    [staffId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Staff member not found or is a customer account.', 404);
  }

  return result.rows[0];
};

module.exports = {
  getStaffList,
  getStaffById,
  createStaffMember,
  updateStaffMember,
  updateStaffRole,
  deleteStaffMember,
  VALID_STAFF_ROLES,
};
