const express = require('express');
const router = express.Router();
const reservationsController = require('./reservationController');
const { optionalToken } = require('../../middleware/authAspect');

// 1. Real-time table availability check (Public)
router.get('/check-availability', reservationsController.checkDynamicAvailability);
router.get('/availability', reservationsController.checkAvailability);
router.get('/tables', reservationsController.getTables);

// 2. Admin table status toggle & instant live table release
router.put('/tables/:id/status', reservationsController.updateTableStatus);
router.put('/tables/:id', reservationsController.updateTableStatus);

// 3. Admin manual booking & table release workflows
router.post('/admin-book', reservationsController.adminBookReservation);
router.put('/:id/depart', reservationsController.markDeparted);
router.patch('/:id/depart', reservationsController.markDeparted);
router.delete('/:id', reservationsController.deleteReservation);

// 4. Booking & list retrieval (with optional user context)
router.use(optionalToken);
router.post('/', reservationsController.createReservation);
router.get('/', reservationsController.getReservations);

// 5. Status transition
router.patch('/:id/status', reservationsController.updateStatus);
router.put('/:id/status', reservationsController.updateStatus);

module.exports = router;
