const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');

const RESERVATION_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SEATED', 'COMPLETED', 'CANCELLED'],
  SEATED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [], // Terminal
  CANCELLED: [], // Terminal
};

const HALL_NAMES = ['Royal Dining Hall', 'Balcony Court', 'Private Suite'];
const DEFAULT_TABLE_NUMBERS = ['Table 1', 'Table 2', 'Table 3', 'Table 4'];

/**
 * Validates operating hours: strictly 12:30 PM to 11:30 PM (12:30 to 23:30)
 */
const isOperatingHours = (timeStr) => {
  if (!timeStr) return false;
  let t = String(timeStr).trim();
  if (t.includes('T')) {
    t = t.split('T')[1];
  }
  const match = t.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return false;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const totalMinutes = hours * 60 + minutes;
  const openMinutes = 12 * 60 + 30; // 12:30 -> 750
  const closeMinutes = 23 * 60 + 30; // 23:30 -> 1410
  return totalMinutes >= openMinutes && totalMinutes <= closeMinutes;
};

/**
 * List all active tables
 */
const getTables = async () => {
  const result = await db.query(
    `SELECT id, hall_name, table_number, capacity, seating_capacity, location_description, is_active, status 
     FROM tables 
     ORDER BY id ASC`
  );
  return result.rows;
};

/**
 * Dynamic Dine-in Real-Time Table Availability Checker
 * Evaluates 3 Seating Halls with 4 Tables each (12 tables total)
 * Buffer window: 90 minutes. Operating hours: 12:30 - 23:30.
 * COMPLETED/CANCELLED reservations or tables marked AVAILABLE do NOT block bookings.
 */
const checkDynamicAvailability = async (dateStr, timeStr) => {
  let normalizedDate = dateStr;
  let normalizedTime = timeStr;

  if (!normalizedDate && normalizedTime && String(normalizedTime).includes('T')) {
    const parts = String(normalizedTime).split('T');
    normalizedDate = parts[0];
    normalizedTime = parts[1].substring(0, 5);
  } else if (!normalizedDate) {
    normalizedDate = new Date().toISOString().split('T')[0];
  }

  if (!normalizedTime) {
    normalizedTime = '12:30';
  } else if (String(normalizedTime).includes('T')) {
    normalizedTime = String(normalizedTime).split('T')[1].substring(0, 5);
  } else if (String(normalizedTime).length > 5) {
    normalizedTime = String(normalizedTime).substring(0, 5);
  }

  const withinHours = isOperatingHours(normalizedTime);

  if (!withinHours) {
    const halls = {};
    for (const hall of HALL_NAMES) {
      halls[hall] = {
        isFullyBooked: true,
        tables: DEFAULT_TABLE_NUMBERS.map((tableNum) => ({
          tableNumber: tableNum,
          available: false,
          reason: 'Outside operating hours (12:30 - 23:30)',
        })),
      };
    }
    return {
      isWithinHours: false,
      halls,
    };
  }

  // Fetch all tables from database
  const tablesResult = await db.query(
    'SELECT id, hall_name, table_number, capacity, seating_capacity, status FROM tables ORDER BY id ASC'
  );
  const allTables = tablesResult.rows;

  // Reservation dining window: 90 minutes
  const targetDateTime = new Date(`${normalizedDate}T${normalizedTime}:00`);
  const windowStart = new Date(targetDateTime.getTime() - 90 * 60 * 1000);
  const windowEnd = new Date(targetDateTime.getTime() + 90 * 60 * 1000);

  // Active reservations that overlap within 90 minutes
  const resResult = await db.query(
    `SELECT id, table_id, hall_name, table_number, status, reservation_time, reservation_date
     FROM reservations
     WHERE status IN ('CONFIRMED', 'SEATED')
       AND (
         (reservation_time >= $1 AND reservation_time <= $2)
         OR (
           (reservation_date = $3::date OR DATE(reservation_time) = $3::date)
           AND reservation_time >= $1 AND reservation_time <= $2
         )
       )`,
    [windowStart.toISOString(), windowEnd.toISOString(), normalizedDate]
  );
  const activeReservations = resResult.rows;

  const halls = {};

  for (const hall of HALL_NAMES) {
    const hallDbTables = allTables.filter((t) => (t.hall_name || '').toLowerCase() === hall.toLowerCase());

    const tables = DEFAULT_TABLE_NUMBERS.map((tableNum, idx) => {
      const dbTable = hallDbTables.find(
        (t) => (t.table_number || '').toLowerCase() === tableNum.toLowerCase()
      ) || hallDbTables[idx];

      const tableId = dbTable ? dbTable.id : null;
      const dbStatus = dbTable ? (dbTable.status || 'AVAILABLE').toUpperCase() : 'AVAILABLE';

      // If marked OCCUPIED or RESERVED in tables
      if (dbStatus === 'OCCUPIED') {
        return {
          tableNumber: tableNum,
          available: false,
          reason: 'Occupied',
        };
      }

      if (dbStatus === 'RESERVED') {
        return {
          tableNumber: tableNum,
          available: false,
          reason: 'Reserved',
        };
      }

      // Check active overlapping reservation
      const isBooked = activeReservations.some((r) => {
        if (tableId && r.table_id === tableId) return true;
        const rHall = (r.hall_name || '').toLowerCase();
        const rNum = (r.table_number || '').toLowerCase();
        return rHall === hall.toLowerCase() && rNum === tableNum.toLowerCase();
      });

      if (isBooked) {
        return {
          tableNumber: tableNum,
          available: false,
          reason: 'Booked',
        };
      }

      return {
        tableNumber: tableNum,
        available: true,
      };
    });

    const isFullyBooked = tables.every((t) => !t.available);

    halls[hall] = {
      isFullyBooked,
      tables,
    };
  }

  return {
    isWithinHours: true,
    halls,
  };
};

