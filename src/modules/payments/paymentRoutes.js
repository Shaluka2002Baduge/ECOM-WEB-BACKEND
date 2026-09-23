const express = require('express');
const router = express.Router();
const paymentsController = require('./paymentController');
const { authenticateToken, authorizeRoles } = require('../../middleware/authAspect');

router.use(authenticateToken);

// Record payment (Customer or Waiter/Manager)
router.post('/', paymentsController.recordPayment);
router.get('/order/:orderId', paymentsController.getOrderPayments);

// Audit report (Manager / Admin)
router.get('/', authorizeRoles('MANAGER', 'ADMIN'), paymentsController.getAllPayments);

module.exports = router;
