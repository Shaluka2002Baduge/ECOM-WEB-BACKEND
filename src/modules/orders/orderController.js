const ordersService = require('./orderService');
const { AppError } = require('../../middleware/errorAspect');

const createOrder = async (req, res, next) => {
  try {
    const { items, orderType, notes } = req.body;
    const userId = req.user ? req.user.id : null;

    const order = await ordersService.createOrder(userId, { items, orderType, notes });
    res.status(201).json({
      success: true,
      message: 'Order placed successfully.',
      data: order,
    });
  } catch (error) {
    next(error);
  }
};

const getOrderById = async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) {
      throw new AppError('Invalid order ID.', 400);
    }

    const order = await ordersService.getOrderById(orderId, req.user);
    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
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