/**
 * Update dining table status with instant release workflow
 * When marked AVAILABLE or COMPLETED, active reservations are marked COMPLETED and table becomes AVAILABLE
 */
const updateTableStatus = async (tableId, status) => {
  const tableCheck = await db.query(
    'SELECT id, hall_name, table_number, seating_capacity, capacity, status FROM tables WHERE id = $1',
    [tableId]
  );
  if (tableCheck.rows.length === 0) {
    throw new AppError('Table not found.', 404);
  }

  const table = tableCheck.rows[0];
  const normalizedStatus = String(status || '').toUpperCase().trim();

  if (normalizedStatus === 'AVAILABLE' || normalizedStatus === 'COMPLETED') {
    // 1. Release table in database
    const updatedTable = await db.query(
      `UPDATE tables
       SET status = 'AVAILABLE',
           is_active = TRUE
       WHERE id = $1
       RETURNING id, hall_name, table_number, seating_capacity, capacity, location_description, is_active, status`,
      [tableId]
    );

    // 2. Transition active reservations on this table to COMPLETED
    await db.query(
      `UPDATE reservations
       SET status = 'COMPLETED',
           updated_at = CURRENT_TIMESTAMP
       WHERE (
         table_id = $1
         OR (LOWER(hall_name) = LOWER($2) AND LOWER(table_number) = LOWER($3))
       )
       AND status IN ('CONFIRMED', 'SEATED', 'PENDING')`,
      [tableId, table.hall_name || '', table.table_number || '']
    );

    return updatedTable.rows[0];
  } else {
    // RESERVED or OCCUPIED
    const updatedTable = await db.query(
      `UPDATE tables
       SET status = $1,
           is_active = CASE WHEN $1 = 'OCCUPIED' THEN FALSE ELSE TRUE END
       WHERE id = $2
       RETURNING id, hall_name, table_number, seating_capacity, capacity, location_description, is_active, status`,
      [normalizedStatus, tableId]
    );

    return updatedTable.rows[0];
  }
};

/**
 * Check collision/conflict for a specific hall and table in a 90-minute window
 * Strictly ignores CANCELLED and COMPLETED bookings (only blocks if status IN ('CONFIRMED', 'SEATED'))
 */
