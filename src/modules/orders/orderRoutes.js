const express = require('express');
const router = express.Router();
const ordersController = require('./orderController');
const { verifyToken, optionalToken, requireRole } = require('../../middleware/authAspect');

// POST / allows both authenticated customers and guest checkout
router.post('/', optionalToken, ordersController.createOrder);

// GET /:id allows lookup by numeric ID or alphanumeric order number (both authenticated & guest)
router.get('/:id', optionalToken, ordersController.getOrderById);

// The following routes strictly require authenticated sessions
router.use(verifyToken);

// Customer & Staff routes
router.get('/', ordersController.getOrders);

// Order status state machine transition strictly restricted to KITCHEN_STAFF and ADMIN
router.patch(
  '/:id/status',
  requireRole(['KITCHEN_STAFF', 'ADMIN']),
  ordersController.updateOrderStatus
);

module.exports = router;

