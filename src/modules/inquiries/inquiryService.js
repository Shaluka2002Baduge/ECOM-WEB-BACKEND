const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');
const emailService = require('../../services/emailService');

/**
 * Enterprise Inquiry Service for Raalahami Restaurant
 * Handles customer inquiries, admin responses, and email dispatch
 */

/**
 * 1. Create and persist a new customer inquiry
 */
const createInquiry = async ({ fullName, name, email, phone, inquiryType, subject, message }) => {
  const customerName = (fullName || name || '').trim();
  const customerEmail = (email || '').trim().toLowerCase();
  const type = (inquiryType || subject || 'General Inquiry').trim();
  const msg = (message || '').trim();
  const contactPhone = (phone || '').trim();

  if (!customerName) {
    throw new AppError('Full name is required.', 400);
  }
  if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw new AppError('A valid email address is required.', 400);
  }
  if (!msg) {
    throw new AppError('Inquiry message is required.', 400);
  }

  // Ensure table exists on the fly
  await db.query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(150) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(50),
      inquiry_type VARCHAR(100) NOT NULL DEFAULT 'General Inquiry',
      message TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      admin_reply TEXT,
      replied_at TIMESTAMPTZ,
      replied_by VARCHAR(150),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const result = await db.query(
    `INSERT INTO inquiries (full_name, email, phone, inquiry_type, message, status)
     VALUES ($1, $2, $3, $4, $5, 'PENDING')
     RETURNING *`,
    [customerName, customerEmail, contactPhone || null, type, msg]
  );

  return result.rows[0];
};

/**
 * 2. Retrieve all inquiries with optional status/search filtering
 */
const getAllInquiries = async ({ status, search } = {}) => {
  // Ensure table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(150) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(50),
      inquiry_type VARCHAR(100) NOT NULL DEFAULT 'General Inquiry',
      message TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      admin_reply TEXT,
      replied_at TIMESTAMPTZ,
      replied_by VARCHAR(150),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  let query = 'SELECT * FROM inquiries WHERE 1=1';
  const params = [];

  if (status && status !== 'ALL') {
    params.push(status.toUpperCase());
    query += ` AND UPPER(status) = $${params.length}`;
  }

  if (search && search.trim()) {
    params.push(`%${search.trim()}%`);
    const idx = params.length;
    query += ` AND (full_name ILIKE $${idx} OR email ILIKE $${idx} OR inquiry_type ILIKE $${idx} OR message ILIKE $${idx})`;
  }

  query += ' ORDER BY created_at DESC';

  const result = await db.query(query, params);
  return result.rows;
};

/**
 * 3. Retrieve single inquiry by ID
 */
const getInquiryById = async (id) => {
  const result = await db.query('SELECT * FROM inquiries WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    throw new AppError('Inquiry not found.', 404);
  }
  return result.rows[0];
};

/**
 * 4. Reply to inquiry and dispatch email notification via Nodemailer
 */
const replyToInquiry = async (id, { adminReply, status = 'REPLIED', repliedBy = 'Palace Concierge' }) => {
  if (!adminReply || !adminReply.trim()) {
    throw new AppError('Admin reply message cannot be empty.', 400);
  }

  // Fetch inquiry first
  const inquiry = await getInquiryById(id);

  // Update inquiry in database
  const updatedResult = await db.query(
    `UPDATE inquiries
     SET admin_reply = $1,
         status = $2,
         replied_at = CURRENT_TIMESTAMP,
         replied_by = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING *`,
    [adminReply.trim(), status.toUpperCase(), repliedBy, id]
  );

  const updatedInquiry = updatedResult.rows[0];

  // Dispatch email notification to customer
  let emailResult = { success: false };
  try {
    emailResult = await emailService.sendInquiryReplyEmail({
      toEmail: inquiry.email,
      customerName: inquiry.full_name,
      inquirySubject: inquiry.inquiry_type,
      originalMessage: inquiry.message,
      adminReply: adminReply.trim(),
      inquiryId: inquiry.id,
    });
  } catch (emailErr) {
    console.warn('⚠️ [Inquiry Reply Email Warning]:', emailErr.message);
  }

  return {
    inquiry: updatedInquiry,
    emailDispatched: emailResult.success !== false,
    emailDetails: emailResult,
  };
};

/**
 * 5. Delete an inquiry
 */
const deleteInquiry = async (id) => {
  const result = await db.query('DELETE FROM inquiries WHERE id = $1 RETURNING id', [id]);
  if (result.rows.length === 0) {
    throw new AppError('Inquiry not found.', 404);
  }
  return { id };
};

module.exports = {
  createInquiry,
  getAllInquiries,
  getInquiryById,
  replyToInquiry,
  deleteInquiry,
};