const checkTableConflict = async ({ hallName, tableNumber, tableId, reservationTime, reservationDate }) => {
  let targetTime;
  if (!reservationTime) {
    targetTime = new Date();
  } else if (reservationTime instanceof Date) {
    targetTime = reservationTime;
  } else {
    const timeStr = String(reservationTime).trim();
    if (timeStr.includes('T')) {
      targetTime = new Date(timeStr);
    } else {
      const datePart = reservationDate || new Date().toISOString().split('T')[0];
      const formattedTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
      targetTime = new Date(`${datePart}T${formattedTime}`);
    }
  }

  if (isNaN(targetTime.getTime())) {
    return { hasConflict: true, message: 'Invalid reservation date and time.' };
  }

  const windowStart = new Date(targetTime.getTime() - 90 * 60 * 1000);
  const windowEnd = new Date(targetTime.getTime() + 90 * 60 * 1000);

  let dbTable = null;
  if (tableId) {
    const res = await db.query('SELECT * FROM tables WHERE id = $1', [tableId]);
    dbTable = res.rows[0];
  } else if (hallName && tableNumber) {
    const res = await db.query(
      'SELECT * FROM tables WHERE LOWER(hall_name) = LOWER($1) AND LOWER(table_number) = LOWER($2) LIMIT 1',
      [hallName, tableNumber]
    );
    dbTable = res.rows[0];
  }

  const conflictRes = await db.query(
    `SELECT r.id, r.status FROM reservations r
     LEFT JOIN tables t ON r.table_id = t.id
     WHERE (
       (r.table_id = $1 AND $1 IS NOT NULL)
       OR (LOWER(r.hall_name) = LOWER($2) AND LOWER(r.table_number) = LOWER($3))
       OR (LOWER(t.hall_name) = LOWER($2) AND LOWER(t.table_number) = LOWER($3))
     )
     AND r.status IN ('CONFIRMED', 'SEATED')
     AND r.reservation_time >= $4
     AND r.reservation_time <= $5
     LIMIT 1`,
    [
      dbTable ? dbTable.id : null,
      hallName || (dbTable ? dbTable.hall_name : ''),
      tableNumber || (dbTable ? dbTable.table_number : ''),
      windowStart.toISOString(),
      windowEnd.toISOString(),
    ]
  );

  if (conflictRes.rows.length > 0) {
    return {
      hasConflict: true,
      message: 'This table is already booked for this time slot. Please choose another table or time.',
    };
  }

  return { hasConflict: false, table: dbTable };
};

/**
 * Legacy/Standard availability check by party size
 */
const checkAvailability = async (reservationTime, partySize) => {
  const reqTime = new Date(reservationTime);
  if (isNaN(reqTime.getTime())) {
    throw new AppError('Invalid reservation date and time.', 400);
  }

  const windowStart = new Date(reqTime.getTime() - 90 * 60 * 1000);
  const windowEnd = new Date(reqTime.getTime() + 90 * 60 * 1000);

  const result = await db.query(
    `SELECT t.id, t.hall_name, t.table_number, t.capacity, t.seating_capacity, t.location_description, t.status
     FROM tables t
     WHERE t.is_active = TRUE
       AND COALESCE(t.capacity, t.seating_capacity) >= $1
       AND t.id NOT IN (
         SELECT r.table_id
         FROM reservations r
         WHERE r.table_id IS NOT NULL
           AND r.status IN ('PENDING', 'CONFIRMED', 'SEATED')
           AND r.reservation_time >= $2
           AND r.reservation_time <= $3
       )
     ORDER BY COALESCE(t.capacity, t.seating_capacity) ASC`,
    [partySize, windowStart.toISOString(), windowEnd.toISOString()]
  );

  return result.rows;
};

/**
 * Create a new table reservation
 */
const createReservation = async (
  userId,
  { tableId, partySize, reservationTime, specialRequests, patronName = null, phone = null, email = null, hallName = null, tableNumber = null }
) => {
  const targetDate = new Date(reservationTime);
  if (targetDate <= new Date()) {
    throw new AppError('Reservation time must be in the future.', 400);
  }

  const conflictCheck = await checkTableConflict({
    hallName,
    tableNumber,
    tableId,
    reservationTime,
  });

  if (conflictCheck.hasConflict) {
    throw new AppError(conflictCheck.message, 409);
  }

  const dbTable = conflictCheck.table;

  const result = await db.query(
    `INSERT INTO reservations (
       user_id, table_id, hall_name, table_number, party_size, reservation_date, reservation_time,
       status, special_requests, patron_name, phone, email
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9, $10, $11)
     RETURNING *`,
    [
      userId || null,
      tableId || (dbTable ? dbTable.id : null),
      hallName || (dbTable ? dbTable.hall_name : null),
      tableNumber || (dbTable ? dbTable.table_number : null),
      partySize,
      targetDate.toISOString().split('T')[0],
      targetDate.toISOString(),
      specialRequests || null,
      patronName,
      phone,
      email,
    ]
  );

  return result.rows[0];
};

/**
 * Create a live confirmed reservation entry for Dine-In orders
 */
