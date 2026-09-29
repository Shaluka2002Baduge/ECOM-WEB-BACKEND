const express = require('express');
const router = express.Router();
const adminController = require('./adminController');
const { verifyToken, requireRole } = require('../../middleware/authAspect');

// RBAC Role Guard: Strictly restricted to ['ADMIN', 'MANAGER']
router.use(verifyToken);
router.use(requireRole(['ADMIN', 'MANAGER']));

// Administrative Endpoints
router.get('/dashboard', adminController.getDashboardStats);
router.get('/users', adminController.getAdminUsers);
router.get('/system-health', adminController.getSystemHealth);
router.get('/orders', adminController.getAdminOrders);

// Unified Admin Order Status Transition Endpoints
router.patch('/orders/:id/status', adminController.updateAdminOrderStatus);
router.put('/orders/:id/status', adminController.updateAdminOrderStatus);
router.post('/orders/:id/status', adminController.updateAdminOrderStatus);
router.patch('/orders/:id', adminController.updateAdminOrderStatus);
router.put('/orders/:id', adminController.updateAdminOrderStatus);

module.exports = router;
