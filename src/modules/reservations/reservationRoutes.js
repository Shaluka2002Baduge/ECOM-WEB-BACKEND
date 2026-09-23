const express = require('express');
const router = express.Router();
const reservationsController = require('./reservationController');
const { authenticateToken, authorizeRoles } = require('../../middleware/authAspect');

// Public/authenticated table availability check
router.get('/tables', reservationsController.getTables);
router.get('/availability', reservationsController.checkAvailability);

// Authenticated booking & management
router.use(authenticateToken);
router.post('/', reservationsController.createReservation);
router.get('/', reservationsController.getReservations);

// Status transition (Waiters, Managers, Admins)
router.patch(
  '/:id/status',
  authorizeRoles('WAITER', 'MANAGER', 'ADMIN'),
  reservationsController.updateStatus
);

module.exports = router;