const createDineInReservation = async ({
  userId = null,
  orderId = null,
  patronName,
  phone,
  email = null,
  partySize = 2,
  reservationDate = null,
  reservationTime,
  hallName = 'Royal Dining Hall',
  tableNumber = 'Table 1',
  tableId = null,
  specialRequests = null,
  bookingSource = 'Online Order Checkout',
}) => {
  let assignedTableId = tableId;
  let resolvedHall = hallName || 'Royal Dining Hall';
  let resolvedTableNumber = tableNumber || 'Table 1';

  if (!assignedTableId && resolvedHall && resolvedTableNumber) {
    const tableRes = await db.query(
      'SELECT id, hall_name, table_number FROM tables WHERE LOWER(hall_name) = LOWER($1) AND LOWER(table_number) = LOWER($2) LIMIT 1',
      [resolvedHall, resolvedTableNumber]
    );
    if (tableRes.rows.length > 0) {
      assignedTableId = tableRes.rows[0].id;
      resolvedHall = tableRes.rows[0].hall_name;
      resolvedTableNumber = tableRes.rows[0].table_number;
    }
  } else if (assignedTableId) {
    const tableRes = await db.query('SELECT hall_name, table_number FROM tables WHERE id = $1', [assignedTableId]);
    if (tableRes.rows.length > 0) {
      resolvedHall = tableRes.rows[0].hall_name || resolvedHall;
      resolvedTableNumber = tableRes.rows[0].table_number || resolvedTableNumber;
    }
  }

  const dateVal = reservationDate || new Date().toISOString().split('T')[0];
  let targetTime = new Date();
  if (reservationTime) {
    if (typeof reservationTime === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(reservationTime.trim())) {
      const timeStr = reservationTime.trim();
      targetTime = new Date(`${dateVal}T${timeStr.length === 5 ? timeStr + ':00' : timeStr}`);
    } else {
      const parsed = new Date(reservationTime);
      if (!isNaN(parsed.getTime())) {
        targetTime = parsed;
      }
    }
  }
  const formattedTargetTime = isNaN(targetTime.getTime()) ? new Date().toISOString() : targetTime.toISOString();

  const result = await db.query(
    `INSERT INTO reservations (
       user_id, table_id, hall_name, table_number, party_size, reservation_date,
       reservation_time, status, special_requests, patron_name, phone, email, order_id, booking_source
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'CONFIRMED', $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      userId || null,
      assignedTableId || null,
      resolvedHall,
      resolvedTableNumber,
      partySize,
      dateVal,
      formattedTargetTime,
      specialRequests || null,
      patronName || 'Valued User',
      phone || 'N/A',
      email || null,
      orderId || null,
      bookingSource || 'Online Order Checkout',
    ]
  );

  return result.rows[0];
};

/**
 * Retrieve reservations with linked order information & patron details
 * Supports user context, status filter, specific date, or date range
 */
const getReservations = async (requestingUser, statusFilterOrOptions) => {
  let status = null;
  let targetDate = null;
  let startDate = null;
  let endDate = null;

  if (typeof statusFilterOrOptions === 'object' && statusFilterOrOptions !== null) {
    status = statusFilterOrOptions.status || null;
    targetDate = statusFilterOrOptions.date || null;
    startDate = statusFilterOrOptions.startDate || null;
    endDate = statusFilterOrOptions.endDate || null;
  } else if (typeof statusFilterOrOptions === 'string') {
    status = statusFilterOrOptions;
  }

  let queryText = `
    SELECT r.*, 
           t.table_number, 
           t.hall_name, 
           t.location_description,
           COALESCE(r.patron_name, u.display_name, 'Valued User') AS user_name,
           COALESCE(r.patron_name, u.display_name, 'Valued User') AS customer_name,
           COALESCE(r.patron_name, u.display_name, 'Valued User') AS patron_name,
           COALESCE(r.email, u.email) AS customer_email,
           COALESCE(r.email, u.email) AS email,
           COALESCE(r.phone, u.phone, 'N/A') AS customer_phone,
           COALESCE(r.phone, u.phone, 'N/A') AS phone,
           COALESCE(o.order_number, CAST(r.order_id AS VARCHAR)) AS order_id,
           r.order_id AS order_id_pk,
           o.order_number
    FROM reservations r
    LEFT JOIN tables t ON r.table_id = t.id
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN orders o ON r.order_id = o.id
    WHERE 1=1
  `;
  const params = [];

  if (requestingUser && requestingUser.role === 'CUSTOMER') {
    params.push(requestingUser.id);
    queryText += ` AND r.user_id = $${params.length}`;
  }

  if (status) {
    params.push(status);
    queryText += ` AND r.status = $${params.length}`;
  }

  if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(String(targetDate).trim())) {
    const d = String(targetDate).trim();
    params.push(d, `${d} 00:00:00`, `${d} 23:59:59`);
    queryText += ` AND (r.reservation_date = $${params.length - 2} OR (r.reservation_time >= $${params.length - 1} AND r.reservation_time <= $${params.length}))`;
  } else if (startDate && endDate) {
    params.push(startDate, endDate, `${startDate} 00:00:00`, `${endDate} 23:59:59`);
    queryText += ` AND ((r.reservation_date >= $${params.length - 3} AND r.reservation_date <= $${params.length - 2}) OR (r.reservation_time >= $${params.length - 1} AND r.reservation_time <= $${params.length}))`;
  }

  queryText += ' ORDER BY r.reservation_time ASC';

  const result = await db.query(queryText, params);
  return result.rows;
};

/**
 * Generate Comprehensive Daily Reservations & Seating Report
 * @param {string} date - 'YYYY-MM-DD'
 */
const getDailyReservationsReport = async (date) => {
  const resolvedDate = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) 
    ? date.trim() 
    : new Date().toISOString().split('T')[0];

  const reservations = await getReservations(null, { date: resolvedDate });

  const totalBookings = reservations.length;
  let totalGuests = 0;
  let completedCount = 0;
  let seatedCount = 0;
  let confirmedCount = 0;
  let pendingCount = 0;
  let cancelledCount = 0;

  const hallStats = {
    'Royal Dining Hall': { bookings: 0, guests: 0 },
    'Balcony Court': { bookings: 0, guests: 0 },
    'Private Suite': { bookings: 0, guests: 0 }
  };

  reservations.forEach(r => {
    const size = parseInt(r.party_size || 2, 10);
    const hall = r.hall_name || 'Royal Dining Hall';

    if (r.status === 'CANCELLED') {
      cancelledCount++;
    } else {
      totalGuests += size;
      if (r.status === 'COMPLETED') completedCount++;
      else if (r.status === 'SEATED') seatedCount++;
      else if (r.status === 'CONFIRMED') confirmedCount++;
      else if (r.status === 'PENDING') pendingCount++;

      if (hallStats[hall]) {
        hallStats[hall].bookings++;
        hallStats[hall].guests += size;
      }
    }
  });

  return {
    success: true,
    reportType: 'DAILY_RESERVATIONS_SEATING_REPORT',
    date: resolvedDate,
    formattedDate: new Date(resolvedDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    generatedAt: new Date().toISOString(),
    summary: {
      totalBookings,
      totalGuests,
      activeGuests: totalGuests,
      completedCount,
      seatedCount,
      confirmedCount,
      pendingCount,
      cancelledCount,
      halls: hallStats
    },
    reservations
  };
};

/**
 * Update reservation status with state machine checks & automatic table release
 */
const updateReservationStatus = async (reservationId, newStatus) => {
  const currentResult = await db.query('SELECT * FROM reservations WHERE id = $1', [reservationId]);
  if (currentResult.rows.length === 0) {
    throw new AppError('Reservation not found.', 404);
  }

  const reservation = currentResult.rows[0];
  const currentStatus = reservation.status;
  const allowed = RESERVATION_TRANSITIONS[currentStatus] || [];

  if (!allowed.includes(newStatus)) {
    throw new AppError(
      `Invalid state transition: Cannot change reservation from '${currentStatus}' to '${newStatus}'. Allowed transitions: [${allowed.join(', ')}]`,
      400
    );
  }

  const result = await db.query(
    `UPDATE reservations
     SET status = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING *`,
    [newStatus, reservationId]
  );

  // If transitioning to COMPLETED or CANCELLED, immediately release table to AVAILABLE
  if (newStatus === 'COMPLETED' || newStatus === 'CANCELLED') {
    const tableId = reservation.table_id;
    const hallName = reservation.hall_name;
    const tableNumber = reservation.table_number;

    if (tableId || (hallName && tableNumber)) {
      await db.query(
        `UPDATE tables
         SET status = 'AVAILABLE',
             is_active = TRUE
         WHERE (id = $1 AND $1 IS NOT NULL)
            OR (LOWER(hall_name) = LOWER($2) AND LOWER(table_number) = LOWER($3))`,
        [tableId || null, hallName || '', tableNumber || '']
      );
    }
  }

  return result.rows[0];
};

/**
 * Permanently delete a reservation and immediately release the table to AVAILABLE
 * DELETE /api/reservations/:id
 */
const deleteReservation = async (targetId) => {
  const targetIdentifier = String(targetId || '').trim();
  console.log('[DELETE RESERVATION] Received ID param:', targetIdentifier);

  // 1. Try to find the linked order or reservation
  // Look into orders table first if it starts with DINE or matches order_number
  const orderLookup = await db.query(
    `SELECT id, order_number FROM orders WHERE order_number = $1 OR id::text = $1`,
    [targetIdentifier]
  );

  let linkedOrderId = orderLookup.rows.length > 0 ? orderLookup.rows[0].id : null;
  let linkedOrderNumber = orderLookup.rows.length > 0 ? orderLookup.rows[0].order_number : targetIdentifier;

  // 2. Fetch reservation details to release the table
  const resLookup = await db.query(
    `SELECT id, hall_name, table_number, table_id, order_id FROM reservations 
     WHERE id::text = $1 OR order_id::text = $1 OR (order_id = $2 AND $2 IS NOT NULL)`,
    [targetIdentifier, linkedOrderId]
  );

  let hallName = null;
  let tableNumber = null;
  let tableId = null;

  if (resLookup.rows.length > 0) {
    const resRow = resLookup.rows[0];
    hallName = resRow.hall_name;
    tableNumber = resRow.table_number;
    tableId = resRow.table_id;
    if (!linkedOrderId && resRow.order_id) {
      linkedOrderId = resRow.order_id;
    }

    // Free table
    if (tableId || (hallName && tableNumber)) {
      await db.query(
        `UPDATE tables 
         SET status = 'AVAILABLE', is_active = TRUE 
         WHERE (id = $1 AND $1 IS NOT NULL) 
            OR (LOWER(hall_name) = LOWER($2) AND LOWER(table_number) = LOWER($3))`,
        [tableId || null, hallName || '', tableNumber || '']
      );
    }
  }

  // 3. HARD DELETE FROM RESERVATIONS
  await db.query(
    `DELETE FROM reservations WHERE id::text = $1 OR order_id::text = $1 OR (order_id = $2 AND $2 IS NOT NULL)`,
    [targetIdentifier, linkedOrderId]
  );

  // 4. HARD DELETE OR CANCEL FROM ORDERS SO IT NEVER RESURRECTS
  if (linkedOrderId || linkedOrderNumber) {
    if (linkedOrderId) {
      await db.query(`DELETE FROM payments WHERE order_id = $1`, [linkedOrderId]).catch(() => {});
      await db.query(`DELETE FROM order_items WHERE order_id = $1`, [linkedOrderId]).catch(() => {});
    }
    await db.query(
      `DELETE FROM orders WHERE order_number = $1 OR id::text = $1 OR (id = $2 AND $2 IS NOT NULL)`,
      [linkedOrderNumber, linkedOrderId]
    ).catch(() => {});
  }

  return {
    deletedIdentifier: targetIdentifier,
    linkedOrderId,
    hallName,
    tableNumber,
  };
};

/**
 * Mark reservation as DEPARTED (COMPLETED) and immediately release the table to AVAILABLE
 * PUT /api/reservations/:id/depart
 */
const markDeparted = async (targetId) => {
  const targetIdentifier = String(targetId || '').trim();
  console.log('[DEPART RESERVATION] Received ID param:', targetIdentifier);

  const orderLookup = await db.query(
    `SELECT id, order_number FROM orders WHERE order_number = $1 OR id::text = $1`,
    [targetIdentifier]
  );

  let linkedOrderId = orderLookup.rows.length > 0 ? orderLookup.rows[0].id : null;

  const resLookup = await db.query(
    `SELECT id, hall_name, table_number, table_id, order_id FROM reservations 
     WHERE id::text = $1 OR order_id::text = $1 OR (order_id = $2 AND $2 IS NOT NULL)`,
    [targetIdentifier, linkedOrderId]
  );

  if (resLookup.rows.length === 0) {
    throw new AppError('Reservation not found.', 404);
  }

  const resRow = resLookup.rows[0];
  const reservationId = resRow.id;
  const hallName = resRow.hall_name;
  const tableNumber = resRow.table_number;
  const tableId = resRow.table_id;

  // 1. Update reservation status to COMPLETED
  const updatedRes = await db.query(
    `UPDATE reservations
     SET status = 'COMPLETED',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [reservationId]
  );

  // 2. Immediately execute table release
  if (tableId || (hallName && tableNumber)) {
    await db.query(
      `UPDATE tables
       SET status = 'AVAILABLE',
           is_active = TRUE
       WHERE (id = $1 AND $1 IS NOT NULL)
          OR (LOWER(hall_name) = LOWER($2) AND LOWER(table_number) = LOWER($3))`,
      [tableId || null, hallName || '', tableNumber || '']
    );
  }

  return updatedRes.rows[0];
};

