const ordersService = require('./orderService');
const emailService = require('../../services/emailService');
const { AppError } = require('../../middleware/errorAspect');

const createOrder = async (req, res, next) => {
  try {
    const { items, notes } = req.body;
    const userId = req.user ? req.user.id : null;

    // 1. CAPTURE INPUTTED RECIPIENT NAME & EMAIL
    const recipientName = 
      req.body.recipientName?.trim() || 
      req.body.customerName?.trim() || 
      req.user?.displayName || 
      req.user?.name || 
      'Valued Patron';

    const customerEmail = 
      req.body.customerEmail || 
      req.body.email || 
      req.body.patronEmail || 
      req.body.deliveryContact?.email || 
      req.body.customer_email || 
      req.body.guestEmail || 
      req.user?.email;

    const orderType = req.body.orderType || 'DELIVERY';
    const deliveryFee = orderType === 'DELIVERY' ? (Number(req.body.deliveryFee) || 450) : 0;
    const reservation = orderType === 'DINE_IN' ? req.body.reservation : null;

    console.log('📦 [ORDER PLACEMENT RECEIVED]', {
      recipientName,
      customerEmail,
      orderType,
      totalAmount: req.body.totalAmount || req.body.totalDue
    });

    // Save recipientName in the orders table in PostgreSQL
    const newOrder = await ordersService.createOrder(userId, { 
      items, 
      orderType, 
      notes: req.body.notes || req.body.deliveryInstructions, 
      orderNumber: req.body.orderNumber || req.body.order_number,
      recipientName
    });

    // 2. PASS RECIPIENT DATA TO EMAIL RECEIPT
    if (customerEmail) {
      console.log(`✉️ [DISPATCHING ORDER RECEIPT] To: ${customerEmail} for Order #${newOrder.orderNumber || newOrder.id} (Recipient: ${recipientName})`);

      const receiptData = {
        orderId: newOrder.orderNumber || newOrder.id,
        id: newOrder.id,
        recipientName: recipientName,
        customerName: recipientName,
        customerEmail: customerEmail,
        orderType: orderType, // 'DELIVERY' | 'TAKEAWAY' | 'DINE_IN'
        phone: req.body.phone || req.body.phoneNumber || 'N/A',
        deliveryStreetAddress: req.body.deliveryStreetAddress || req.body.address || req.body.deliveryAddress || '',
        deliveryInstructions: req.body.deliveryInstructions || req.body.notes || '',
        reservation: reservation,
        items: (req.body.items && req.body.items[0]?.name) ? req.body.items : (newOrder.items || req.body.items || []),
        subtotal: Number(req.body.subtotal) || 0,
        serviceVat: Number(req.body.serviceVat) || 0,
        deliveryFee: deliveryFee,
        totalAmount: Number(newOrder.totalAmount || req.body.totalDue || req.body.totalAmount),
        paymentMethod: req.body.paymentMethod || 'CASH_ON_DELIVERY',
        notes: newOrder.notes || req.body.notes
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
