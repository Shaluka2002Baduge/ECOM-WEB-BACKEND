const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');
const inventoryService = require('../inventory/inventoryService');

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

    // 1. Separate item lookups to prevent ID collision between menu_items and inventory_items
    const invItemIds = [];
    const menuItemIds = [];

    for (const item of items) {
      const isExplicitInv =
        item.is_inventory_item === true ||
        item.isInventoryItem === true ||
        item.is_inventory_synced === true ||
        item.item_source === 'inventory' ||
        item.source === 'inventory' ||
        Boolean(item.inventoryItemId || item.inventory_item_id);

      const rawId = item.inventoryItemId || item.inventory_item_id || item.menuItemId || item.menu_item_id || item.id || item.itemId;
      const parsedId = parseInt(rawId, 10);
      if (!rawId || isNaN(parsedId)) {
        console.error('❌ [ORDER ERROR] Received item without ID:', item);
        throw new AppError('Invalid item in cart. Missing item ID.', 400);
      }

      if (isExplicitInv) {
        if (!invItemIds.includes(parsedId)) invItemIds.push(parsedId);
      } else {
        if (!menuItemIds.includes(parsedId)) menuItemIds.push(parsedId);
      }
    }

    const menuMap = new Map();
    if (menuItemIds.length > 0) {
      const menuResult = await client.query(
        'SELECT id, name, price, is_available, variants, image_url FROM menu_items WHERE id = ANY($1::int[])',
        [menuItemIds]
      );
      menuResult.rows.forEach((row) => {
        let parsedVariants = [];
        try {
          parsedVariants = typeof row.variants === 'string' ? JSON.parse(row.variants) : (row.variants || []);
        } catch (e) {}
        menuMap.set(row.id, {
          ...row,
          variants: parsedVariants,
          isMenuItem: true,
          isInventoryItem: false
        });
      });
    }

    // Check inventory_items for explicit inventory items or missing items
    const missingIds = menuItemIds.filter((id) => !menuMap.has(id));
    const finalInvIds = [...new Set([...invItemIds, ...missingIds])];

    const invMap = new Map();
    if (finalInvIds.length > 0) {
      const invResult = await client.query(
        `SELECT id, name, current_stock, minimum_threshold, image_url, variants, (current_stock > 0) AS is_available 
         FROM inventory_items 
         WHERE id = ANY($1::int[])`,
        [finalInvIds]
      );
      invResult.rows.forEach((inv) => {
        let parsedVariants = [];
        try {
          parsedVariants = typeof inv.variants === 'string' ? JSON.parse(inv.variants) : (inv.variants || []);
        } catch (e) {}
        const basePrice = parsedVariants.length > 0 ? parseFloat(parsedVariants[0].price || 0) : 0;
        invMap.set(inv.id, {
          id: inv.id,
          name: inv.name,
          price: basePrice,
          is_available: inv.is_available,
          variants: parsedVariants,
          image_url: inv.image_url,
          isMenuItem: false,
          isInventoryItem: true
        });
      });
    }

    let calculatedTotal = 0;
    const validatedItems = [];

    const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
    const matchSize = (sizeA, sizeB) => {
      const a = norm(sizeA);
      const b = norm(sizeB);
      if (!a || !b) return false;
      if (a === b) return true;
      if (a.replace(/l$/, 'liter') === b || b.replace(/l$/, 'liter') === a) return true;
      if (a === '500ml' && (b === '0.5l' || b === '0.5liter')) return true;
      if (b === '500ml' && (a === '0.5l' || a === '0.5liter')) return true;
      if (a === '1l' && (b === '1000ml' || b === '1liter')) return true;
      if (b === '1l' && (a === '1000ml' || a === '1liter')) return true;
      if (a === '1.5l' && (b === '1500ml' || b === '1.5liter')) return true;
      if (b === '1.5l' && (a === '1500ml' || a === '1.5liter')) return true;
      if (a === '2l' && (b === '2000ml' || b === '2liter')) return true;
      if (b === '2l' && (a === '2000ml' || a === '2liter')) return true;
      return false;
    };

    for (const item of items) {
      const rawId = item.inventoryItemId || item.inventory_item_id || item.menuItemId || item.menu_item_id || item.id || item.itemId;
      const itemId = parseInt(rawId, 10);
      if (!itemId) {
        console.error('❌ [ORDER ERROR] Received item without ID:', item);
        throw new AppError('Invalid item in cart. Missing item ID.', 400);
      }

      const isExplicitInv =
        item.is_inventory_item === true ||
        item.isInventoryItem === true ||
        item.is_inventory_synced === true ||
        item.item_source === 'inventory' ||
        item.source === 'inventory' ||
        (item.inventoryItemId || item.inventory_item_id);

      const isExplicitMenu =
        item.is_inventory_item === false ||
        item.isInventoryItem === false ||
        item.item_source === 'menu' ||
        item.source === 'menu';

      let menuItem = null;

      if (isExplicitInv) {
        menuItem = invMap.get(itemId);
      } else if (isExplicitMenu) {
        menuItem = menuMap.get(itemId);
      } else {
        const menuMatch = menuMap.get(itemId);
        const invMatch = invMap.get(itemId);
        const itemName = String(item.name || item.title || '').toLowerCase().trim();

        if (menuMatch && invMatch) {
          const cleanMenuName = menuMatch.name.toLowerCase().trim();
          const cleanInvName = invMatch.name.toLowerCase().trim();
          if (itemName && (cleanInvName.includes(itemName) || itemName.includes(cleanInvName))) {
            menuItem = invMatch;
          } else if (itemName && (cleanMenuName.includes(itemName) || itemName.includes(cleanMenuName))) {
            menuItem = menuMatch;
          } else if (item.selectedSize || item.size || item.variant) {
            menuItem = invMatch;
          } else {
            menuItem = menuMatch;
          }
        } else {
          menuItem = menuMatch || invMatch;
        }
      }

      if (!menuItem) {
        throw new AppError(`Item ID ${itemId} does not exist in catalog or inventory.`, 400);
      }
      if (!menuItem.is_available) {
        throw new AppError(`Item "${menuItem.name}" is currently unavailable.`, 400);
      }
      const qty = parseInt(item.quantity || item.qty || 1, 10);
      if (!qty || qty <= 0) {
        throw new AppError(`Quantity for item "${menuItem.name}" must be greater than zero.`, 400);
      }

      let unitPrice = parseFloat(menuItem.price || 0);
      const selectedSize = item.selectedSize || item.size || item.variant || null;

      if (selectedSize && menuItem.variants) {
        let variantList = [];
        try {
          variantList = typeof menuItem.variants === 'string' ? JSON.parse(menuItem.variants) : menuItem.variants;
        } catch (e) {}
        if (Array.isArray(variantList)) {
          const matchedVariant = variantList.find((v) => matchSize(v.size, selectedSize));
          if (matchedVariant && matchedVariant.price !== undefined) {
            unitPrice = parseFloat(matchedVariant.price);
          }
        }
      } else if (selectedSize && item.price && !isNaN(parseFloat(item.price)) && parseFloat(item.price) > 0) {
        unitPrice = parseFloat(item.price);
      }

      const lineTotal = unitPrice * qty;
      calculatedTotal += lineTotal;

      const lineItemName = selectedSize && !menuItem.name.includes(`(${selectedSize})`)
        ? `${menuItem.name} (${selectedSize})`
        : menuItem.name;

      validatedItems.push({
        id: menuItem.id,
        menuItemId: menuItem.isMenuItem ? menuItem.id : null,
        inventoryItemId: menuItem.isInventoryItem ? menuItem.id : null,
        is_inventory_item: menuItem.isInventoryItem,
        item_source: menuItem.isInventoryItem ? 'inventory' : 'menu',
        name: lineItemName,
        selectedSize,
        size: selectedSize,
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
        `INSERT INTO order_items (order_id, menu_item_id, inventory_item_id, item_name, quantity, unit_price, special_instructions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [createdOrder.id, line.menuItemId, line.inventoryItemId, line.name, line.quantity, line.unitPrice, line.specialInstructions]
      );
    }

    // 4. Auto-deduct inventory stock for recipes, produce, water bottles, and beverages
    try {
      await inventoryService.deductInventoryStock(validatedItems, client);
    } catch (deductErr) {
      console.warn('⚠️ [Auto-Stock Deduction Notice]:', deductErr.message);
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
  let orderResult;
  if (isNumeric) {
    orderResult = await db.query(
      `SELECT o.*, 
              COALESCE(o.recipient_name, u.display_name, 'Valued User') AS customer_name, 
              COALESCE(o.recipient_name, u.display_name, 'Valued User') AS user_name, 
              COALESCE(o.customer_email, u.email) AS customer_email,
              COALESCE(o.customer_phone, u.phone, 'N/A') AS customer_phone
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.id = $1 OR o.order_number = $2 OR o.order_number = $3
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [numId, cleanId, rawId]
    );
  } else {
    orderResult = await db.query(
      `SELECT o.*, 
              COALESCE(o.recipient_name, u.display_name, 'Valued User') AS customer_name, 
              COALESCE(o.recipient_name, u.display_name, 'Valued User') AS user_name, 
              COALESCE(o.customer_email, u.email) AS customer_email,
              COALESCE(o.customer_phone, u.phone, 'N/A') AS customer_phone
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.order_number = $1 OR o.order_number ILIKE $1
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [rawId]
    );
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
    `SELECT oi.id, oi.menu_item_id, oi.inventory_item_id,
            COALESCE(oi.item_name, m.name, inv.name, 'Item') AS name, 
            oi.quantity, oi.unit_price, oi.special_instructions,
            (oi.quantity * oi.unit_price) AS line_total,
            COALESCE(m.image_url, inv.image_url) AS image_url
     FROM order_items oi
     LEFT JOIN menu_items m ON oi.menu_item_id = m.id
     LEFT JOIN inventory_items inv ON oi.inventory_item_id = inv.id
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
 * Supports status, specific single date, or date range filtering
 * Uses LEFT JOIN on reservations, tables, users so Home Delivery and Takeaway orders are never omitted
 */
const getAdminOrders = async (statusFilterOrOptions = null) => {
  let status = null;
  let targetDate = null;
  let startDate = null;
  let endDate = null;

  if (typeof statusFilterOrOptions === 'object' && statusFilterOrOptions !== null) {
    status = statusFilterOrOptions.status || null;
    targetDate = statusFilterOrOptions.date || null;
    startDate = statusFilterOrOptions.startDate || null;
    endDate = statusFilterOrOptions.endDate || null;
  } else if (typeof statusFilterOrOptions === 'string') {
    status = statusFilterOrOptions;
  }

  let queryText = `
    SELECT 
      o.id,
      COALESCE(o.order_number, CONCAT('RAALAHAMI-', o.id)) AS order_number,
      COALESCE(o.recipient_name, r.patron_name, u.display_name, 'Valued User') AS customer_name,
      COALESCE(o.recipient_name, r.patron_name, u.display_name, 'Valued User') AS user_name,
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

  if (status) {
    params.push(status);
    queryText += ` AND o.status = $${params.length}`;
  }

  if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(String(targetDate).trim())) {
    const d = String(targetDate).trim();
    params.push(`${d} 00:00:00`, `${d} 23:59:59`);
    queryText += ` AND o.created_at >= $${params.length - 1} AND o.created_at <= $${params.length}`;
  } else if (startDate && endDate) {
    params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
    queryText += ` AND o.created_at >= $${params.length - 1} AND o.created_at <= $${params.length}`;
  }

  queryText += ' ORDER BY o.created_at DESC';

  const ordersResult = await db.query(queryText, params);
  const orders = ordersResult.rows;

  if (orders.length === 0) {
    return [];
  }

  const orderIds = orders.map((o) => o.id);
  const itemsResult = await db.query(
    `SELECT oi.id, oi.order_id, oi.menu_item_id, oi.inventory_item_id,
            COALESCE(oi.item_name, m.name, inv.name, 'Item') AS name, 
            oi.quantity, oi.unit_price, oi.special_instructions,
            (oi.quantity * oi.unit_price) AS line_total,
            COALESCE(m.image_url, inv.image_url) AS image_url
     FROM order_items oi
     LEFT JOIN menu_items m ON oi.menu_item_id = m.id
     LEFT JOIN inventory_items inv ON oi.inventory_item_id = inv.id
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

/**
 * Generate Comprehensive Daily Order Fulfillment Report
 * @param {string} date - 'YYYY-MM-DD'
 */
const getDailyOrdersReport = async (date) => {
  const resolvedDate = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) 
    ? date.trim() 
    : new Date().toISOString().split('T')[0];

  const orders = await getAdminOrders({ date: resolvedDate });

  const totalOrders = orders.length;
  let completedOrders = 0;
  let cancelledOrders = 0;
  let activeOrders = 0;
  let grossSales = 0;
  let dineInCount = 0;
  let takeawayCount = 0;
  let deliveryCount = 0;
  let dineInRevenue = 0;
  let takeawayRevenue = 0;
  let deliveryRevenue = 0;

  orders.forEach((o) => {
    const amount = parseFloat(o.total_amount || 0);
    if (o.status === 'CANCELLED') {
      cancelledOrders++;
    } else {
      grossSales += amount;
      if (o.status === 'COMPLETED' || o.status === 'DELIVERED') {
        completedOrders++;
      } else {
        activeOrders++;
      }

      if (o.order_type === 'DINE_IN') {
        dineInCount++;
        dineInRevenue += amount;
      } else if (o.order_type === 'TAKEAWAY') {
        takeawayCount++;
        takeawayRevenue += amount;
      } else if (o.order_type === 'DELIVERY') {
        deliveryCount++;
        deliveryRevenue += amount;
      }
    }
  });

  const averageOrderValue = (totalOrders - cancelledOrders) > 0 
    ? Math.round(grossSales / (totalOrders - cancelledOrders)) 
    : 0;

  return {
    success: true,
    reportType: 'DAILY_ORDER_FULFILLMENT_REPORT',
    date: resolvedDate,
    formattedDate: new Date(resolvedDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    generatedAt: new Date().toISOString(),
    summary: {
      totalOrders,
      completedOrders,
      cancelledOrders,
      activeOrders,
      grossSales,
      grossSalesFormatted: `LKR ${grossSales.toLocaleString()}`,
      averageOrderValue,
      averageOrderValueFormatted: `LKR ${averageOrderValue.toLocaleString()}`,
      channels: {
        dineIn: { count: dineInCount, revenue: dineInRevenue, formatted: `LKR ${dineInRevenue.toLocaleString()}` },
        takeaway: { count: takeawayCount, revenue: takeawayRevenue, formatted: `LKR ${takeawayRevenue.toLocaleString()}` },
        delivery: { count: deliveryCount, revenue: deliveryRevenue, formatted: `LKR ${deliveryRevenue.toLocaleString()}` }
      }
    },
    orders
  };
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

  if (newStatus === 'CANCELLED' && currentStatus !== 'CANCELLED') {
    try {
      const itemsRes = await db.query(
        `SELECT oi.id, oi.menu_item_id, oi.inventory_item_id, oi.item_name, oi.quantity, oi.unit_price, oi.special_instructions 
         FROM order_items oi 
         WHERE oi.order_id = $1`,
        [orderId]
      );
      if (itemsRes.rows && itemsRes.rows.length > 0) {
        await inventoryService.restockInventoryStock(itemsRes.rows);
      }
    } catch (restockErr) {
      console.warn('⚠️ [Stock Reversal Notice in transitionOrderStatus]:', restockErr.message);
    }
  }

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
          OR order_number = $2 
          OR order_number = $3 
       LIMIT 1`,
      [parseInt(cleanId, 10), cleanId, rawId]
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
     WHERE id = $2
     RETURNING *`,
    [dbStatus, order.id]
  );

  console.log(`[STATUS UPDATE SUCCESS] Order #${orderId} updated to ${dbStatus}`);

  // Sync linked reservation if applicable
  await db.query(
    `UPDATE reservations 
     SET status = $1 
     WHERE order_id = $2`,
    [dbStatus, order.id]
  ).catch(() => {});

  // Stock Reversal on Order Cancellation
  if (dbStatus === 'CANCELLED' && order.status !== 'CANCELLED') {
    try {
      const itemsRes = await db.query(
        `SELECT oi.id, oi.menu_item_id, oi.inventory_item_id, oi.item_name, oi.quantity, oi.unit_price, oi.special_instructions 
         FROM order_items oi 
         WHERE oi.order_id = $1`,
        [order.id]
      );
      if (itemsRes.rows && itemsRes.rows.length > 0) {
        await inventoryService.restockInventoryStock(itemsRes.rows);
        console.log(`🔄 [STOCK REVERSAL]: Restored inventory for cancelled Order #${order.id}`);
      }
    } catch (restockErr) {
      console.warn('⚠️ [Stock Reversal Notice in updateOrderStatusByAdmin]:', restockErr.message);
    }
  }

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
 * Retrieve all orders (active, completed, cancelled) for a given user email
 */
const getOrdersByEmail = async (rawEmail) => {
  if (!rawEmail || typeof rawEmail !== 'string') {
    throw new AppError('Valid email is required', 400);
  }

  const email = decodeURIComponent(rawEmail).trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new AppError('Valid email is required', 400);
  }

  console.log(`[USER HISTORY] Fetching all feasts for email: ${email}`);

  const query = `
    SELECT 
      o.id,
      COALESCE(o.order_number, 'RAALAHAMI-' || o.id::text) AS order_number,
      COALESCE(o.recipient_name, u.display_name, 'Valued User') AS customer_name,
      COALESCE(o.recipient_name, u.display_name, 'Valued User') AS recipient_name,
      COALESCE(o.recipient_name, u.display_name, 'Valued User') AS user_name,
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
      `SELECT oi.id, oi.order_id, oi.menu_item_id, oi.inventory_item_id,
              COALESCE(oi.item_name, m.name, inv.name, 'Item') AS name, 
              oi.quantity, oi.unit_price, oi.special_instructions,
              (oi.quantity * oi.unit_price) AS line_total, 
              COALESCE(m.image_url, inv.image_url) AS image_url
       FROM order_items oi
       LEFT JOIN menu_items m ON oi.menu_item_id = m.id
       LEFT JOIN inventory_items inv ON oi.inventory_item_id = inv.id
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
  getDailyOrdersReport,
  transitionOrderStatus,
  updateOrderStatusByAdmin,
  formatFulfillmentType,
  VALID_TRANSITIONS,
  ALLOWED_STATUSES_BY_FULFILLMENT,
};
