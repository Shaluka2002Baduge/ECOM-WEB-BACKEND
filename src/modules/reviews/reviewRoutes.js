const express = require('express');
const router = express.Router();
const reviewsController = require('./reviewController');
const { authenticateToken, authorizeRoles } = require('../../middleware/authAspect');

// Public reviews
router.get('/approved', reviewsController.getApprovedReviews);

// Customer submission (requires login)
router.post('/', authenticateToken, reviewsController.createReview);

// Moderation routes (Manager / Admin)
router.get('/all', authenticateToken, authorizeRoles('MANAGER', 'ADMIN'), reviewsController.getAllReviews);
router.patch('/:id/moderate', authenticateToken, authorizeRoles('MANAGER', 'ADMIN'), reviewsController.moderateReview);

module.exports = router;
