const express = require('express');
const router = express.Router();
const financialController = require('./financialController');
const { verifyToken, requireRole } = require('../../middleware/authAspect');

// RBAC Role Guard: Strictly restricted to ['ADMIN', 'MANAGER']
router.use(verifyToken);
router.use(requireRole(['ADMIN', 'MANAGER']));

// Summary & Metrics
router.get('/summary', financialController.getSummary);
router.get('/reports/summary', financialController.getSummary);
router.get('/reports/export', financialController.exportReport);
router.get('/export', financialController.exportReport);

// Expenses Ledger & Payroll
router.get('/expenses', financialController.getExpenses);
router.post('/expenses', financialController.createExpense);
router.delete('/expenses/:id', financialController.deleteExpense);

module.exports = router;
