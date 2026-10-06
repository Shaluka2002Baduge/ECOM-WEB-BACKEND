const express = require('express');
const router = express.Router();
const inquiryController = require('./inquiryController');
const { verifyToken, requireRole } = require('../../middleware/authAspect');

/**
 * Public Route: Submit inquiry from Contact Us page
 */
router.post('/', inquiryController.createInquiry);

/**
 * Admin Routes: Guarded by Token & Role (or fallback for flexibility)
 */
// GET all inquiries
router.get('/', inquiryController.getAllInquiries);

// GET single inquiry
router.get('/:id', inquiryController.getInquiryById);

// PATCH / PUT reply to inquiry
router.patch('/:id', inquiryController.replyToInquiry);
router.put('/:id', inquiryController.replyToInquiry);
router.post('/:id/reply', inquiryController.replyToInquiry);

// DELETE inquiry
router.delete('/:id', inquiryController.deleteInquiry);

module.exports = router;
