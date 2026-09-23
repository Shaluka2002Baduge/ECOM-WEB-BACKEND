const reviewsService = require('./reviewService');
const { AppError } = require('../../middleware/errorAspect');

const getApprovedReviews = async (req, res, next) => {
  try {
    const reviews = await reviewsService.getApprovedReviews();
    res.status(200).json({
      success: true,
      count: reviews.length,
      data: reviews,
    });
  } catch (error) {
    next(error);
  }
};

const createReview = async (req, res, next) => {
  try {
    const { orderId, rating, comment } = req.body;
    if (!rating) {
      throw new AppError('rating is required.', 400);
    }

    const review = await reviewsService.createReview(req.user ? req.user.id : null, {
      orderId: orderId ? parseInt(orderId, 10) : null,
      rating: parseInt(rating, 10),
      comment,
    });

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully. It will appear once approved by moderation.',
      data: review,
    });
  } catch (error) {
    next(error);
  }
};

const moderateReview = async (req, res, next) => {
  try {
    const reviewId = parseInt(req.params.id, 10);
    if (isNaN(reviewId)) {
      throw new AppError('Invalid review ID.', 400);
    }

    const { isApproved } = req.body;
    if (typeof isApproved !== 'boolean') {
      throw new AppError('isApproved boolean is required.', 400);
    }

    const updated = await reviewsService.moderateReview(reviewId, isApproved);
    res.status(200).json({
      success: true,
      message: `Review has been ${isApproved ? 'approved' : 'rejected'}.`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

const getAllReviews = async (req, res, next) => {
  try {
    const reviews = await reviewsService.getAllReviewsForAdmin();
    res.status(200).json({
      success: true,
      count: reviews.length,
      data: reviews,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getApprovedReviews,
  createReview,
  moderateReview,
  getAllReviews,
};
