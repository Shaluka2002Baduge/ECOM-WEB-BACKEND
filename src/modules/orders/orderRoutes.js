const express = require('express');
const router = express.Router();
const ordersController = require('./orderController');
const { authenticateToken, authorizeRoles } = require('../../middleware/authAspect');

// All order endpoints require authentication
router.use(authenticateToken);

// Customer & Staff routes
router.post('/', ordersController.createOrder);
router.get('/', ordersController.getOrders);
router.get('/:id', ordersController.getOrderById);

// Order status state machine transition (Staff / Kitchen / Waiter / Manager / Admin)
router.patch(
  '/:id/status',
  authorizeRoles('KITCHEN_STAFF', 'WAITER', 'MANAGER', 'ADMIN'),
  ordersController.updateOrderStatus
);

module.exports = router;
