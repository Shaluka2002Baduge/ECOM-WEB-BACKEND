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
router.get('/orders/reports/daily', adminController.getDailyOrdersReport);
router.get('/orders/daily-report', adminController.getDailyOrdersReport);

// Admin Inquiries Endpoints
const inquiryController = require('../inquiries/inquiryController');
router.get('/inquiries', inquiryController.getAllInquiries);
router.get('/inquiries/:id', inquiryController.getInquiryById);
router.patch('/inquiries/:id', inquiryController.replyToInquiry);
router.put('/inquiries/:id', inquiryController.replyToInquiry);
router.post('/inquiries/:id/reply', inquiryController.replyToInquiry);
router.delete('/inquiries/:id', inquiryController.deleteInquiry);

// Admin Staff Management Endpoints
const staffController = require('../staff/staffController');
router.get('/staff', staffController.getStaff);
router.get('/staff/:id', staffController.getStaffById);
router.post('/staff', staffController.createStaff);
router.patch('/staff/:id', staffController.updateStaff);
router.put('/staff/:id', staffController.updateStaff);
router.patch('/staff/:id/role', staffController.updateRole);
router.delete('/staff/:id', staffController.deleteStaff);

// Admin Financials & Reports Engine Endpoints
const financialController = require('../financials/financialController');
router.get('/financials/summary', financialController.getSummary);
router.get('/financials/reports/export', financialController.exportReport);
router.get('/financials/export', financialController.exportReport);
router.get('/financials/expenses', financialController.getExpenses);
router.post('/financials/expenses', financialController.createExpense);
router.delete('/financials/expenses/:id', financialController.deleteExpense);
router.get('/reports/summary', financialController.getSummary);
router.get('/reports/export', financialController.exportReport);

// Admin Settings & Profile Security Endpoints
const settingsController = require('../settings/settingsController');
router.get('/settings', settingsController.getSettings);
router.put('/settings', settingsController.updateSettings);
router.patch('/settings', settingsController.updateSettings);
router.put('/settings/password', settingsController.updateAdminPassword);
router.patch('/settings/password', settingsController.updateAdminPassword);

// Unified Admin Order Status Transition Endpoints
router.patch('/orders/:id/status', adminController.updateAdminOrderStatus);
router.put('/orders/:id/status', adminController.updateAdminOrderStatus);
router.post('/orders/:id/status', adminController.updateAdminOrderStatus);
router.patch('/orders/:id', adminController.updateAdminOrderStatus);
router.put('/orders/:id', adminController.updateAdminOrderStatus);

module.exports = router;

