const financialService = require('./financialService');

/**
 * Financial Controller for Admin SaaS Engine
 */
class FinancialController {
  /**
   * GET /api/admin/financials/summary
   * GET /api/financials/summary
   */
  async getSummary(req, res, next) {
    try {
      const { range, startDate, endDate } = req.query;
      const summary = await financialService.getFinancialSummary({ range, startDate, endDate });

      res.status(200).json({
        success: true,
        message: 'Financial summary calculated successfully.',
        data: summary,
        summary: summary
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/admin/financials/expenses
   */
  async getExpenses(req, res, next) {
    try {
      const { category, startDate, endDate, limit, offset } = req.query;
      const result = await financialService.getExpenses({
        category,
        startDate,
        endDate,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0
      });

      res.status(200).json({
        success: true,
        message: 'Expense ledger retrieved successfully.',
        data: result.expenses,
        total: result.total,
        expenses: result.expenses
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/admin/financials/expenses
   */
  async createExpense(req, res, next) {
    try {
      const { title, category, amount, description, payment_method, expense_date } = req.body;
      const recorded_by = req.user?.displayName || req.user?.email || 'Admin';

      const created = await financialService.createExpense({
        title,
        category,
        amount,
        description,
        payment_method,
        recorded_by,
        expense_date
      });

      res.status(201).json({
        success: true,
        message: 'Expense recorded successfully.',
        data: created
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/admin/financials/expenses/:id
   */
  async deleteExpense(req, res, next) {
    try {
      const { id } = req.params;
      const result = await financialService.deleteExpense(id);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/admin/financials/reports/export
   * GET /api/financials/reports/export
   */
  async exportReport(req, res, next) {
    try {
      const { range, startDate, endDate } = req.query;
      const exportPayload = await financialService.exportFinancialReport({ range, startDate, endDate });

      res.status(200).json(exportPayload);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new FinancialController();
