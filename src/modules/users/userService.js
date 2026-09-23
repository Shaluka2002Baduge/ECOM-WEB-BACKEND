const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');

/**
 * Retrieve user profile details by ID
 */
const getUserProfile = async (userId) => {
  const result = await db.query(
    `SELECT id, display_name, email, phone, role, created_at, updated_at
     FROM users WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found.', 404);
  }

  return result.rows[0];
};

/**
 * Update user profile (display_name, phone)
 */
const updateUserProfile = async (userId, { displayName, phone }) => {
  const result = await db.query(
    `UPDATE users
     SET display_name = COALESCE($1, display_name),
         phone = COALESCE($2, phone)
     WHERE id = $3
     RETURNING id, display_name, email, phone, role, updated_at`,
    [displayName, phone, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found.', 404);
  }

  return result.rows[0];
};

/**
 * Get all addresses registered to a user
 */
const getUserAddresses = async (userId) => {
  const result = await db.query(
    `SELECT id, address_line1, address_line2, city, state_province, postal_code, is_default, created_at
     FROM user_addresses
     WHERE user_id = $1
     ORDER BY is_default DESC, created_at DESC`,
    [userId]
  );
  return result.rows;
};

/**
 * Add a new delivery address for the user
 */
const addUserAddress = async (userId, addressData) => {
  const { addressLine1, addressLine2, city, stateProvince, postalCode, isDefault = false } = addressData;

  if (isDefault) {
    // Unset current default address
    await db.query('UPDATE user_addresses SET is_default = FALSE WHERE user_id = $1', [userId]);
  }

  const result = await db.query(
    `INSERT INTO user_addresses (user_id, address_line1, address_line2, city, state_province, postal_code, is_default)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, addressLine1, addressLine2 || null, city, stateProvince || null, postalCode, isDefault]
  );

  return result.rows[0];
};

/**
 * Delete a user address
 */
const deleteUserAddress = async (userId, addressId) => {
  const result = await db.query(
    'DELETE FROM user_addresses WHERE id = $1 AND user_id = $2 RETURNING id',
    [addressId, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Address not found or does not belong to the user.', 404);
  }

  return { id: addressId };
};

module.exports = {
  getUserProfile,
  updateUserProfile,
  getUserAddresses,
  addUserAddress,
  deleteUserAddress,
};
