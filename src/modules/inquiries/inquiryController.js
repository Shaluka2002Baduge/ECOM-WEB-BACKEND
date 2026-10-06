const inquiryService = require('./inquiryService');

/**
 * Inquiry Controller
 * Exposes endpoints for public submission and admin moderation
 */

/**
 * Public: Submit a customer inquiry from Contact Us page
 * POST /api/inquiries
 */
const createInquiry = async (req, res, next) => {
  try {
    const { fullName, name, email, phone, inquiryType, subject, message } = req.body;
    const newInquiry = await inquiryService.createInquiry({
      fullName,
      name,
      email,
      phone,
      inquiryType,
      subject,
      message,
    });

    res.status(201).json({
      success: true,
      message: 'Your royal inquiry has been successfully submitted to the Palace Concierge.',
      data: newInquiry,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Retrieve all inquiries with optional status/search
 * GET /api/inquiries & GET /api/admin/inquiries
 */
const getAllInquiries = async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const inquiries = await inquiryService.getAllInquiries({ status, search });

    res.status(200).json({
      success: true,
      count: inquiries.length,
      data: inquiries,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Retrieve single inquiry by ID
 * GET /api/inquiries/:id & GET /api/admin/inquiries/:id
 */
const getInquiryById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const inquiry = await inquiryService.getInquiryById(id);

    res.status(200).json({
      success: true,
      data: inquiry,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Reply to customer inquiry and trigger email notification
 * PATCH /api/admin/inquiries/:id, PATCH /api/inquiries/:id, POST /api/admin/inquiries/:id/reply
 */
const replyToInquiry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adminReply, reply, status } = req.body;
    const repliedBy = req.user?.displayName || req.user?.email || 'Palace Concierge Administrator';

    const result = await inquiryService.replyToInquiry(id, {
      adminReply: adminReply || reply,
      status: status || 'REPLIED',
      repliedBy,
    });

    res.status(200).json({
      success: true,
      message: 'Royal response saved and email notification dispatched to the customer.',
      data: result.inquiry,
      emailDispatched: result.emailDispatched,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Delete an inquiry
 * DELETE /api/admin/inquiries/:id & DELETE /api/inquiries/:id
 */
const deleteInquiry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await inquiryService.deleteInquiry(id);

    res.status(200).json({
      success: true,
      message: 'Inquiry record successfully removed.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createInquiry,
  getAllInquiries,
  getInquiryById,
  replyToInquiry,
  deleteInquiry,
};
