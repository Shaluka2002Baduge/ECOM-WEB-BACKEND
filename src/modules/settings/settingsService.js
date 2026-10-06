const bcrypt = require('bcrypt');
const { pool } = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');

const DEFAULT_SETTINGS = {
  id: 1,
  restaurant_name: 'Raalahami Royal Heritage Restaurant',
  tagline: 'Authentic Ceylon Heritage & Royal Dining Experience',
  address: 'Riverside Road, Ratnapura, Sri Lanka',
  phone: '+94 77 123 4567',
  email: 'info@raalahami.lk',
  website: 'https://raalahami.lk',
  currency_symbol: 'LKR',
  tax_rate: 0.00,
  service_charge_rate: 0.00,
  delivery_fee: 350.00,
  opening_time: '10:00 AM',
  closing_time: '11:00 PM',
  is_dine_in_enabled: true,
  is_delivery_enabled: true,
  is_takeaway_enabled: true,
  order_notification_email: 'orders@raalahami.lk'
};

/**
 * Format raw settings database row into standardized response object
 */
const formatSettings = (row) => {
  if (!row) return DEFAULT_SETTINGS;
  return {
    id: row.id,
    restaurant_name: row.restaurant_name || DEFAULT_SETTINGS.restaurant_name,
    tagline: row.tagline || DEFAULT_SETTINGS.tagline,
    address: row.address || DEFAULT_SETTINGS.address,
    phone: row.phone || DEFAULT_SETTINGS.phone,
    email: row.email || DEFAULT_SETTINGS.email,
    website: row.website || DEFAULT_SETTINGS.website,
    currency_symbol: row.currency_symbol || DEFAULT_SETTINGS.currency_symbol,
    tax_rate: parseFloat(row.tax_rate ?? DEFAULT_SETTINGS.tax_rate),
    service_charge_rate: parseFloat(row.service_charge_rate ?? DEFAULT_SETTINGS.service_charge_rate),
    delivery_fee: parseFloat(row.delivery_fee ?? DEFAULT_SETTINGS.delivery_fee),
    opening_time: row.opening_time || DEFAULT_SETTINGS.opening_time,
    closing_time: row.closing_time || DEFAULT_SETTINGS.closing_time,
    is_dine_in_enabled: Boolean(row.is_dine_in_enabled ?? true),
    is_delivery_enabled: Boolean(row.is_delivery_enabled ?? true),
    is_takeaway_enabled: Boolean(row.is_takeaway_enabled ?? true),
    order_notification_email: row.order_notification_email || DEFAULT_SETTINGS.order_notification_email,
    updated_at: row.updated_at
  };
};

/**
 * Fetch current system & restaurant settings
 */
const getSettings = async () => {
  try {
    const result = await pool.query('SELECT * FROM settings WHERE id = 1 LIMIT 1');
    if (result.rows.length === 0) {
      const insertResult = await pool.query(`
        INSERT INTO settings (id, restaurant_name, tagline, address, phone, email, website, currency_symbol, tax_rate, service_charge_rate, delivery_fee, opening_time, closing_time, is_dine_in_enabled, is_delivery_enabled, is_takeaway_enabled, order_notification_email)
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE SET restaurant_name = EXCLUDED.restaurant_name
        RETURNING *
      `, [
        DEFAULT_SETTINGS.restaurant_name,
        DEFAULT_SETTINGS.tagline,
        DEFAULT_SETTINGS.address,
        DEFAULT_SETTINGS.phone,
        DEFAULT_SETTINGS.email,
        DEFAULT_SETTINGS.website,
        DEFAULT_SETTINGS.currency_symbol,
        DEFAULT_SETTINGS.tax_rate,
        DEFAULT_SETTINGS.service_charge_rate,
        DEFAULT_SETTINGS.delivery_fee,
        DEFAULT_SETTINGS.opening_time,
        DEFAULT_SETTINGS.closing_time,
        DEFAULT_SETTINGS.is_dine_in_enabled,
        DEFAULT_SETTINGS.is_delivery_enabled,
        DEFAULT_SETTINGS.is_takeaway_enabled,
        DEFAULT_SETTINGS.order_notification_email
      ]);
      return formatSettings(insertResult.rows[0]);
    }
    return formatSettings(result.rows[0]);
  } catch (err) {
    console.error('[SettingsService.getSettings Error]:', err);
    return DEFAULT_SETTINGS;
  }
};

/**
 * Update system & restaurant settings
 */
