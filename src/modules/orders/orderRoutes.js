const express = require('express');
const router = express.Router();
const ordersController = require('./orderController');
const { verifyToken, requireRole } = require('../../middleware/authAspect');

// All order endpoints require authentication
router.use(verifyToken);

// Customer & Staff routes
router.post('/', ordersController.createOrder);
router.get('/', ordersController.getOrders);
router.get('/:id', ordersController.getOrderById);

// Order status state machine transition strictly restricted to KITCHEN_STAFF and ADMIN
router.patch(
  '/:id/status',
  requireRole(['KITCHEN_STAFF', 'ADMIN']),
  ordersController.updateOrderStatus
);

module.exports = router;

