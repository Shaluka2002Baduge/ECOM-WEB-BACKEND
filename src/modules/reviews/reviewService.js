const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');

/**
 * Retrieve approved customer reviews for public display
 */
const getApprovedReviews = async () => {
  const result = await db.query(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.display_name AS reviewer_name
     FROM reviews r
     LEFT JOIN users u ON r.user_id = u.id
     WHERE r.is_approved = TRUE
     ORDER BY r.created_at DESC`
  );
  return result.rows;
};

/**
 * Submit a customer review for an order
 */
const createReview = async (userId, { orderId, rating, comment }) => {
  if (rating < 1 || rating > 5) {
    throw new AppError('Rating must be an integer between 1 and 5.', 400);
  }

  // Validate order existence and ownership
  if (orderId) {
    const orderCheck = await db.query('SELECT id, user_id FROM orders WHERE id = $1', [orderId]);
    if (orderCheck.rows.length === 0) {
      throw new AppError('Associated order not found.', 404);
    }
  }

  const result = await db.query(
    `INSERT INTO reviews (order_id, user_id, rating, comment, is_approved)
     VALUES ($1, $2, $3, $4, FALSE)
     RETURNING *`,
    [orderId || null, userId || null, rating, comment || null]
  );

  return result.rows[0];
};

/**
 * Moderate review approval status (Admin/Manager)
 */
const moderateReview = async (reviewId, isApproved) => {
  const result = await db.query(
    `UPDATE reviews
     SET is_approved = $1
     WHERE id = $2
     RETURNING *`,
    [isApproved, reviewId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Review not found.', 404);
  }

  return result.rows[0];
};

/**
 * Get all reviews (including pending moderation) for management
 */
const getAllReviewsForAdmin = async () => {
  const result = await db.query(
    `SELECT r.*, u.display_name AS reviewer_name, u.email AS reviewer_email
     FROM reviews r
     LEFT JOIN users u ON r.user_id = u.id
     ORDER BY r.created_at DESC`
  );
  return result.rows;
};

module.exports = {
  getApprovedReviews,
  createReview,
  moderateReview,
  getAllReviewsForAdmin,
};
