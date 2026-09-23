const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');

const RESERVATION_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SEATED', 'CANCELLED'],
  SEATED: [], // Terminal
  CANCELLED: [], // Terminal
};

/**
 * List all active tables
 */
const getTables = async () => {
  const result = await db.query(
    'SELECT id, table_number, seating_capacity, location_description, is_active FROM tables ORDER BY seating_capacity ASC'
  );
  return result.rows;
};

/**
 * Find available tables for a party size at a specific time
 * Considers a 2-hour dining buffer window
 */
const checkAvailability = async (reservationTime, partySize) => {
  const reqTime = new Date(reservationTime);
  if (isNaN(reqTime.getTime())) {
    throw new AppError('Invalid reservation date and time.', 400);
  }

  // 2-hour window buffer (+/- 2 hours)
  const windowStart = new Date(reqTime.getTime() - 2 * 60 * 60 * 1000);
  const windowEnd = new Date(reqTime.getTime() + 2 * 60 * 60 * 1000);

  const result = await db.query(
    `SELECT t.id, t.table_number, t.seating_capacity, t.location_description
     FROM tables t
     WHERE t.is_active = TRUE
       AND t.seating_capacity >= $1
       AND t.id NOT IN (
         SELECT r.table_id
         FROM reservations r
         WHERE r.status IN ('PENDING', 'CONFIRMED', 'SEATED')
           AND r.reservation_time >= $2
           AND r.reservation_time <= $3
       )
     ORDER BY t.seating_capacity ASC`,
    [partySize, windowStart.toISOString(), windowEnd.toISOString()]
  );

  return result.rows;
};

/**
 * Create a new table reservation
 */
const createReservation = async (userId, { tableId, partySize, reservationTime, specialRequests }) => {
  const targetDate = new Date(reservationTime);
  if (targetDate <= new Date()) {
    throw new AppError('Reservation time must be in the future.', 400);
  }

  // Check table capacity
  const tableResult = await db.query('SELECT id, seating_capacity, is_active FROM tables WHERE id = $1', [tableId]);
  if (tableResult.rows.length === 0 || !tableResult.rows[0].is_active) {
    throw new AppError('Selected table is not available or does not exist.', 400);
  }

  const table = tableResult.rows[0];
  if (table.seating_capacity < partySize) {
    throw new AppError(`Selected table only seats ${table.seating_capacity} guests, but party size is ${partySize}.`, 400);
  }

  // Check collision within 2 hours
  const windowStart = new Date(targetDate.getTime() - 2 * 60 * 60 * 1000);
  const windowEnd = new Date(targetDate.getTime() + 2 * 60 * 60 * 1000);

  const conflict = await db.query(
    `SELECT id FROM reservations
     WHERE table_id = $1
       AND status IN ('PENDING', 'CONFIRMED', 'SEATED')
       AND reservation_time >= $2
       AND reservation_time <= $3`,
    [tableId, windowStart.toISOString(), windowEnd.toISOString()]
  );

  if (conflict.rows.length > 0) {
    throw new AppError('This table is already reserved during the requested time slot.', 409);
  }

  const result = await db.query(
    `INSERT INTO reservations (user_id, table_id, party_size, reservation_time, status, special_requests)
     VALUES ($1, $2, $3, $4, 'PENDING', $5)
     RETURNING *`,
    [userId || null, tableId, partySize, targetDate.toISOString(), specialRequests || null]
  );

  return result.rows[0];
};

/**
 * Retrieve reservations
 */
const getReservations = async (requestingUser, statusFilter) => {
  let queryText = `
    SELECT r.*, t.table_number, t.location_description, u.display_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
    FROM reservations r
    JOIN tables t ON r.table_id = t.id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (requestingUser.role === 'CUSTOMER') {
    params.push(requestingUser.id);
    queryText += ` AND r.user_id = $${params.length}`;
  }

  if (statusFilter) {
    params.push(statusFilter);
    queryText += ` AND r.status = $${params.length}`;
  }

  queryText += ' ORDER BY r.reservation_time ASC';

  const result = await db.query(queryText, params);
  return result.rows;
};

/**
 * Update reservation status with state machine checks
 */
const updateReservationStatus = async (reservationId, newStatus) => {
  const currentResult = await db.query('SELECT id, status FROM reservations WHERE id = $1', [reservationId]);
  if (currentResult.rows.length === 0) {
    throw new AppError('Reservation not found.', 404);
  }

  const currentStatus = currentResult.rows[0].status;
  const allowed = RESERVATION_TRANSITIONS[currentStatus] || [];

  if (!allowed.includes(newStatus)) {
    throw new AppError(
      `Invalid state transition: Cannot change reservation from '${currentStatus}' to '${newStatus}'. Allowed transitions: [${allowed.join(', ')}]`,
      400
    );
  }

  const result = await db.query(
    `UPDATE reservations
     SET status = $1
     WHERE id = $2
     RETURNING *`,
    [newStatus, reservationId]
  );

  return result.rows[0];
};

module.exports = {
  getTables,
  checkAvailability,
  createReservation,
  getReservations,
  updateReservationStatus,
  RESERVATION_TRANSITIONS,
};