/**
 * Admin manual booking endpoint: POST /api/reservations/admin-book
 * Inserts confirmed reservation with booking_source = 'Walk-In / Admin' and marks table RESERVED
 */
const adminBookReservation = async (data = {}) => {
  const patronName = data.user_name || data.userName || data.patron_name || data.patronName || data.customer_name || data.customerName || 'Walk-In Guest';
  const phone = data.phone || data.phoneNumber || data.customer_phone || 'N/A';
  const email = data.email || data.customer_email || data.customerEmail || null;
  const rawDate = data.reservation_date || data.reservationDate || data.date;
  const rawTime = data.reservation_time || data.reservationTime || data.time || '19:30';
  const hallName = data.hall_name || data.hallName || 'Royal Dining Hall';
  const tableNumber = data.table_number || data.tableNumber || 'Table 1';
  const partySize = parseInt(data.party_size || data.partySize || data.guests || 2, 10) || 2;
  const notes = data.notes || data.special_requests || data.specialRequests || '';
  const bookingSource = data.booking_source || data.bookingSource || 'Walk-In / Admin';

  const targetTime = rawTime
    ? (String(rawTime).includes('T') ? new Date(rawTime) : new Date(`${rawDate || new Date().toISOString().split('T')[0]}T${rawTime}:00`))
    : new Date();
  const dateVal = rawDate || (isNaN(targetTime.getTime()) ? new Date().toISOString().split('T')[0] : targetTime.toISOString().split('T')[0]);
  const formattedTargetTime = isNaN(targetTime.getTime()) ? new Date().toISOString() : targetTime.toISOString();

  // 1. Resolve table ID from hall_name and table_number
  let tableId = data.table_id || data.tableId || null;
  if (!tableId && hallName && tableNumber) {
    const tableRes = await db.query(
      'SELECT id, hall_name, table_number FROM tables WHERE LOWER(hall_name) = LOWER($1) AND LOWER(table_number) = LOWER($2) LIMIT 1',
      [hallName, tableNumber]
    );
    if (tableRes.rows.length > 0) {
      tableId = tableRes.rows[0].id;
    }
  }

  // 2. Insert into reservations: status = 'CONFIRMED', booking_source = 'Walk-In / Admin'
  const insertRes = await db.query(
    `INSERT INTO reservations (
       table_id, hall_name, table_number, party_size, reservation_date, reservation_time,
       status, special_requests, patron_name, phone, email, booking_source
     ) VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      tableId,
      hallName,
      tableNumber,
      partySize,
      dateVal,
      formattedTargetTime,
      notes || null,
      patronName,
      phone,
      email,
      bookingSource,
    ]
  );

  // 3. Update tables SET status = 'RESERVED' for that hall and table
  if (tableId || (hallName && tableNumber)) {
    await db.query(
      `UPDATE tables
       SET status = 'RESERVED'
       WHERE (id = $1 AND $1 IS NOT NULL)
          OR (LOWER(hall_name) = LOWER($2) AND LOWER(table_number) = LOWER($3))`,
      [tableId || null, hallName, tableNumber]
    );
  }

  return insertRes.rows[0];
};

module.exports = {
  isOperatingHours,
  getTables,
  updateTableStatus,
  checkAvailability,
  checkDynamicAvailability,
  checkTableConflict,
  createReservation,
  createDineInReservation,
  getReservations,
  getDailyReservationsReport,
  updateReservationStatus,
  deleteReservation,
  markDeparted,
  adminBookReservation,
  RESERVATION_TRANSITIONS,
};
