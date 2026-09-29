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
const createOrder = async (userId, { items, orderType = 'DINE_IN', notes = null, orderNumber = null, recipientName = null, deliveryAddress = null, customerEmail = null, customerPhone = null, status = null } = {}) => {
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
        unit_price: unitPrice,
        price: unitPrice,
        specialInstructions: item.specialInstructions || item.special_instructions || item.instructions || item.notes || null,
      });
    }

    // 2. Insert into orders table with generated or provided order_number & recipient_name
    const generatedOrderNumber = orderNumber || `RAALAHAMI-${Math.floor(100000 + Math.random() * 900000)}`;
    const initialStatus = status || ((orderType === 'DELIVERY' || orderType === 'TAKEAWAY') ? 'PENDING' : 'CONFIRMED');

    const orderResult = await client.query(
      `INSERT INTO orders (user_id, status, total_amount, order_type, notes, order_number, recipient_name, delivery_address, customer_email, customer_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        userId || null, 
        initialStatus, 
        calculatedTotal.toFixed(2), 
        orderType, 
        notes, 
        generatedOrderNumber, 
        recipientName || null,
        deliveryAddress || null,
        customerEmail || null,
        customerPhone || null
      ]
    );

    const createdOrder = orderResult.rows[0];
    createdOrder.orderNumber = createdOrder.order_number || generatedOrderNumber;
    createdOrder.recipientName = createdOrder.recipient_name || recipientName;
    createdOrder.fulfillment_type = formatFulfillmentType(createdOrder.order_type);
    createdOrder.fulfillmentType = createdOrder.fulfillment_type;
    createdOrder.totalAmount = Number(createdOrder.total_amount) || calculatedTotal;
    createdOrder.totalPrice = createdOrder.totalAmount;
    createdOrder.createdAt = createdOrder.created_at;
    createdOrder.updatedAt = createdOrder.updated_at;

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

const formatFulfillmentType = (rawType) => {
  const type = String(rawType || '').toUpperCase().trim();
  if (type === 'DINE_IN' || type === 'DINE-IN' || type === 'DINE IN') return 'Dine-In';
  if (type === 'DELIVERY' || type === 'HOME DELIVERY' || type === 'HOME_DELIVERY') return 'Home Delivery';
  if (type === 'TAKEAWAY' || type === 'TAKE_AWAY' || type === 'PICKUP') return 'Takeaway';
  return rawType || 'Dine-In';
};

/**
 * Retrieve order details with line items by numeric ID, UUID, or alphanumeric order number (e.g. RAALAHAMI-515712)
 */
const getOrderById = async (identifier, requestingUser = null) => {
  if (!identifier) {
    throw new AppError('Order identifier is required.', 400);
  }

  const rawId = String(identifier).trim();
  const cleanId = rawId.replace(/^[#]/, '').trim();
  const isNumeric = /^\d+$/.test(cleanId);
  const numId = isNumeric ? parseInt(cleanId, 10) : null;

  const orderResult = await db.query(
    `SELECT o.*, 
            COALESCE(o.recipient_name, u.display_name, 'Valued Patron') AS customer_name, 
            COALESCE(o.customer_email, u.email) AS customer_email,
            COALESCE(o.customer_phone, u.phone, 'N/A') AS customer_phone
     FROM orders o
     LEFT JOIN users u ON o.user_id = u.id
     WHERE o.id::text = $1 
        OR o.order_number::text = $1 
        OR o.order_number::text = $2
        OR o.order_number ILIKE '%' || $1 || '%'
        OR ($3::int IS NOT NULL AND o.id = $3::int)
     ORDER BY o.created_at DESC
     LIMIT 1`,
    [cleanId, rawId, numId]
  );

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

  order.items = itemsResult.rows.map((item) => ({
    ...item,
    price: Number(item.unit_price) || 0,
    unitPrice: Number(item.unit_price) || 0,
    unit_price: Number(item.unit_price) || 0,
  }));
  order.orderNumber = order.order_number || `RAALAHAMI-${order.id}`;
  order.order_number = order.orderNumber;
  order.recipientName = order.recipient_name || order.customer_name;
  order.fulfillment_type = formatFulfillmentType(order.order_type);
  order.fulfillmentType = order.fulfillment_type;
  order.totalPrice = Number(order.total_amount) || 0;
  order.totalAmount = order.totalPrice;
  order.createdAt = order.created_at;
  order.updatedAt = order.updated_at;
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
  if (requestingUser && requestingUser.role === 'CUSTOMER') {
    params.push(requestingUser.id);
    queryText += ` AND o.user_id = $${params.length}`;
  }

  if (statusFilter) {
    params.push(statusFilter);
    queryText += ` AND o.status = $${params.length}`;
  }

  queryText += ' ORDER BY o.created_at DESC';

  const result = await db.query(queryText, params);
  return result.rows.map((order) => ({
    ...order,
    order_number: order.order_number || `RAALAHAMI-${order.id}`,
    orderNumber: order.order_number || `RAALAHAMI-${order.id}`,
    recipientName: order.recipient_name || order.customer_name,
    fulfillment_type: formatFulfillmentType(order.order_type),
    fulfillmentType: formatFulfillmentType(order.order_type),
  }));
};

/**
 * Retrieve all orders for Admin Views
 * Uses LEFT JOIN on reservations, tables, users so Home Delivery and Takeaway orders are never omitted
 */
const getAdminOrders = async (statusFilter = null) => {
  let queryText = `
    SELECT 
      o.id,
      COALESCE(o.order_number, CONCAT('RAALAHAMI-', o.id)) AS order_number,
      COALESCE(o.recipient_name, r.patron_name, u.display_name, 'Valued Patron') AS customer_name,
      COALESCE(r.phone, u.phone, o.customer_phone, 'N/A') AS phone,
      COALESCE(r.email, u.email, o.customer_email) AS email,
      COALESCE(o.delivery_address, o.notes, '') AS delivery_address,
      o.status,
      o.total_amount,
      o.order_type,
      o.notes,
      o.created_at,
      o.updated_at,
      r.hall_name,
      r.table_number,
      r.reservation_time,
      r.party_size,
      t.id AS table_id
    FROM orders o
    LEFT JOIN reservations r ON r.order_id = o.id
    LEFT JOIN tables t ON r.table_id = t.id
    LEFT JOIN users u ON o.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (statusFilter) {
    params.push(statusFilter);
    queryText += ` AND o.status = $${params.length}`;
  }

  queryText += ' ORDER BY o.created_at DESC';

  const ordersResult = await db.query(queryText, params);
  const orders = ordersResult.rows;

  if (orders.length === 0) {
    return [];
  }

  const orderIds = orders.map((o) => o.id);
  const itemsResult = await db.query(
    `SELECT oi.id, oi.order_id, oi.menu_item_id, m.name, oi.quantity, oi.unit_price, oi.special_instructions,
            (oi.quantity * oi.unit_price) AS line_total
     FROM order_items oi
     JOIN menu_items m ON oi.menu_item_id = m.id
     WHERE oi.order_id = ANY($1::int[])`,
    [orderIds]
  );

  const itemsByOrder = new Map();
  itemsResult.rows.forEach((item) => {
    if (!itemsByOrder.has(item.order_id)) {
      itemsByOrder.set(item.order_id, []);
    }
    itemsByOrder.get(item.order_id).push(item);
  });

  return orders.map((order) => {
    const fulfillmentType = formatFulfillmentType(order.order_type);
    return {
      id: order.id,
      order_number: order.order_number,
      orderNumber: order.order_number,
      customer_name: order.customer_name,
      recipientName: order.customer_name,
      phone: order.phone,
      email: order.email,
      delivery_address: order.delivery_address,
      items: itemsByOrder.get(order.id) || [],
      total_amount: order.total_amount,
      totalAmount: order.total_amount,
      order_type: order.order_type,
      fulfillment_type: fulfillmentType,
      fulfillmentType: fulfillmentType,
      status: order.status,
      notes: order.notes,
      hall_name: order.hall_name || null,
      table_number: order.table_number || null,
      reservation_time: order.reservation_time || null,
      party_size: order.party_size || null,
      created_at: order.created_at,
      updated_at: order.updated_at,
    };
  });
};

