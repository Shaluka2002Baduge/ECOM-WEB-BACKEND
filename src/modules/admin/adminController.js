const db = require('../../config/db');

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

module.exports = {
  getDashboardStats,
  getAdminUsers,
  getSystemHealth,
};
