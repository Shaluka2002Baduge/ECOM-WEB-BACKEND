const express = require('express');
const router = express.Router();
const ordersController = require('./orderController');
const { verifyToken, optionalToken, requireRole } = require('../../middleware/authAspect');

// POST / allows both authenticated customers and guest checkout
router.post('/', optionalToken, ordersController.createOrder);

// GET /history/:email retrieves patron order history (all active, completed, cancelled orders)
router.get('/history/:email', optionalToken, ordersController.getOrderHistoryByEmail);
router.get('/history', optionalToken, ordersController.getOrderHistoryByEmail);

// GET /track/:identifier allows tracking order status by order ID or order number (guest & authenticated)
router.get('/track/:identifier', optionalToken, ordersController.trackOrder);
router.get('/orders/track/:identifier', optionalToken, ordersController.trackOrder);

// GET /:identifier allows lookup by numeric ID or alphanumeric order number (both authenticated & guest)
router.get('/orders/:identifier', optionalToken, ordersController.getOrderById);
router.get('/:identifier', optionalToken, ordersController.getOrderById);
router.get('/:id', optionalToken, ordersController.getOrderById);

// The following routes strictly require authenticated sessions
router.use(verifyToken);

// Customer & Staff routes
router.get('/', ordersController.getOrders);

// Order status update endpoints supported for KITCHEN_STAFF, ADMIN, and MANAGER
router.patch(
  '/:id/status',
  requireRole(['KITCHEN_STAFF', 'ADMIN', 'MANAGER']),
  ordersController.updateOrderStatus
);

router.put(
  '/:id/status',
  requireRole(['KITCHEN_STAFF', 'ADMIN', 'MANAGER']),
  ordersController.updateOrderStatus
);

router.post(
  '/:id/status',
  requireRole(['KITCHEN_STAFF', 'ADMIN', 'MANAGER']),
  ordersController.updateOrderStatus
);

router.patch(
  '/:id',
  requireRole(['KITCHEN_STAFF', 'ADMIN', 'MANAGER']),
  ordersController.updateOrderStatus
);

router.put(
  '/:id',
  requireRole(['KITCHEN_STAFF', 'ADMIN', 'MANAGER']),
  ordersController.updateOrderStatus
);

module.exports = router;