const ALLOWED_STATUSES_BY_FULFILLMENT = {
  DELIVERY: ['PENDING', 'KITCHEN_CONFIRMED', 'COOKING', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'],
  TAKEAWAY: ['PENDING', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED'],
  DINE_IN: ['CONFIRMED', 'PENDING', 'PREPARING', 'SERVED', 'SEATED', 'COMPLETED', 'CANCELLED'],
};

const ALL_VALID_ORDER_STATUSES = [
  'PENDING', 'PLACED', 'CONFIRMED', 'KITCHEN_CONFIRMED', 'COOKING', 'PREPARING',
  'READY', 'READY_FOR_PICKUP', 'SEATED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED'
];

/**
 * State Machine Transition Executor
 * Validates and updates order status with integrity check
 */
const transitionOrderStatus = async (orderId, newStatus) => {
  const currentResult = await db.query('SELECT id, status, order_type FROM orders WHERE id = $1', [orderId]);
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
     SET status = $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [newStatus, orderId]
  );

  const updatedOrder = updateResult.rows[0] || { id: orderId, status: newStatus, order_type: currentResult.rows[0].order_type };
  updatedOrder.orderNumber = updatedOrder.order_number || `RAALAHAMI-${updatedOrder.id}`;
  updatedOrder.order_number = updatedOrder.orderNumber;
  updatedOrder.fulfillment_type = formatFulfillmentType(updatedOrder.order_type);
  updatedOrder.fulfillmentType = updatedOrder.fulfillment_type;

  return updatedOrder;
};

/**
 * Admin Unified Order Status Update Service
 * Enforces per-fulfillment-type status boundaries and updates timestamp
 * If linked to a table reservation and status is 'CANCELLED' or 'COMPLETED', immediately frees the table.
 */
const updateOrderStatusByAdmin = async (orderId, rawStatus) => {
  if (!rawStatus) {
    throw new AppError('Status is required', 400);
  }

  const rawId = String(orderId).trim();
  const cleanId = rawId.replace(/^[#]/, '').trim();
  const isNumeric = /^\d+$/.test(cleanId);

  let currentResult;
  if (isNumeric) {
    currentResult = await db.query(
      `SELECT * FROM orders 
       WHERE id = $1 
          OR id::text = $2 
          OR order_number = $2 
          OR order_number = $3 
          OR order_number ILIKE $4
       LIMIT 1`,
      [parseInt(cleanId, 10), cleanId, rawId, `%${cleanId}%`]
    );
  } else {
    currentResult = await db.query(
      `SELECT * FROM orders 
       WHERE order_number = $1 
          OR order_number ILIKE $1 
          OR id::text = $2 
          OR order_number = $2
       LIMIT 1`,
      [rawId, cleanId]
    );
  }

  if (currentResult.rows.length === 0) {
    throw new AppError('Order not found', 404);
  }

  const order = currentResult.rows[0];
  const rawOrderType = String(order.order_type || 'DINE_IN').toUpperCase().trim();
  const normalizedType = (rawOrderType === 'DELIVERY' || rawOrderType.includes('DELIVERY'))
    ? 'DELIVERY'
    : (rawOrderType === 'TAKEAWAY' || rawOrderType.includes('TAKEAWAY') || rawOrderType.includes('PICKUP'))
    ? 'TAKEAWAY'
    : 'DINE_IN';

  // Normalize string: handle milestone numbers ("4. Out for Delivery"), labels ("Cooking & Simmering"), etc.
  let normalized = String(rawStatus).toUpperCase().trim().replace(/[\s-]+/g, '_');
  normalized = normalized.replace(/^\d+[\._\s]+/, ''); // Strip leading step numbers e.g. "4._"

  // Map aliases if incoming text is descriptive
  if (normalized.includes('CANCEL')) {
    normalized = 'CANCELLED';
  } else if (normalized.includes('OUT') || (normalized.includes('DELIVERY') && !normalized.includes('DELIVERED'))) {
    normalized = 'OUT_FOR_DELIVERY';
  } else if (normalized === 'DELIVERED') {
    normalized = 'DELIVERED';
  } else if (normalized.includes('COOK') || normalized.includes('SIMMER')) {
    normalized = 'COOKING';
  } else if (normalized.includes('KITCHEN') || (normalized.includes('CONFIRM') && normalizedType === 'DELIVERY')) {
    normalized = 'KITCHEN_CONFIRMED';
  } else if (normalized.includes('CONFIRM')) {
    normalized = 'CONFIRMED';
  } else if (normalized.includes('READY')) {
    normalized = 'READY_FOR_PICKUP';
  } else if (normalized.includes('SERVE')) {
    normalized = 'COMPLETED';
  } else if (normalized.includes('PREPAR')) {
    normalized = 'PREPARING';
  } else if (normalized.includes('SEAT')) {
    normalized = 'SEATED';
  } else if (normalized.includes('COMPLET')) {
    normalized = (normalizedType === 'DELIVERY') ? 'DELIVERED' : 'COMPLETED';
  } else if (normalized.includes('PENDING') || normalized.includes('PLACE')) {
    normalized = (normalizedType === 'DELIVERY' || normalizedType === 'TAKEAWAY') ? 'PENDING' : 'CONFIRMED';
  }

  // Permissive status coercion per fulfillment type to prevent 400 errors
  const fulfillmentType = (order.fulfillment_type || order.order_type || normalizedType).toLowerCase();

  if (fulfillmentType.includes('takeaway')) {
    if (normalized === 'COOKING') {
      console.warn(`[STATUS COERCION] Order #${order.id} is Takeaway; coerced COOKING -> PREPARING`);
      normalized = 'PREPARING';
    } else if (normalized === 'OUT_FOR_DELIVERY') {
      console.warn(`[STATUS COERCION] Order #${order.id} is Takeaway; coerced OUT_FOR_DELIVERY -> READY_FOR_PICKUP`);
      normalized = 'READY_FOR_PICKUP';
    } else if (normalized === 'DELIVERED') {
      console.warn(`[STATUS COERCION] Order #${order.id} is Takeaway; coerced DELIVERED -> COMPLETED`);
      normalized = 'COMPLETED';
    } else if (normalized === 'KITCHEN_CONFIRMED') {
      normalized = 'PREPARING';
    }
  } else if (fulfillmentType.includes('delivery')) {
    if (normalized === 'PREPARING') {
      console.warn(`[STATUS COERCION] Order #${order.id} is Delivery; coerced PREPARING -> COOKING`);
      normalized = 'COOKING';
    } else if (normalized === 'READY_FOR_PICKUP') {
      console.warn(`[STATUS COERCION] Order #${order.id} is Delivery; coerced READY_FOR_PICKUP -> OUT_FOR_DELIVERY`);
      normalized = 'OUT_FOR_DELIVERY';
    } else if (normalized === 'CONFIRMED') {
      normalized = 'KITCHEN_CONFIRMED';
    } else if (normalized === 'COMPLETED') {
      normalized = 'DELIVERED';
    }
  } else if (fulfillmentType.includes('dine')) {
    if (normalized === 'COOKING') {
      console.warn(`[STATUS COERCION] Order #${order.id} is Dine-In; coerced COOKING -> PREPARING`);
      normalized = 'PREPARING';
    } else if (normalized === 'OUT_FOR_DELIVERY') {
      console.warn(`[STATUS COERCION] Order #${order.id} is Dine-In; coerced OUT_FOR_DELIVERY -> SERVED`);
      normalized = 'SERVED';
    } else if (normalized === 'DELIVERED' || normalized === 'READY_FOR_PICKUP') {
      console.warn(`[STATUS COERCION] Order #${order.id} is Dine-In; coerced ${normalized} -> SERVED`);
      normalized = 'SERVED';
    }
  }

  console.log(`[STATUS UPDATE START] Order ID: ${orderId}, Target Status: ${rawStatus}`);
  console.log(`[STATUS TRANSITION] Order #${orderId} (${formatFulfillmentType(normalizedType)}) -> Normalized: ${normalized}`);

  const validStatuses = ALLOWED_STATUSES_BY_FULFILLMENT[normalizedType] || [];
  if (!validStatuses.includes(normalized)) {
    // Graceful automatic mapping instead of throwing 400 rejection
    if (normalized === 'COOKING' || normalized === 'PREPARING') {
      normalized = (normalizedType === 'DELIVERY') ? 'COOKING' : 'PREPARING';
    } else if (normalized === 'OUT_FOR_DELIVERY' || normalized === 'READY_FOR_PICKUP') {
      normalized = (normalizedType === 'DELIVERY') ? 'OUT_FOR_DELIVERY' : (normalizedType === 'TAKEAWAY' ? 'READY_FOR_PICKUP' : 'SERVED');
    } else if (normalized === 'DELIVERED' || normalized === 'COMPLETED' || normalized === 'SERVED') {
      normalized = (normalizedType === 'DELIVERY') ? 'DELIVERED' : (normalizedType === 'TAKEAWAY' ? 'COMPLETED' : 'SERVED');
    } else if (normalized === 'CONFIRMED' || normalized === 'KITCHEN_CONFIRMED' || normalized === 'PENDING') {
      normalized = (normalizedType === 'DELIVERY') ? 'KITCHEN_CONFIRMED' : (normalizedType === 'TAKEAWAY' ? 'PENDING' : 'CONFIRMED');
    } else {
      normalized = validStatuses[0] || 'PENDING';
    }
  }

  const dbStatus = normalized;

  const updateResult = await db.query(
    `UPDATE orders
     SET status = $1,
         updated_at = NOW()
     WHERE id::text = $2 
        OR order_number::text = $2 
        OR id = $3
        OR order_number ILIKE '%' || $2 || '%'
     RETURNING *`,
    [dbStatus, cleanId, order.id]
  );

  console.log(`[STATUS UPDATE SUCCESS] Order #${orderId} updated to ${dbStatus}`);

  // Sync linked reservation if applicable
  await db.query(
    `UPDATE reservations 
     SET status = $1 
     WHERE order_id::text = $2 OR id::text = $2 OR order_id = $3`,
    [dbStatus, cleanId, order.id]
  ).catch(() => {});

  const updatedOrder = updateResult.rows[0] || { ...order, status: dbStatus, updated_at: new Date().toISOString() };
  updatedOrder.orderNumber = updatedOrder.order_number || `RAALAHAMI-${updatedOrder.id}`;
  updatedOrder.order_number = updatedOrder.orderNumber;
  updatedOrder.fulfillment_type = formatFulfillmentType(updatedOrder.order_type || normalizedType);
  updatedOrder.fulfillmentType = updatedOrder.fulfillment_type;

  // Free table if linked to reservation and status is 'CANCELLED', 'COMPLETED', or 'SERVED'
  if (normalizedType === 'DINE_IN' && (normalized === 'CANCELLED' || normalized === 'COMPLETED' || normalized === 'SERVED' || dbStatus === 'COMPLETED')) {
    // 1. Update linked reservation status
    const resLookup = await db.query(
      `UPDATE reservations
       SET status = $1,
           updated_at = NOW()
       WHERE order_id = $2
       RETURNING id, table_id, hall_name, table_number`,
      [normalized === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED', order.id]
    ).catch(() => ({ rows: [] }));

    // 2. Free dining table in tables table
    for (const resRow of (resLookup?.rows || [])) {
      if (resRow.table_id || (resRow.hall_name && resRow.table_number)) {
        await db.query(
          `UPDATE tables
           SET status = 'AVAILABLE',
               is_active = TRUE
           WHERE (id = $1 AND $1 IS NOT NULL)
              OR (LOWER(hall_name) = LOWER($2) AND LOWER(table_number) = LOWER($3))`,
          [resRow.table_id || null, resRow.hall_name || '', resRow.table_number || '']
        ).catch(() => {});
      }
    }
  }

  return updatedOrder;
};

/**
 * Retrieve all orders (active, completed, cancelled) for a given patron email
 */
const getOrdersByEmail = async (rawEmail) => {
  if (!rawEmail || typeof rawEmail !== 'string') {
    throw new AppError('Valid email is required', 400);
  }

  const email = decodeURIComponent(rawEmail).trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new AppError('Valid email is required', 400);
  }

  console.log(`[PATRON HISTORY] Fetching all feasts for email: ${email}`);

  const query = `
    SELECT 
      o.id,
      COALESCE(o.order_number, 'RAALAHAMI-' || o.id::text) AS order_number,
      COALESCE(o.recipient_name, u.display_name, 'Valued Patron') AS customer_name,
      COALESCE(o.recipient_name, u.display_name, 'Valued Patron') AS recipient_name,
      COALESCE(o.customer_email, u.email, $1) AS email,
      COALESCE(o.customer_email, u.email, $1) AS customer_email,
      COALESCE(o.customer_phone, u.phone, 'N/A') AS phone,
      COALESCE(o.customer_phone, u.phone, 'N/A') AS customer_phone,
      CASE 
        WHEN UPPER(o.order_type) IN ('DELIVERY', 'HOME DELIVERY', 'HOME_DELIVERY') THEN 'Home Delivery'
        WHEN UPPER(o.order_type) IN ('TAKEAWAY', 'TAKE_AWAY', 'PICKUP') THEN 'Takeaway'
        ELSE 'Dine-In'
      END AS fulfillment_type,
      CASE 
        WHEN UPPER(o.order_type) IN ('DELIVERY', 'HOME DELIVERY', 'HOME_DELIVERY') THEN 'Home Delivery'
        WHEN UPPER(o.order_type) IN ('TAKEAWAY', 'TAKE_AWAY', 'PICKUP') THEN 'Takeaway'
        ELSE 'Dine-In'
      END AS fulfillmentType,
      o.order_type,
      o.status,
      o.total_amount,
      o.delivery_address,
      r.table_number,
      r.hall_name,
      o.notes,
      o.created_at,
      o.updated_at
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN reservations r ON r.order_id = o.id
    WHERE LOWER(TRIM(COALESCE(o.customer_email, ''))) = $1
       OR (u.email IS NOT NULL AND LOWER(TRIM(u.email)) = $1)
    ORDER BY o.created_at DESC;
  `;

  const result = await db.query(query, [email]);
  const orders = result.rows;

  // Fetch line items for all returned orders
  if (orders.length > 0) {
    const orderIds = orders.map((o) => o.id);
    const itemsResult = await db.query(
      `SELECT oi.id, oi.order_id, oi.menu_item_id, m.name, oi.quantity, oi.unit_price, oi.special_instructions,
              (oi.quantity * oi.unit_price) AS line_total, m.image_url
       FROM order_items oi
       JOIN menu_items m ON oi.menu_item_id = m.id
       WHERE oi.order_id = ANY($1::int[])`,
      [orderIds]
    ).catch(() => ({ rows: [] }));

    const itemsByOrderId = {};
    for (const item of (itemsResult.rows || [])) {
      if (!itemsByOrderId[item.order_id]) {
        itemsByOrderId[item.order_id] = [];
      }
      itemsByOrderId[item.order_id].push(item);
    }

    for (const ord of orders) {
      ord.items = (itemsByOrderId[ord.id] || []).map((item) => ({
        ...item,
        price: Number(item.unit_price) || 0,
        unitPrice: Number(item.unit_price) || 0,
        unit_price: Number(item.unit_price) || 0,
      }));
      ord.orderNumber = ord.order_number;
      ord.recipientName = ord.customer_name;
      ord.totalPrice = Number(ord.total_amount) || 0;
      ord.totalAmount = ord.totalPrice;
      ord.total_amount = ord.totalPrice;
      ord.createdAt = ord.created_at;
      ord.updatedAt = ord.updated_at;
    }
  }

  return orders;
};

module.exports = {
  createOrder,
  getOrderById,
  getOrders,
  getOrdersByEmail,
  getAdminOrders,
  transitionOrderStatus,
  updateOrderStatusByAdmin,
  formatFulfillmentType,
  VALID_TRANSITIONS,
  ALLOWED_STATUSES_BY_FULFILLMENT,
};
