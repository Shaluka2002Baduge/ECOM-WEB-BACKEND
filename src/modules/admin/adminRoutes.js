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

module.exports = router;
