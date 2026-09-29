const ordersService = require('./orderService');
const reservationsService = require('../reservations/reservationService');
const emailService = require('../../services/emailService');
const { AppError } = require('../../middleware/errorAspect');
const db = require('../../config/db');

// In-memory sliding window cache to prevent duplicate order submissions within 4 seconds
const recentOrdersCache = new Map();

const createOrder = async (req, res, next) => {
  try {
    const { items, notes } = req.body;
    const userId = req.user ? req.user.id : null;

    // 1. CAPTURE EXACT GUEST CHECKOUT PATRON DETAILS
    const patronName = 
      (req.body.recipientName && String(req.body.recipientName).trim()) || 
      (req.body.recipient_name && String(req.body.recipient_name).trim()) || 
      (req.body.patronName && String(req.body.patronName).trim()) || 
      (req.body.patron_name && String(req.body.patron_name).trim()) || 
      (req.body.customer_name && String(req.body.customer_name).trim()) || 
      (req.body.customerName && String(req.body.customerName).trim()) || 
      (req.body.full_name && String(req.body.full_name).trim()) || 
      (req.body.name && String(req.body.name).trim()) || 
      (req.user && (req.user.displayName || req.user.name || req.user.display_name));

    const patronPhone = 
      req.body.phone || 
      req.body.customer_phone || 
      req.body.contact_phone || 
      req.body.phoneNumber || 
      req.body.contactNumber || 
      req.user?.phone || 
      'N/A';

    const patronEmail = 
      req.body.email || 
      req.body.customer_email || 
      req.body.customerEmail || 
      req.body.patronEmail || 
      req.body.deliveryContact?.email || 
      req.body.guestEmail || 
      req.user?.email;

    const rawFType = String(req.body.fulfillment_type || req.body.fulfillmentMethod || req.body.fulfillmentType || req.body.order_type || req.body.orderType || '').trim();
    let fType = 'Dine-In';
    if (rawFType.toLowerCase().includes('delivery')) {
      fType = 'Home Delivery';
    } else if (rawFType.toLowerCase().includes('takeaway')) {
      fType = 'Takeaway';
    } else if (rawFType.toLowerCase().includes('dine')) {
      fType = 'Dine-In';
    } else if (req.body.reservation || req.body.table_number || req.body.tableNumber || req.body.hallName || req.body.hall_name) {
      fType = 'Dine-In';
    } else if (rawFType === '') {
      fType = req.body.deliveryStreetAddress || req.body.address ? 'Home Delivery' : 'Dine-In';
    }

    const isDineIn = fType === 'Dine-In';
    const orderType = fType === 'Home Delivery' ? 'DELIVERY' : (fType === 'Takeaway' ? 'TAKEAWAY' : 'DINE_IN');
    const initialStatus = (orderType === 'DELIVERY' || orderType === 'TAKEAWAY') ? 'PENDING' : 'CONFIRMED';
    const deliveryFee = orderType === 'DELIVERY' ? (Number(req.body.deliveryFee) || 450) : 0;
    const deliveryAddress = req.body.deliveryStreetAddress || req.body.address || req.body.delivery_address || req.body.deliveryAddress || '';

    // Validation: If patronName is missing for explicit Dine-In / Reservation, reject with 400
    if (isDineIn && (rawFType.toLowerCase().includes('dine') || req.body.reservation) && (!patronName || typeof patronName !== 'string' || patronName.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: 'Customer full name is required for reservations.',
      });
    }

    const recipientName = patronName || 'Valued Patron';
    const customerEmail = patronEmail;
    const phone = patronPhone;
    const totalDue = Number(req.body.totalAmount || req.body.totalDue || 0);

    // 1.1 DUPLICATE ORDER PREVENTION: Return existing order if submitted in the last 4 seconds
    const dupKey = customerEmail && totalDue > 0 ? `${customerEmail.toLowerCase()}_${totalDue.toFixed(2)}` : null;
    if (dupKey && recentOrdersCache.has(dupKey)) {
      const cached = recentOrdersCache.get(dupKey);
      if (Date.now() - cached.timestamp < 4000) {
        return res.status(200).json({
          success: true,
          message: 'Order already received.',
          data: cached.order,
          order: cached.order,
        });
      }
    }

    if (customerEmail && totalDue > 0) {
      try {
        const recentCheck = await db.query(
          `SELECT id, order_number, total_amount, order_type, status, recipient_name, customer_email, delivery_address, created_at 
           FROM orders 
           WHERE customer_email = $1 
             AND (total_amount = $2 OR total_amount = $3) 
             AND created_at >= NOW() - INTERVAL '4 seconds' 
           ORDER BY created_at DESC 
           LIMIT 1`,
          [customerEmail, totalDue, totalDue.toFixed(2)]
        );
        if (recentCheck && recentCheck.rows && recentCheck.rows.length > 0) {
          const existingOrder = recentCheck.rows[0];
          existingOrder.fulfillment_type = ordersService.formatFulfillmentType(existingOrder.order_type);
          return res.status(200).json({
            success: true,
            message: 'Order already received.',
            data: existingOrder,
            order: existingOrder,
          });
        }
      } catch (err) {
        // Continue if duplicate check query fails
      }
    }

    console.log('📦 [ORDER PLACEMENT RECEIVED]', {
      recipientName,
      customerEmail,
      orderType,
      fType,
      isDineIn,
      totalAmount: req.body.totalAmount || req.body.totalDue
    });

    // 2. CAPTURE EXACT DINE-IN COORDINATES FROM PATRON PAYLOAD
    const diningDate = req.body.dining_date || req.body.diningDate || req.body.reservation_date || req.body.reservationDate || req.body.date || req.body.reservation?.diningDate || req.body.reservation?.date;
    const diningTime = req.body.time_slot || req.body.timeSlot || req.body.dining_time || req.body.diningTime || req.body.reservation_time || req.body.reservationTime || req.body.time || req.body.reservation?.diningTime || req.body.reservation?.time;
    const hallName = req.body.seating_preference || req.body.hallName || req.body.hall_name || req.body.seating_hall || req.body.seatingHall || req.body.reservation?.seatingPreference || req.body.reservation?.hallName || req.body.reservation?.hall_name;
    const tableNumber = req.body.table_number || req.body.tableNumber || req.body.table || req.body.reservation?.tableNumber || req.body.reservation?.table_number;
    const partySize = req.body.party_size || req.body.partySize || req.body.guests || req.body.guestCount || req.body.reservation?.partySize || req.body.reservation?.guestsCount;
    const patronNotes = req.body.special_requests || req.body.notes || '';
    const tableId = req.body.table_id || req.body.tableId || req.body.reservation?.tableId || null;

    const hasExplicitTable = !!(tableNumber || hallName || tableId);

    if (isDineIn && (hasExplicitTable || diningTime)) {
      // Validate operating hours: 12:30 to 23:30 if diningTime provided
      if (diningTime && !reservationsService.isOperatingHours(diningTime)) {
        return res.status(400).json({
          success: false,
          message: 'Dine-in reservations are only available between 12:30 PM and 11:30 PM.',
        });
      }

      // Check collision in 90-minute window if table or time was explicitly submitted
      if (hasExplicitTable || diningTime) {
        const conflictResult = await reservationsService.checkTableConflict({
          hallName: hallName || 'Royal Dining Hall',
          tableNumber: tableNumber || 'Table 1',
          tableId,
          reservationTime: diningTime || new Date().toISOString(),
          reservationDate: diningDate || null,
        });

        if (conflictResult.hasConflict) {
          return res.status(409).json({
            success: false,
            message: conflictResult.message || 'This table was just reserved. Please pick another available table.',
          });
        }
      }
    }

    // 3. PERSIST ORDER RECORD IN POSTGRESQL (ACID)
    const newOrder = await ordersService.createOrder(userId, { 
      items, 
      orderType, 
      notes: patronNotes || req.body.deliveryInstructions, 
      orderNumber: req.body.orderNumber || req.body.order_number,
      recipientName,
      deliveryAddress,
      customerEmail,
      customerPhone: phone,
      status: initialStatus
    });

    if (dupKey) {
      recentOrdersCache.set(dupKey, { timestamp: Date.now(), order: newOrder });
    }

    // 4. AUTOMATIC LIVE RESERVATION ENTRY FOR DINE-IN ORDERS
    if (isDineIn) {
      try {
        const liveReservation = await reservationsService.createDineInReservation({
          userId,
          orderId: newOrder.id,
          patronName: patronName,
          phone: patronPhone,
          email: patronEmail,
          partySize: partySize ? parseInt(partySize, 10) : 2,
          reservationDate: diningDate,
          reservationTime: diningTime,
          hallName: hallName || 'Royal Dining Hall',
          tableNumber: tableNumber || 'Table 1',
          tableId,
          specialRequests: patronNotes || null,
          bookingSource: 'Online Order Checkout',
        });

        console.log('🍽️ [LIVE DINE-IN RESERVATION CREATED]:', {
          reservationId: liveReservation.id,
          orderId: newOrder.id,
          patronName: recipientName,
          phone,
          hallName: hallName || 'Royal Dining Hall',
          tableNumber: tableNumber || 'Table 1',
          partySize: partySize ? parseInt(partySize, 10) : 2,
          reservationTime: diningTime,
          status: 'CONFIRMED',
        });

        newOrder.reservation = liveReservation;
      } catch (resErr) {
        console.error('⚠️ [DINE-IN RESERVATION WARNING]: Could not auto-create reservation entry:', resErr.message);
      }
    }

    // 5. PASS RECIPIENT DATA TO EMAIL RECEIPT
    if (customerEmail) {
      if (isDineIn) {
        console.log('[Email Dispatch] Exact Dine-In Coordinates:', {
          customerEmail: newOrder.patron_email || req.body.email || customerEmail,
          diningDate,
          diningTime,
          hallName,
          tableNumber,
          partySize
        });
      }

      console.log(`✉️ [DISPATCHING ORDER RECEIPT] To: ${customerEmail} for Order #${newOrder.orderNumber || newOrder.id} (Recipient: ${recipientName})`);

      const reservationData = newOrder.reservation || req.body.reservation || {};
      const resolvedDiningDate = diningDate || reservationData.reservation_date || reservationData.diningDate || reservationData.date;
      const resolvedDiningTime = diningTime || reservationData.reservation_time || reservationData.diningTime || reservationData.time;
      const resolvedHallName = hallName || reservationData.hall_name || reservationData.hallName || 'Royal Dining Hall';
      const resolvedTableNumber = tableNumber || reservationData.table_number || reservationData.tableNumber || 'Table 1';
      const resolvedPartySize = partySize || reservationData.party_size || reservationData.partySize || 2;
      const resolvedOrderItems = (req.body.items && req.body.items[0]?.name) ? req.body.items : (newOrder.items || req.body.items || []);

      const receiptData = {
        orderId: newOrder.orderNumber || newOrder.id,
        id: newOrder.id,
        recipientName: recipientName,
        customerName: recipientName,
        customerEmail: customerEmail,
        orderType: orderType, // 'DELIVERY' | 'TAKEAWAY' | 'DINE_IN'
        phone: phone,
        deliveryStreetAddress: req.body.deliveryStreetAddress || req.body.address || req.body.deliveryAddress || '',
        deliveryInstructions: req.body.deliveryInstructions || patronNotes || '',
        reservation: reservationData,
        diningDate: resolvedDiningDate,
        diningTime: resolvedDiningTime,
        hallName: resolvedHallName,
        tableNumber: resolvedTableNumber,
        partySize: resolvedPartySize,
        items: resolvedOrderItems,
        orderItems: resolvedOrderItems,
        subtotal: Number(req.body.subtotal) || 0,
        serviceVat: Number(req.body.serviceVat) || 0,
        deliveryFee: deliveryFee,
        totalAmount: Number(newOrder.totalAmount || req.body.totalDue || req.body.totalAmount),
        paymentMethod: req.body.paymentMethod || 'CASH_ON_DELIVERY',
        notes: newOrder.notes || patronNotes
      };

      emailService.sendOrderConfirmationEmail(customerEmail, receiptData)
        .then(() => console.log(`✅ [RECEIPT DISPATCH SUCCESS] Delivered to ${customerEmail}`))
        .catch((err) => console.error(`❌ [RECEIPT DISPATCH ERROR]:`, err.message));
    } else {
      console.warn('⚠️ [RECEIPT EMAIL SKIPPED] No valid email address found in request body or auth token.');
    }

    res.status(201).json({
      success: true,
      message: 'Order placed successfully.',
      data: newOrder,
    });
  } catch (error) {
    next(error);
  }
};

