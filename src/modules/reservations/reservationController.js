const reservationsService = require('./reservationService');
const { AppError } = require('../../middleware/errorAspect');

/**
 * GET /api/reservations/tables
 */
const getTables = async (req, res, next) => {
  try {
    const tables = await reservationsService.getTables();
    res.status(200).json({
      success: true,
      data: tables,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/reservations/check-availability?date=YYYY-MM-DD&time=HH:mm
 * Dynamic availability endpoint for the 3 seating halls & 12 tables
 */
const checkDynamicAvailability = async (req, res, next) => {
  try {
    const { date, time, reservationTime, reservation_time } = req.query;
    const resolvedTime = time || reservationTime || reservation_time || '12:30';
    const resolvedDate = date || (typeof resolvedTime === 'string' && resolvedTime.includes('T') ? resolvedTime.split('T')[0] : new Date().toISOString().split('T')[0]);

    const availability = await reservationsService.checkDynamicAvailability(resolvedDate, resolvedTime);

    // Return direct structured response as requested
    res.status(200).json(availability);
  } catch (error) {
    next(error);
  }
};

/**
 * Legacy / Party Size Availability Endpoint
 * GET /api/reservations/availability?time=...&partySize=...
 */
const checkAvailability = async (req, res, next) => {
  try {
    const { time, partySize } = req.query;
    if (!time || !partySize) {
      throw new AppError('time and partySize query parameters are required.', 400);
    }

    const availableTables = await reservationsService.checkAvailability(
      time,
      parseInt(partySize, 10)
    );

    res.status(200).json({
      success: true,
      availableCount: availableTables.length,
      data: availableTables,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/reservations
 */
const createReservation = async (req, res, next) => {
  try {
    const {
      tableId,
      partySize,
      reservationTime,
      specialRequests,
      userName,
      user_name,
      customerName,
      customer_name,
      patronName,
      patron_name,
      guest,
      name,
      phone,
      email,
      hallName,
      tableNumber,
    } = req.body;

    if (!reservationTime) {
      throw new AppError('reservationTime is required.', 400);
    }

    const resolvedName = userName || user_name || customerName || customer_name || patronName || patron_name || guest || name || (req.user ? req.user.displayName : null);

    const reservation = await reservationsService.createReservation(req.user ? req.user.id : null, {
      tableId: tableId ? parseInt(tableId, 10) : null,
      partySize: parseInt(partySize || 2, 10),
      reservationTime,
      specialRequests,
      patronName: resolvedName,
      userName: resolvedName,
      customerName: resolvedName,
      phone: phone || (req.user ? req.user.phone : null),
      email: email || (req.user ? req.user.email : null),
      hallName,
      tableNumber,
    });

    res.status(201).json({
      success: true,
      message: 'Reservation requested successfully.',
      data: reservation,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/reservations
 */
const getReservations = async (req, res, next) => {
  try {
    const { status, date, startDate, endDate } = req.query;
    const reservations = await reservationsService.getReservations(req.user, { status, date, startDate, endDate });
    res.status(200).json({
      success: true,
      count: reservations.length,
      data: reservations,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Generate Comprehensive Daily Reservations & Seating Report
 * GET /api/reservations/reports/daily?date=YYYY-MM-DD
 */
const getDailyReservationsReport = async (req, res, next) => {
  try {
    const { date } = req.query;
    const report = await reservationsService.getDailyReservationsReport(date);

    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/reservations/:id/status
 */
const updateStatus = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid reservation ID.', 400);
    }

    const { status } = req.body;
    if (!status) {
      throw new AppError('status is required.', 400);
    }

    const updated = await reservationsService.updateReservationStatus(id, status);
    res.status(200).json({
      success: true,
      message: `Reservation status transitioned to ${status}.`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/reservations/tables/:id/status
 * PUT /api/reservations/tables/:id
 * Admin table status toggle and instant release endpoint
 */
const updateTableStatus = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid table ID.', 400);
    }

    const { status } = req.body;
    if (!status) {
      throw new AppError('Status is required.', 400);
    }

    const validStatuses = ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'COMPLETED'];
    const normalizedStatus = String(status).toUpperCase().trim();
    if (!validStatuses.includes(normalizedStatus)) {
      throw new AppError(`Invalid table status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const updated = await reservationsService.updateTableStatus(id, normalizedStatus);
    res.status(200).json({
      success: true,
      message: `Table status updated to ${normalizedStatus === 'COMPLETED' ? 'AVAILABLE' : normalizedStatus}.`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/reservations/:id
 * Permanently delete reservation and release table to AVAILABLE
 */
const deleteReservation = async (req, res, next) => {
  try {
    const targetId = req.params.id;
    console.log('[DELETE RESERVATION] Received ID param:', targetId);

    if (!targetId || String(targetId).trim() === '') {
      throw new AppError('Reservation identifier is required.', 400);
    }

    const result = await reservationsService.deleteReservation(targetId);
    return res.status(200).json({
      success: true,
      message: 'Reservation deleted and table released to Available. Permanently purged from database.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/reservations/:id/depart
 * Mark reservation as departed (COMPLETED) and release table to AVAILABLE
 */
const markDeparted = async (req, res, next) => {
  try {
    const targetId = req.params.id;
    console.log('[DEPART RESERVATION] Received ID param:', targetId);

    if (!targetId || String(targetId).trim() === '') {
      throw new AppError('Reservation identifier is required.', 400);
    }

    const updated = await reservationsService.markDeparted(targetId);
    return res.status(200).json({
      success: true,
      message: 'Reservation marked as departed and table released to Available.',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/reservations/admin-book
 * Admin manual booking endpoint
 */
const adminBookReservation = async (req, res, next) => {
  try {
    const created = await reservationsService.adminBookReservation(req.body);
    res.status(201).json({
      success: true,
      message: 'Admin reservation created successfully.',
      data: created,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTables,
  checkDynamicAvailability,
  checkAvailability,
  createReservation,
  getReservations,
  getDailyReservationsReport,
  updateStatus,
  updateTableStatus,
  deleteReservation,
  markDeparted,
  adminBookReservation,
};