const updateSettings = async (data = {}) => {
  const current = await getSettings();

  const restaurant_name = (data.restaurant_name || data.restaurantName || current.restaurant_name).trim();
  const tagline = (data.tagline !== undefined ? data.tagline : current.tagline).trim();
  const address = (data.address !== undefined ? data.address : current.address).trim();
  const phone = (data.phone !== undefined ? data.phone : current.phone).trim();
  const email = (data.email !== undefined ? data.email : current.email).trim().toLowerCase();
  const website = (data.website !== undefined ? data.website : current.website).trim();
  const currency_symbol = (data.currency_symbol || data.currencySymbol || current.currency_symbol).trim();
  const tax_rate = Math.max(0, parseFloat(data.tax_rate ?? data.taxRate ?? current.tax_rate) || 0);
  const service_charge_rate = Math.max(0, parseFloat(data.service_charge_rate ?? data.serviceChargeRate ?? current.service_charge_rate) || 0);
  const delivery_fee = Math.max(0, parseFloat(data.delivery_fee ?? data.deliveryFee ?? current.delivery_fee) || 0);
  const opening_time = (data.opening_time || data.openingTime || current.opening_time).trim();
  const closing_time = (data.closing_time || data.closingTime || current.closing_time).trim();
  const is_dine_in_enabled = data.is_dine_in_enabled !== undefined ? Boolean(data.is_dine_in_enabled) : (data.isDineInEnabled !== undefined ? Boolean(data.isDineInEnabled) : current.is_dine_in_enabled);
  const is_delivery_enabled = data.is_delivery_enabled !== undefined ? Boolean(data.is_delivery_enabled) : (data.isDeliveryEnabled !== undefined ? Boolean(data.isDeliveryEnabled) : current.is_delivery_enabled);
  const is_takeaway_enabled = data.is_takeaway_enabled !== undefined ? Boolean(data.is_takeaway_enabled) : (data.isTakeawayEnabled !== undefined ? Boolean(data.isTakeawayEnabled) : current.is_takeaway_enabled);
  const order_notification_email = (data.order_notification_email || data.orderNotificationEmail || current.order_notification_email).trim().toLowerCase();

  const query = `
    INSERT INTO settings (
      id, restaurant_name, tagline, address, phone, email, website, currency_symbol,
      tax_rate, service_charge_rate, delivery_fee, opening_time, closing_time,
      is_dine_in_enabled, is_delivery_enabled, is_takeaway_enabled, order_notification_email, updated_at
    )
    VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
    ON CONFLICT (id) DO UPDATE SET
      restaurant_name = EXCLUDED.restaurant_name,
      tagline = EXCLUDED.tagline,
      address = EXCLUDED.address,
      phone = EXCLUDED.phone,
      email = EXCLUDED.email,
      website = EXCLUDED.website,
      currency_symbol = EXCLUDED.currency_symbol,
      tax_rate = EXCLUDED.tax_rate,
      service_charge_rate = EXCLUDED.service_charge_rate,
      delivery_fee = EXCLUDED.delivery_fee,
      opening_time = EXCLUDED.opening_time,
      closing_time = EXCLUDED.closing_time,
      is_dine_in_enabled = EXCLUDED.is_dine_in_enabled,
      is_delivery_enabled = EXCLUDED.is_delivery_enabled,
      is_takeaway_enabled = EXCLUDED.is_takeaway_enabled,
      order_notification_email = EXCLUDED.order_notification_email,
      updated_at = NOW()
    RETURNING *;
  `;

  const values = [
    restaurant_name,
    tagline,
    address,
    phone,
    email,
    website,
    currency_symbol,
    tax_rate,
    service_charge_rate,
    delivery_fee,
    opening_time,
    closing_time,
    is_dine_in_enabled,
    is_delivery_enabled,
    is_takeaway_enabled,
    order_notification_email
  ];

  const result = await pool.query(query, values);
  return formatSettings(result.rows[0]);
};

/**
 * Securely change administrator login password
 */
const updateAdminPassword = async ({ userId, userEmail, currentPassword, newPassword, confirmPassword }) => {
  if (!currentPassword) {
    throw new AppError('Current password is required to authorize this security update.', 400);
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    throw new AppError('New password must be at least 6 characters long.', 400);
  }
  if (confirmPassword && newPassword !== confirmPassword) {
    throw new AppError('New password and password confirmation do not match.', 400);
  }

  // Find user by ID or Email
  let userQuery;
  let queryParam;
  if (userId) {
    userQuery = 'SELECT id, email, password_hash, role, display_name FROM users WHERE id = $1';
    queryParam = userId;
  } else if (userEmail) {
    userQuery = 'SELECT id, email, password_hash, role, display_name FROM users WHERE LOWER(email) = LOWER($1)';
    queryParam = userEmail.trim();
  } else {
    throw new AppError('Authenticated user identity context missing.', 401);
  }

  const userRes = await pool.query(userQuery, [queryParam]);
  if (userRes.rows.length === 0) {
    throw new AppError('User account not found.', 404);
  }

  const user = userRes.rows[0];

  // Verify current password against stored bcrypt hash
  const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isMatch) {
    throw new AppError('Current password is incorrect. Authorization denied.', 400);
  }

  // Hash new password with 10 salt rounds
  const newHash = await bcrypt.hash(newPassword, 10);

  // Update password in database
  await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [newHash, user.id]
  );

  return {
    success: true,
    message: 'Administrator password updated successfully.',
    userId: user.id,
    email: user.email,
    updatedAt: new Date().toISOString()
  };
};

module.exports = {
  getSettings,
  updateSettings,
  updateAdminPassword,
  DEFAULT_SETTINGS
};
