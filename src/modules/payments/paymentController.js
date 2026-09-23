const paymentsService = require('./paymentService');
const { AppError } = require('../../middleware/errorAspect');

const recordPayment = async (req, res, next) => {
  try {
    const { orderId, paymentMethod, amount } = req.body;
    if (!orderId || !paymentMethod) {
      throw new AppError('orderId and paymentMethod are required.', 400);
    }

    const payment = await paymentsService.recordPayment({
      orderId: parseInt(orderId, 10),
      paymentMethod,
      amount,
    });

    res.status(201).json({
      success: true,
      message: 'Payment processed and recorded successfully.',
      data: payment,
    });
  } catch (error) {
    next(error);
  }
};

const getOrderPayments = async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) {
      throw new AppError('Invalid order ID.', 400);
    }

    const payments = await paymentsService.getPaymentsByOrderId(orderId);
    res.status(200).json({
      success: true,
      data: payments,
    });
  } catch (error) {
    next(error);
  }
};

const getAllPayments = async (req, res, next) => {
  try {
    const payments = await paymentsService.getAllPayments();
    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  recordPayment,
  getOrderPayments,
  getAllPayments,
};
