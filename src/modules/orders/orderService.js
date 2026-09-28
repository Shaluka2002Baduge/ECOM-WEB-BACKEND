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
const createOrder = async (userId, { items, orderType = 'DINE_IN', notes = null, orderNumber = null, recipientName = null }) => {
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new AppError('Order must contain at least one menu item.', 400);
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // 1. Fetch menu item details and prices to prevent client-side price tampering
    const itemIds = [];
    for (const item of items) {
      const rawId = item.id || item.menu_item_id || item.menuItemId || item.itemId;
      const parsedId = parseInt(rawId, 10);
      if (!rawId || isNaN(parsedId)) {
        console.error('❌ [ORDER ERROR] Received item without ID:', item);
        throw new AppError('Invalid item in cart. Missing item ID.', 400);
      }
      itemIds.push(parsedId);
    }

    const menuResult = await client.query(
      'SELECT id, name, price, is_available FROM menu_items WHERE id = ANY($1::int[])',
      [itemIds]
    );

    const menuMap = new Map();
    menuResult.rows.forEach((row) => menuMap.set(row.id, row));

    let calculatedTotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const rawId = item.id || item.menu_item_id || item.menuItemId || item.itemId;
      const itemId = parseInt(rawId, 10);
      if (!itemId) {
        console.error('❌ [ORDER ERROR] Received item without ID:', item);
        throw new AppError('Invalid item in cart. Missing item ID.', 400);
      }

      const menuItem = menuMap.get(itemId);
      if (!menuItem) {
        throw new AppError(`Menu item ID ${itemId} does not exist.`, 400);
      }
      if (!menuItem.is_available) {
        throw new AppError(`Menu item "${menuItem.name}" is currently unavailable.`, 400);
      }
      const qty = parseInt(item.quantity || item.qty || 1, 10);
      if (!qty || qty <= 0) {
        throw new AppError(`Quantity for item "${menuItem.name}" must be greater than zero.`, 400);
      }

      const unitPrice = parseFloat(menuItem.price);
      const lineTotal = unitPrice * qty;
      calculatedTotal += lineTotal;

      validatedItems.push({
        menuItemId: menuItem.id,
        name: menuItem.name,
        quantity: qty,
        unitPrice,
        specialInstructions: item.specialInstructions || item.special_instructions || item.instructions || item.notes || null,
      });
    }

    // 2. Insert into orders table with generated or provided order_number & recipient_name
    const generatedOrderNumber = orderNumber || `RAALAHAMI-${Math.floor(100000 + Math.random() * 900000)}`;

    const orderResult = await client.query(
      `INSERT INTO orders (user_id, status, total_amount, order_type, notes, order_number, recipient_name)
       VALUES ($1, 'PLACED', $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId || null, calculatedTotal.toFixed(2), orderType, notes, generatedOrderNumber, recipientName || null]
    );

    const createdOrder = orderResult.rows[0];
    createdOrder.orderNumber = createdOrder.order_number || generatedOrderNumber;
    createdOrder.recipientName = createdOrder.recipient_name || recipientName;

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
 * Retrieve order details with line items by numeric ID, UUID, or alphanumeric order number (e.g. RAALAHAMI-515712)
 */
const getOrderById = async (identifier, requestingUser = null) => {
  if (!identifier) {
    throw new AppError('Order identifier is required.', 400);
  }

  const strIdentifier = String(identifier).trim();
  const isNumeric = /^\d+$/.test(strIdentifier);

  let orderResult;
  if (isNumeric) {
    orderResult = await db.query(
      `SELECT o.*, u.display_name AS customer_name, u.email AS customer_email
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.id = $1 OR o.order_number = $2
       LIMIT 1`,
      [parseInt(strIdentifier, 10), strIdentifier]
    );
  } else {
    orderResult = await db.query(
      `SELECT o.*, u.display_name AS customer_name, u.email AS customer_email
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.order_number = $1 OR o.id::text = $1
       LIMIT 1`,
      [strIdentifier]
    );
  }

  // Fallback: If identifier is in format RAALAHAMI-<digits> and order_number was not matched directly
  if (orderResult.rows.length === 0) {
    const match = strIdentifier.match(/^RAALAHAMI-(\d+)$/i);
    if (match) {
      const possibleId = parseInt(match[1], 10);
      orderResult = await db.query(
        `SELECT o.*, u.display_name AS customer_name, u.email AS customer_email
         FROM orders o
         LEFT JOIN users u ON o.user_id = u.id
         WHERE o.id = $1
         LIMIT 1`,
        [possibleId]
      );
    }
  }

  if (orderResult.rows.length === 0) {
    throw new AppError('Order not found.', 404);
  }

  const order = orderResult.rows[0];

  // Authorization check: If a registered customer requests, they cannot view another customer's order
  if (
    requestingUser &&
    requestingUser.role === 'CUSTOMER' &&
    order.user_id &&
    order.user_id !== requestingUser.id
  ) {
    throw new AppError('Forbidden: Access to this order is restricted.', 403);
  }

  // Fetch line items
  const itemsResult = await db.query(
    `SELECT oi.id, oi.menu_item_id, m.name, oi.quantity, oi.unit_price, oi.special_instructions,
            (oi.quantity * oi.unit_price) AS line_total
     FROM order_items oi
     JOIN menu_items m ON oi.menu_item_id = m.id
     WHERE oi.order_id = $1`,
    [order.id]
  );

  order.items = itemsResult.rows;
  order.orderNumber = order.order_number || `RAALAHAMI-${order.id}`;
  order.recipientName = order.recipient_name || order.customer_name;
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