const getOrderById = async (req, res, next) => {
  try {
    const rawIdentifier = req.params.id || req.params.identifier;

    if (!rawIdentifier || typeof rawIdentifier !== 'string' || rawIdentifier.trim() === '') {
      return res.status(400).json({ success: false, error: 'Order identifier is required', message: 'Order identifier is required.' });
    }

    const identifier = rawIdentifier.trim();
    const foundOrder = await ordersService.getOrderById(identifier, req.user);

    if (!foundOrder) {
      return res.status(404).json({ success: false, error: `Order ${identifier} not found`, message: 'Order not found.' });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).json({
      success: true,
      order: foundOrder,
      data: foundOrder,
    });
  } catch (error) {
    if (error.statusCode === 404 || error.message === 'Order not found.' || error.message === 'Order not found') {
      return res.status(404).json({ success: false, error: `Order not found`, message: 'Order not found.' });
    }
    next(error);
  }
};

const getOrders = async (req, res, next) => {
  try {
    const { status } = req.query;
    const orders = await ordersService.getOrders(req.user, status);
    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
};

const updateOrderStatus = async (req, res, next) => {
  try {
    const orderId = req.params.id ? req.params.id.toString().replace('#', '').trim() : '';
    let { status } = req.body;

    console.log(`[STATUS UPDATE TRIGGERED] Incoming ID: "${req.params.id}" -> Parsed: "${orderId}", Target Status: "${status}"`);

    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Order ID is required', message: 'Order ID is required' });
    }
    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required', message: 'Status is required' });
    }

    const updated = await ordersService.updateOrderStatusByAdmin(orderId, status);
    return res.status(200).json({
      success: true,
      message: `Order status successfully transitioned to ${updated.status}.`,
      order: updated,
      data: updated,
    });
  } catch (error) {
    if (error.statusCode === 404 || error.message === 'Order not found' || error.message === 'Order not found.') {
      return res.status(404).json({ success: false, error: `Order #${req.params.id} not found in database`, message: 'Order not found' });
    }
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, error: error.message, message: error.message });
    }
    console.error('[STATUS UPDATE DB CRASH]', error.message, error.stack);
    return res.status(500).json({ 
      success: false,
      error: 'Database status update failed', 
      details: error.message 
    });
  }
};

