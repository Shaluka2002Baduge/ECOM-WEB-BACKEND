const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');
const crypto = require('crypto');

/**
 * Process a payment for an existing order
 */
const recordPayment = async ({ orderId, paymentMethod, amount }) => {
  // Check order existence and amount
  const orderResult = await db.query('SELECT id, total_amount, status FROM orders WHERE id = $1', [orderId]);
  if (orderResult.rows.length === 0) {
    throw new AppError('Order not found.', 404);
  }

  const order = orderResult.rows[0];

  // Prevent paying for already cancelled orders
  if (order.status === 'CANCELLED') {
    throw new AppError('Cannot process payment for a cancelled order.', 400);
  }

  const paymentAmount = amount !== undefined ? parseFloat(amount) : parseFloat(order.total_amount);
  const transactionReference = `TXN_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  const result = await db.query(
    `INSERT INTO payments (order_id, amount, status, payment_method, transaction_reference)
     VALUES ($1, $2, 'PAID', $3, $4)
     RETURNING *`,
    [orderId, paymentAmount, paymentMethod, transactionReference]
  );

  return result.rows[0];
};

/**
 * Get payment records for a specific order
 */
const getPaymentsByOrderId = async (orderId) => {
  const result = await db.query(
    'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC',
    [orderId]
  );
  return result.rows;
};

/**
 * List all payments (Manager/Admin audit)
 */
const getAllPayments = async () => {
  const result = await db.query(
    `SELECT p.*, o.user_id, u.display_name AS customer_name
     FROM payments p
     JOIN orders o ON p.order_id = o.id
     LEFT JOIN users u ON o.user_id = u.id
     ORDER BY p.created_at DESC`
  );
  return result.rows;
};

module.exports = {
  recordPayment,
  getPaymentsByOrderId,
  getAllPayments,
};
