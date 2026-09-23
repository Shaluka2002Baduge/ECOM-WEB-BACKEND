const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');

/**
 * State Machine Transition Matrix
 * Enforces valid state lifecycle according to CIS007-3 / CIS045-3 specifications.
 */
const VALID_TRANSITIONS = {
  PLACED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED'],
  COMPLETED: [], // Terminal state
  CANCELLED: [], // Terminal state
};

/**
 * Create a new customer order with line items inside an ACID transaction
 */
const createOrder = async (userId, { items, orderType = 'DINE_IN', notes = null }) => {
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new AppError('Order must contain at least one menu item.', 400);
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // 1. Fetch menu item details and prices to prevent client-side price tampering
    const itemIds = items.map((i) => i.menuItemId);
    const menuResult = await client.query(
      'SELECT id, name, price, is_available FROM menu_items WHERE id = ANY($1::int[])',
      [itemIds]
    );

    const menuMap = new Map();
    menuResult.rows.forEach((row) => menuMap.set(row.id, row));

    let calculatedTotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const menuItem = menuMap.get(item.menuItemId);
      if (!menuItem) {
        throw new AppError(`Menu item ID ${item.menuItemId} does not exist.`, 400);
      }
      if (!menuItem.is_available) {
        throw new AppError(`Menu item "${menuItem.name}" is currently unavailable.`, 400);
      }
      if (!item.quantity || item.quantity <= 0) {
        throw new AppError(`Quantity for item "${menuItem.name}" must be greater than zero.`, 400);
      }

      const unitPrice = parseFloat(menuItem.price);
      const lineTotal = unitPrice * item.quantity;
      calculatedTotal += lineTotal;

      validatedItems.push({
        menuItemId: menuItem.id,
        quantity: item.quantity,
        unitPrice,
        specialInstructions: item.specialInstructions || null,
      });
    }

    // 2. Insert into orders table
    const orderResult = await client.query(
      `INSERT INTO orders (user_id, status, total_amount, order_type, notes)
       VALUES ($1, 'PLACED', $2, $3, $4)
       RETURNING *`,
      [userId || null, calculatedTotal.toFixed(2), orderType, notes]
    );

    const createdOrder = orderResult.rows[0];

    // 3. Insert order items
    for (const line of validatedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, special_instructions)
         VALUES ($1, $2, $3, $4, $5)`,
        [createdOrder.id, line.menuItemId, line.quantity, line.unitPrice, line.specialInstructions]
      );
    }

    await client.query('COMMIT');

    createdOrder.items = validatedItems;
    return createdOrder;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Retrieve order details with line items
 */
const getOrderById = async (orderId, requestingUser) => {
  const orderResult = await db.query(
    `SELECT o.*, u.display_name AS customer_name, u.email AS customer_email
     FROM orders o
     LEFT JOIN users u ON o.user_id = u.id
     WHERE o.id = $1`,
    [orderId]
  );

  if (orderResult.rows.length === 0) {
    throw new AppError('Order not found.', 404);
  }

  const order = orderResult.rows[0];

  // Authorization check: Customers can only view their own orders
  if (requestingUser.role === 'CUSTOMER' && order.user_id !== requestingUser.id) {
    throw new AppError('Forbidden: Access to this order is restricted.', 403);
  }

  // Fetch line items
  const itemsResult = await db.query(
    `SELECT oi.id, oi.menu_item_id, m.name, oi.quantity, oi.unit_price, oi.special_instructions,
            (oi.quantity * oi.unit_price) AS line_total
     FROM order_items oi
     JOIN menu_items m ON oi.menu_item_id = m.id
     WHERE oi.order_id = $1`,
    [orderId]
  );

  order.items = itemsResult.rows;
  return order;
};

/**
 * List orders with optional status filter
 */
const getOrders = async (requestingUser, statusFilter) => {
  let queryText = `
    SELECT o.*, u.display_name AS customer_name
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  // Customer constraint
  if (requestingUser.role === 'CUSTOMER') {
    params.push(requestingUser.id);
    queryText += ` AND o.user_id = $${params.length}`;
  }

  if (statusFilter) {
    params.push(statusFilter);
    queryText += ` AND o.status = $${params.length}`;
  }

  queryText += ' ORDER BY o.created_at DESC';

  const result = await db.query(queryText, params);
  return result.rows;
};

/**
 * State Machine Transition Executor
 * Validates and updates order status with integrity check
 */
const transitionOrderStatus = async (orderId, newStatus) => {
  const currentResult = await db.query('SELECT id, status FROM orders WHERE id = $1', [orderId]);
  if (currentResult.rows.length === 0) {
    throw new AppError('Order not found.', 404);
  }

  const currentStatus = currentResult.rows[0].status;
  const allowedNextStates = VALID_TRANSITIONS[currentStatus] || [];

  if (!allowedNextStates.includes(newStatus)) {
    throw new AppError(
      `Invalid state transition: Cannot change order from '${currentStatus}' to '${newStatus}'. Allowed transitions: [${allowedNextStates.join(', ')}]`,
      400
    );
  }

  const updateResult = await db.query(
    `UPDATE orders
     SET status = $1
     WHERE id = $2
     RETURNING *`,
    [newStatus, orderId]
  );

  return updateResult.rows[0];
};

module.exports = {
  createOrder,
  getOrderById,
  getOrders,
  transitionOrderStatus,
  VALID_TRANSITIONS,
};
