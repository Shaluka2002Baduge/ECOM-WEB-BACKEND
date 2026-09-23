const reservationsService = require('./reservationService');
const { AppError } = require('../../middleware/errorAspect');

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

const createReservation = async (req, res, next) => {
  try {
    const { tableId, partySize, reservationTime, specialRequests } = req.body;
    if (!tableId || !partySize || !reservationTime) {
      throw new AppError('tableId, partySize, and reservationTime are required.', 400);
    }

    const reservation = await reservationsService.createReservation(req.user.id, {
      tableId: parseInt(tableId, 10),
      partySize: parseInt(partySize, 10),
      reservationTime,
      specialRequests,
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

const getReservations = async (req, res, next) => {
  try {
    const { status } = req.query;
    const reservations = await reservationsService.getReservations(req.user, status);
    res.status(200).json({
      success: true,
      count: reservations.length,
      data: reservations,
    });
  } catch (error) {
    next(error);
  }
};

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

module.exports = {
  getTables,
  checkAvailability,
  createReservation,
  getReservations,
  updateStatus,
};