const trackOrder = async (req, res, next) => {
  try {
    const rawIdentifier = req.params.identifier || req.params.id;

    if (!rawIdentifier || typeof rawIdentifier !== 'string' || rawIdentifier.trim() === '') {
      return res.status(400).json({ success: false, error: 'Order identifier is required', message: 'Order identifier is required.' });
    }

    const identifier = rawIdentifier.trim();
    console.log(`[TRACKING FETCH] Looking up order with identifier: "${identifier}"`);

    const foundOrder = await ordersService.getOrderById(identifier, req.user);

    if (!foundOrder) {
      console.warn(`[TRACKING 404] Order not found for identifier: "${identifier}"`);
      return res.status(404).json({ success: false, error: `Order ${identifier} not found`, message: 'Order not found.' });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).json({
      success: true,
      order: foundOrder,
      data: foundOrder,
    });
  } catch (error) {
    if (error.statusCode === 404 || error.message === 'Order not found.' || error.message === 'Order not found') {
      return res.status(404).json({ success: false, error: `Order ${req.params.identifier || req.params.id} not found`, message: 'Order not found.' });
    }
    next(error);
  }
};

const getOrderHistoryByEmail = async (req, res, next) => {
  try {
    const rawEmail = req.params.email || req.query.email;
    if (!rawEmail || typeof rawEmail !== 'string') {
      return res.status(400).json({ success: false, error: 'Valid email is required', message: 'Valid email is required' });
    }

    const email = decodeURIComponent(rawEmail).trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid email is required', message: 'Valid email is required' });
    }

    console.log(`[PATRON HISTORY] Fetching all feasts for email: ${email}`);

    const orders = await ordersService.getOrdersByEmail(email);

    // Set no-cache headers for instant updates
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).json({
      success: true,
      total: orders.length,
      count: orders.length,
      orders: orders,
      data: orders,
    });
  } catch (err) {
    console.error('[PATRON HISTORY ERROR]', err);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to retrieve patron order history',
      message: 'Failed to retrieve patron order history' 
    });
  }
};

module.exports = {
  createOrder,
  getOrderById,
  trackOrder,
  getOrders,
  getOrderHistoryByEmail,
  updateOrderStatus,
};
