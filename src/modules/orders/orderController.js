const ordersService = require('./orderService');
const reservationsService = require('../reservations/reservationService');
const emailService = require('../../services/emailService');
const { AppError } = require('../../middleware/errorAspect');

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

    const fulfillmentType = String(req.body.fulfillment_type || req.body.fulfillmentType || '').trim();
    const rawOrderType = String(req.body.order_type || req.body.orderType || '').trim();

    const isDineIn =
      fulfillmentType.toLowerCase() === 'dine-in' ||
      fulfillmentType.toLowerCase() === 'dine_in' ||
      fulfillmentType.toLowerCase() === 'dine in' ||
      rawOrderType.toLowerCase() === 'dine-in' ||
      rawOrderType.toLowerCase() === 'dine_in' ||
      rawOrderType.toLowerCase() === 'dine in';

    // Validation: If patronName is missing or empty for Dine-In, reject with 400
    if (isDineIn && (!patronName || typeof patronName !== 'string' || patronName.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: 'Customer full name is required for reservations.',
      });
    }

    const recipientName = patronName || 'Valued Patron';
    const customerEmail = patronEmail;
    const phone = patronPhone;
    const orderType = isDineIn ? 'DINE_IN' : (rawOrderType.toUpperCase() || 'DELIVERY');
    const deliveryFee = orderType === 'DELIVERY' ? (Number(req.body.deliveryFee) || 450) : 0;

    console.log('📦 [ORDER PLACEMENT RECEIVED]', {
      recipientName,
      customerEmail,
      orderType,
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

    if (isDineIn) {
      const hasExplicitTable = !!(tableNumber || hallName || tableId);

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
        });

        if (conflictResult.hasConflict) {
          return res.status(409).json({
            success: false,
            message: conflictResult.message || 'This table is already booked for this time slot. Please choose another table or time.',
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
      recipientName
    });

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
    const { id } = req.params;

    if (!id || typeof id !== 'string' || id.trim() === '') {
      return res.status(400).json({ success: false, message: 'Order identifier is required.' });
    }

    const identifier = id.trim();
    const foundOrder = await ordersService.getOrderById(identifier, req.user);

    if (!foundOrder) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    return res.status(200).json({
      success: true,
      data: foundOrder,
    });
  } catch (error) {
    if (error.statusCode === 404 || error.message === 'Order not found.') {
      return res.status(404).json({ success: false, message: 'Order not found.' });
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
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) {
      throw new AppError('Invalid order ID.', 400);
    }

    const { status } = req.body;
    if (!status) {
      throw new AppError('New status is required.', 400);
    }

    const updated = await ordersService.transitionOrderStatus(orderId, status);
    res.status(200).json({
      success: true,
      message: `Order status successfully transitioned to ${status}.`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrder,
  getOrderById,
  getOrders,
  updateOrderStatus,
};
