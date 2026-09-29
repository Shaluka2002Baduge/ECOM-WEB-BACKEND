const db = require('../../config/db');
const ordersService = require('../orders/orderService');

/**
 * Administrative Overview / Dashboard Metrics
 * Restricted strictly to ADMIN and MANAGER
 */
const getDashboardStats = async (req, res, next) => {
  try {
    const [usersCount, ordersStats, lowStockCount, reservationsCount] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total_users, role, COUNT(*)::int AS role_count FROM users GROUP BY role`),
      db.query(`SELECT COUNT(*)::int AS total_orders, COALESCE(SUM(total_amount), 0)::numeric AS total_revenue, status FROM orders GROUP BY status`),
      db.query(`SELECT COUNT(*)::int AS low_stock_items FROM inventory_items WHERE current_stock <= minimum_threshold`),
      db.query(`SELECT COUNT(*)::int AS total_reservations, status FROM reservations GROUP BY status`),
    ]);

    const totalUsers = usersCount.rows.reduce((sum, r) => sum + r.role_count, 0);
    const usersByRole = usersCount.rows.reduce((acc, r) => {
      acc[r.role] = r.role_count;
      return acc;
    }, {});

    const totalOrders = ordersStats.rows.reduce((sum, r) => sum + r.total_orders, 0);
    const totalRevenue = ordersStats.rows.reduce((sum, r) => sum + parseFloat(r.total_revenue), 0);
    const ordersByStatus = ordersStats.rows.reduce((acc, r) => {
      acc[r.status] = r.total_orders;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      message: 'Admin dashboard statistics retrieved successfully.',
      data: {
        users: {
          total: totalUsers,
          breakdown: usersByRole,
        },
        orders: {
          total: totalOrders,
          totalRevenue: totalRevenue.toFixed(2),
          breakdown: ordersByStatus,
        },
        inventory: {
          lowStockAlerts: lowStockCount.rows[0]?.low_stock_items || 0,
        },
        reservations: {
          breakdown: reservationsCount.rows.reduce((acc, r) => {
            acc[r.status] = r.total_reservations;
            return acc;
          }, {}),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve all registered users with their assigned virtual roles
 * Restricted strictly to ADMIN and MANAGER
 */
const getAdminUsers = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, display_name, email, role, phone, created_at, updated_at
       FROM users
       ORDER BY created_at DESC`
    );

    res.status(200).json({
      success: true,
      message: 'System user directory retrieved successfully.',
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Server system and operational health diagnostics
 * Restricted strictly to ADMIN and MANAGER
 */
const getSystemHealth = async (req, res, next) => {
  try {
    const dbCheck = await db.query('SELECT NOW() AS server_time, version() AS pg_version');

    res.status(200).json({
      success: true,
      message: 'System operational status.',
      data: {
        status: 'OPERATIONAL',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsage: process.memoryUsage(),
        database: {
          connected: true,
          serverTime: dbCheck.rows[0]?.server_time,
          version: dbCheck.rows[0]?.pg_version,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve all orders for Admin Management
 * Uses LEFT JOIN on tables/reservations so Home Delivery and Takeaway are never omitted
 * GET /api/admin/orders
 * Restricted strictly to ADMIN and MANAGER
 */
const getAdminOrders = async (req, res, next) => {
  try {
    const { status } = req.query;
    const orders = await ordersService.getAdminOrders(status);

    res.status(200).json({
      success: true,
      message: 'Admin orders retrieved successfully.',
      count: orders.length,
      data: orders,
      orders: orders,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Unified Admin Order Status API
 * PATCH /api/admin/orders/:id/status
 * Restricted strictly to ADMIN and MANAGER
 */
const updateAdminOrderStatus = async (req, res, next) => {
  try {
    const orderId = req.params.id;
    let { status } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Order ID is required', message: 'Order ID is required' });
    }
    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required', message: 'Status is required' });
    }

    const updated = await ordersService.updateOrderStatusByAdmin(orderId, status);
    return res.status(200).json({
      success: true,
      message: `Order status successfully transitioned to ${status}.`,
      data: updated,
      order: updated,
    });
  } catch (error) {
    if (error.statusCode === 404 || error.message === 'Order not found.' || error.message === 'Order not found') {
      return res.status(404).json({ success: false, error: 'Order not found', message: 'Order not found' });
    }
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, error: error.message, message: error.message });
    }
    console.error('[STATUS UPDATE ERROR]', error);
    return res.status(500).json({ success: false, error: 'Failed to update order status', message: 'Failed to update order status' });
  }
};

module.exports = {
  getDashboardStats,
  getAdminUsers,
  getAdminOrders,
  getSystemHealth,
  updateAdminOrderStatus,
};
