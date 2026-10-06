require('dotenv').config();
const nodemailer = require('nodemailer');

/**
 * Enterprise Email Notification Service for Raalahami Restaurant
 * Compliant with University of Bedfordshire (CIS007-3 / CIS045-3) standards.
 * 
 * Features:
 * - Real Gmail SMTP dispatch using app credentials
 * - Prominent OTP console dispatch for development safety
 * - Royal Heritage Dark & Gold HTML template for Dine-In Reservation Feast Confirmations
 * - Branded HTML templates for Delivery, Takeaway, Welcome, and Password Reset
 */

const smtpPass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
const smtpUser = (process.env.SMTP_USER || '').trim();

// 1. Force Nodemailer Gmail Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});

// Verify the transporter connection and log readiness
if (process.env.NODE_ENV !== 'test') {
  transporter.verify((err) => {
    if (err) {
      console.warn('⚠️ [SMTP NOTICE] Real email credentials not active yet. Using console fallback.');
    } else {
      console.log('✅ [SMTP READY] Real email service active for all users.');
    }
  });
}

/**
 * Helper to format dining dates (e.g. "2026-09-29" -> "September 29, 2026")
 */
const formatDiningDate = (dateVal) => {
  if (!dateVal) return 'Confirmed Reservation';
  try {
    const rawStr = String(dateVal).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawStr)) {
      const [year, month, day] = rawStr.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      return `${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} (${rawStr})`;
    }
    const d = new Date(rawStr);
    if (!isNaN(d.getTime())) {
      const formatted = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const isoPart = d.toISOString().split('T')[0];
      return `${formatted} (${isoPart})`;
    }
  } catch (e) {}
  return String(dateVal);
};

/**
 * Helper to format dining time slots (e.g. "19:30" -> "07:30 PM (19:30)")
 */
const formatDiningTime = (timeVal) => {
  if (!timeVal) return 'Confirmed Time';
  try {
    let t = String(timeVal).trim();
    if (t.includes('T')) {
      t = t.split('T')[1].substring(0, 5);
    }
    const match = t.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = match[2];
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const formattedHours = hours % 12 === 0 ? 12 : hours % 12;
      const paddedHours = formattedHours < 10 ? `0${formattedHours}` : `${formattedHours}`;
      return `${paddedHours}:${minutes} ${ampm} (${t})`;
    }
  } catch (e) {}
  return String(timeVal);
};

/**
 * Resolves formatted payment method display name based on payment method and order type
 */
const resolvePaymentMethodName = (method, orderType) => {
  const type = (orderType || '').toUpperCase();
  const m = (method || '').toUpperCase();

  if (m.includes('CASH') || m.includes('COD') || m.includes('COUNTER') || m.includes('SETTLEMENT')) {
    if (type === 'DELIVERY' || type.includes('DELIVERY')) {
      return 'Cash on Delivery (COD)';
    }
    if (type === 'TAKEAWAY' || type === 'DINE_IN' || type.includes('TAKEAWAY') || type.includes('DINE')) {
      return 'Counter Settlement';
    }
    return 'Cash / Counter Settlement';
  }

  if (m.includes('CARD')) return 'Credit / Debit Card (Online)';
  if (m.includes('WALLET')) return 'Digital Wallet';
  return method || 'Counter Settlement';
};

/**
 * Royal Heritage Dine-In Email HTML Generator
 * Generates an executive dark & gold themed email template
 */
const generateDineInEmailHtml = ({
  customerName,
  orderId,
  diningDate,
  diningTime,
  hallName,
  tableNumber,
  partySize,
  orderItems = [],
  totalAmount,
}) => {
  const cleanCustomerName = (customerName || 'Valued Guest').replace(/^Hon\.\s*/i, '').trim();
  const formattedDiningDate = formatDiningDate(diningDate);
  const formattedDiningTime = formatDiningTime(diningTime);
  const formattedTotalAmount = typeof totalAmount === 'number' ? totalAmount.toFixed(2) : String(totalAmount || '0.00');

  const orderItemsRows = (orderItems || []).map((item, idx) => {
    const name = item.name || item.dish || item.dishName || item.menu_item_name || item.title || `Dish #${item.menuItemId || item.id || idx + 1}`;
    const quantity = Number(item.quantity || item.qty || 1);
    const unitPrice = parseFloat(item.unitPrice || item.unit_price || item.price || 0);
    const lineTotal = (quantity * unitPrice).toFixed(2);

    return `
      <tr style="border-bottom: 1px solid #374151;">
        <td style="padding: 8px 0; color: #e5e7eb;">${name} x ${quantity}</td>
        <td style="padding: 8px 0; text-align: right; color: #fbbf24;">Rs. ${lineTotal}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="background-color: #0b0f19; font-family: 'Georgia', serif; color: #f3f4f6; padding: 40px 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #111827; border: 1px solid #d97706; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
        
        <!-- Header -->
        <div style="background-color: #1f2937; padding: 25px; text-align: center; border-bottom: 2px solid #d97706;">
          <h1 style="color: #f59e0b; margin: 0; font-size: 26px; letter-spacing: 2px; text-transform: uppercase;">Raalahami</h1>
          <p style="color: #9ca3af; margin: 5px 0 0; font-size: 13px; letter-spacing: 1px;">Royal Heritage Fine Dining</p>
        </div>

        <!-- Body -->
        <div style="padding: 30px;">
          <h2 style="color: #fbbf24; font-size: 20px; margin-top: 0;">Royal Court Reservation Confirmed</h2>
          <p style="color: #d1d5db; font-size: 15px; line-height: 1.6;">
            Ayubowan <b>Hon. ${cleanCustomerName}</b><br/>
            Greetings <strong>${customerName}</strong>,<br/>
            Your royal feast and private dining chamber have been successfully prepared and reserved.
          </p>

          <!-- Reservation Coordinates Card -->
          <div style="background-color: #1e293b; border-left: 4px solid #f59e0b; padding: 18px; border-radius: 6px; margin: 25px 0;">
            <h3 style="color: #f59e0b; margin: 0 0 12px; font-size: 16px; text-transform: uppercase; letter-spacing: 1px;">Table Coordinates</h3>
            <!-- 🍽️ CONFIRMED ROYAL TABLE RESERVATION -->
            <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #e2e8f0;">
              <tr>
                <td style="padding: 6px 0; color: #94a3b8; width: 40%;">Dining Date:</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right;">${formattedDiningDate}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #94a3b8;">Dining Time:</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right; color: #fbbf24;">${formattedDiningTime}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #94a3b8;">Chamber / Hall:</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right;">${hallName}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #94a3b8;">Assigned Table:</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right; color: #34d399;">${tableNumber}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #94a3b8;">Party Size:</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right;">${partySize} Guests</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #94a3b8;">Order Reference:</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right; color: #93c5fd;">#${orderId}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #94a3b8;">Royal Delivery:</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right; color: #a7f3d0;">Royal Delivery: Rs. 0.00 (Dine-In Complimentary)</td>
              </tr>
            </table>
          </div>

          <!-- Feast Summary -->
          <h3 style="color: #f59e0b; font-size: 16px; margin-bottom: 10px;">Pre-Ordered Feast Items</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
            ${orderItemsRows || '<tr><td colspan="2" style="padding: 8px 0; color: #9ca3af; text-align: center;">No pre-ordered dishes (A la carte)</td></tr>'}
            <tr>
              <td style="padding: 12px 0; font-weight: bold; color: #f3f4f6;">Total Due</td>
              <td style="padding: 12px 0; font-weight: bold; text-align: right; color: #fbbf24; font-size: 16px;">Rs. ${formattedTotalAmount} <!-- LKR ${formattedTotalAmount} --></td>
            </tr>
          </table>

          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; text-align: center;">
            Please arrive 10 minutes prior to your reservation time. Your table will be held for 15 minutes past reserved time.<br/>
            For protocol modifications, contact our concierge desk.
          </p>
        </div>

        <!-- Footer -->
        <div style="background-color: #1f2937; padding: 15px; text-align: center; border-top: 1px solid #374151; font-size: 11px; color: #6b7280;">
          © 2026 Raalahami Fine Dining. All Royal Rights Reserved.
        </div>
      </div>
    </div>
  `;
};

/**
 * Standard Email Template Wrapper for Delivery and Takeaway receipts
 */
const renderEmailTemplate = ({ preheader, title, contentHtml, footerNote }) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      background-color: #f8fafc;
      color: #1e293b;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f8fafc;
      padding: 30px 15px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
    }
    .header {
      background: linear-gradient(135deg, #064e3b 0%, #047857 60%, #065f46 100%);
      color: #ffffff;
      padding: 32px 24px;
      text-align: center;
    }
    .brand-title {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: 1px;
      margin: 0;
      text-transform: uppercase;
      color: #ffffff;
    }
    .brand-tagline {
      font-size: 13px;
      letter-spacing: 2px;
      color: #fef3c7;
      margin-top: 6px;
      margin-bottom: 0;
      text-transform: uppercase;
    }
    .content {
      padding: 32px 28px;
      line-height: 1.6;
    }
    .footer {
      background-color: #f1f5f9;
      padding: 24px;
      text-align: center;
      font-size: 12px;
      color: #64748b;
      border-top: 1px solid #e2e8f0;
    }
    .footer a {
      color: #047857;
      text-decoration: none;
    }
    .btn {
      display: inline-block;
      background-color: #047857;
      color: #ffffff !important;
      font-weight: 600;
      padding: 12px 28px;
      border-radius: 8px;
      text-decoration: none;
      margin-top: 20px;
    }
    .table-container {
      width: 100%;
      border-collapse: collapse;
      margin-top: 18px;
      margin-bottom: 20px;
    }
    .table-container th {
      background-color: #f8fafc;
      color: #475569;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 12px 10px;
      text-align: left;
      border-bottom: 2px solid #e2e8f0;
    }
    .table-container td {
      padding: 12px 10px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 14px;
    }
    .table-total {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      border-top: 2px solid #cbd5e1;
    }
  </style>
</head>
<body>
  <div style="display:none;font-size:1px;color:#333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${preheader || title}
  </div>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1 class="brand-title">Raalahami</h1>
        <p class="brand-tagline">Authentic Sri Lankan Culinary Heritage</p>
      </div>
      <div class="content">
        ${contentHtml}
      </div>
      <div class="footer">
        <p style="margin: 0 0 8px 0;">${footerNote || 'Thank you for choosing Raalahami Restaurant.'}</p>
        <p style="margin: 0 0 8px 0;">123 Galle Road, Colombo 03, Sri Lanka | Phone: +94 11 234 5678</p>
        <p style="margin: 0;">© ${new Date().getFullYear()} Raalahami Restaurant. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
};

/**
 * 1. Send Welcome Email upon registration
 */
const sendWelcomeEmail = async (toEmail, displayName) => {
  const name = displayName || 'Valued Guest';
  const subject = `Welcome to Raalahami Restaurant, ${name}! 🍽️`;

  const html = renderEmailTemplate({
    title: subject,
    preheader: `Welcome to Raalahami Restaurant, ${name}! Start exploring authentic Sri Lankan cuisine.`,
    contentHtml: `
      <h2 style="color: #064e3b; margin-top: 0; font-size: 22px;">Ayubowan & Welcome, ${name}!</h2>
      <p style="font-size: 15px; color: #334155;">
        Thank you for creating an account with <strong>Raalahami Restaurant</strong>. We are delighted to welcome you to our culinary family!
      </p>
      <p style="font-size: 15px; color: #334155;">
        From traditional clay-pot curries and fragrant Lamprais to artisanal desserts, we prepare every dish with organic ingredients, generational spices, and authentic passion.
      </p>

      <div style="background-color: #f8fafc; border-left: 4px solid #059669; padding: 14px 18px; margin: 24px 0; border-radius: 0 8px 8px 0;">
        <h4 style="margin: 0 0 6px 0; color: #065f46;">What you can do with your account:</h4>
        <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 14px;">
          <li style="margin-bottom: 4px;"><strong>Order Online:</strong> Seamless Dine-In, Takeaway, or Doorstep Delivery.</li>
          <li style="margin-bottom: 4px;"><strong>Reserve Tables:</strong> Reserve your favorite table across our 3 luxurious dining halls.</li>
          <li style="margin-bottom: 4px;"><strong>Track Orders:</strong> Real-time kitchen status from prep to table.</li>
        </ul>
      </div>

      <div style="text-align: center; margin-top: 30px;">
        <a href="${process.env.CORS_ORIGIN || 'http://localhost:3000'}/menu" class="btn">
          Explore Our Menu & Order Now
        </a>
      </div>
    `,
    footerNote: 'We look forward to serving you an unforgettable culinary experience.',
  });

  const mailOptions = {
    from: process.env.SMTP_FROM || `"Raalahami" <${smtpUser}>`,
    to: toEmail,
    subject,
    html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ [WELCOME EMAIL DISPATCHED TO GMAIL]:', info.messageId, 'Recipient:', toEmail);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ [WELCOME EMAIL DISPATCH FAILED]:', error.message || error);
    return { success: false, error: error.message };
  }
};

/**
 * 2. Send Order Confirmation Email (Supports DINE_IN, TAKEAWAY, DELIVERY)
 */
const sendOrderConfirmationEmail = async (toEmail, receiptData = {}) => {
  const orderId = receiptData.orderId || receiptData.orderNumber || receiptData.id || 'N/A';
  const recipientName = receiptData.recipientName || receiptData.customerName || receiptData.customer_name || receiptData.userName || receiptData.user_name || 'Valued User';
  const orderType = String(receiptData.orderType || receiptData.order_type || 'DELIVERY').toUpperCase();
  const displayPaymentMethod = resolvePaymentMethodName(receiptData.paymentMethod || receiptData.payment_method, receiptData.orderType || receiptData.order_type);
  const paymentMethod = displayPaymentMethod;
  const deliveryStreetAddress = receiptData.deliveryStreetAddress || receiptData.deliveryAddress || receiptData.address || 'Address provided at delivery';
  const phone = receiptData.phone || receiptData.phoneNumber || receiptData.contactPhone || 'N/A';
  const deliveryInstructions = receiptData.deliveryInstructions || receiptData.notes || 'None';
  const reservation = receiptData.reservation || {};

  // Extract Dine-In coordinates
  const diningDate = receiptData.diningDate || reservation.diningDate || reservation.reservation_date || reservation.date || 'Confirmed Reservation';
  const diningTime = receiptData.diningTime || reservation.diningTime || reservation.reservation_time || reservation.time || 'Confirmed Time';
  const hallName = receiptData.hallName || reservation.hallName || reservation.hall_name || reservation.seatingPreference || reservation.seatingArea || 'Royal Dining Hall';
  const tableNumber = receiptData.tableNumber || reservation.tableNumber || reservation.table_number || 'Table 1';
  const partySize = receiptData.partySize || reservation.partySize || reservation.party_size || reservation.guestsCount || 2;

  // Full itemized list
  const rawItems = receiptData.items || receiptData.orderItems || [];
  const items = Array.isArray(rawItems) ? rawItems : [];

  let calculatedSubtotal = 0;
  const itemsHtml = items.map((item, index) => {
    const itemName = item.name || item.dish || item.dishName || item.menu_item_name || item.title || `Dish #${item.menuItemId || item.menu_item_id || item.id || (index + 1)}`;
    const qty = Number(item.quantity || item.qty || 1);
    const unitPrice = parseFloat(item.unitPrice || item.unit_price || item.price || 0);
    const lineTotal = (qty * unitPrice);
    calculatedSubtotal += lineTotal;
    const instructions = item.specialInstructions || item.special_instructions || item.instructions || item.notes;

    return `
      <tr>
        <td style="font-weight: 600; color: #1e293b; padding: 12px 10px; border-bottom: 1px solid #f1f5f9;">
          ${itemName}
          ${instructions ? `<div style="font-size: 12px; color: #64748b; font-style: italic; margin-top: 2px;">Note: ${instructions}</div>` : ''}
        </td>
        <td style="text-align: center; color: #475569; padding: 12px 10px; border-bottom: 1px solid #f1f5f9;">${qty}</td>
        <td style="text-align: right; color: #475569; padding: 12px 10px; border-bottom: 1px solid #f1f5f9;">Rs. ${unitPrice.toFixed(2)}</td>
        <td style="text-align: right; font-weight: 600; color: #0f172a; padding: 12px 10px; border-bottom: 1px solid #f1f5f9;">Rs. ${lineTotal.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  // Financial breakdown
  const rawSubtotal = receiptData.subtotal !== undefined && Number(receiptData.subtotal) > 0 
    ? Number(receiptData.subtotal) 
    : calculatedSubtotal;
  const subtotal = parseFloat(rawSubtotal).toFixed(2);

  const rawVat = receiptData.serviceVat !== undefined && Number(receiptData.serviceVat) > 0 
    ? Number(receiptData.serviceVat) 
    : (rawSubtotal * 0.10);
  const serviceVat = parseFloat(rawVat).toFixed(2);

  let deliveryFeeNum = 0;
  let deliveryFeeLabel = 'Royal Delivery:';
  let deliveryFeeText = 'Rs. 0.00';

  if (orderType === 'DINE_IN') {
    deliveryFeeNum = 0;
    deliveryFeeLabel = 'Royal Delivery:';
    deliveryFeeText = 'Rs. 0.00 (Dine-In Complimentary)';
  } else if (orderType === 'TAKEAWAY') {
    deliveryFeeNum = 0;
    deliveryFeeLabel = 'Royal Delivery:';
    deliveryFeeText = 'Rs. 0.00 (Self Pickup / Free)';
  } else {
    // DELIVERY
    deliveryFeeNum = receiptData.deliveryFee !== undefined 
      ? Number(receiptData.deliveryFee) 
      : 450;
    deliveryFeeLabel = 'Royal Palace Delivery:';
    deliveryFeeText = `Rs. ${deliveryFeeNum.toFixed(2)}`;
  }

  const providedTotal = receiptData.totalAmount || receiptData.total_amount || receiptData.totalDue || receiptData.total;
  const totalAmount = providedTotal !== undefined && Number(providedTotal) > 0
    ? parseFloat(providedTotal).toFixed(2)
    : (Number(subtotal) + Number(serviceVat) + Number(deliveryFeeNum)).toFixed(2);

  const subject = `Raalahami Royal Dining - Order Confirmation & Bill Receipt #${orderId}`;
  let html = '';

  // DINE-IN: Use Royal Heritage Dark & Gold Template
  if (orderType === 'DINE_IN') {
    html = generateDineInEmailHtml({
      customerName: recipientName,
      customerEmail: toEmail,
      orderId,
      diningDate,
      diningTime,
      hallName,
      tableNumber,
      partySize,
      orderItems: items,
      totalAmount,
    });
  } else if (orderType === 'TAKEAWAY') {
    // TAKEAWAY: Golden Warm Pickup Template
    const contentHtml = `
      <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px;">
        <h2 style="color: #064e3b; margin: 0 0 6px 0; font-size: 20px;">Raalahami Royal Dining - Takeaway Order Receipt</h2>
        <p style="margin: 0; color: #64748b; font-size: 14px;">Order Reference Number: <strong style="color: #065f46; font-size: 16px;">#${orderId}</strong></p>
      </div>

      <p style="font-size: 15px; color: #334155; line-height: 1.6;">
        Ayubowan <b>${recipientName}</b>, thank you for placing your takeaway order with <b>Raalahami Restaurant</b>.
      </p>

      <div style="background-color: #fefce8; border: 1px solid #fde047; border-radius: 8px; padding: 18px; margin: 20px 0;">
        <h3 style="color: #854d0e; margin: 0 0 12px 0; font-size: 16px; font-weight: 700;">
          🥡 ROYAL TAKEAWAY & PICKUP CONFIRMATION
        </h3>
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          <tr>
            <td style="padding: 5px 0; color: #4b5563; width: 35%;"><strong>Pickup Location:</strong></td>
            <td style="padding: 5px 0; color: #111827; font-weight: 600;">Raalahami Heritage Pickup Counter</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #4b5563;"><strong>Recipient:</strong></td>
            <td style="padding: 5px 0; color: #111827; font-weight: 600;">${recipientName}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #4b5563;"><strong>Estimated Prep Time:</strong></td>
            <td style="padding: 5px 0; color: #111827; font-weight: 600;">20–30 Minutes</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #4b5563;"><strong>Delivery Fee:</strong></td>
            <td style="padding: 5px 0; color: #15803d; font-weight: 600;">Royal Delivery: Rs. 0.00 (Self Pickup / Free)</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #4b5563;"><strong>Payment Method:</strong></td>
            <td style="padding: 5px 0; color: #111827; font-weight: 600;">${paymentMethod}</td>
          </tr>
          ${deliveryInstructions && deliveryInstructions !== 'None' ? `
          <tr>
            <td style="padding: 5px 0; color: #4b5563;"><strong>Special Instructions:</strong></td>
            <td style="padding: 5px 0; color: #92400e; font-weight: 500;">${deliveryInstructions}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      <!-- Itemized Bill Table -->
      <table class="table-container" style="width: 100%; border-collapse: collapse; margin-top: 18px; margin-bottom: 12px;">
        <thead>
          <tr style="background-color: #f1f5f9; text-align: left;">
            <th style="padding: 12px 10px; font-size: 12px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1;">Dish / Item</th>
            <th style="padding: 12px 10px; font-size: 12px; text-transform: uppercase; color: #475569; text-align: center; border-bottom: 2px solid #cbd5e1;">Qty</th>
            <th style="padding: 12px 10px; font-size: 12px; text-transform: uppercase; color: #475569; text-align: right; border-bottom: 2px solid #cbd5e1;">Price (LKR)</th>
            <th style="padding: 12px 10px; font-size: 12px; text-transform: uppercase; color: #475569; text-align: right; border-bottom: 2px solid #cbd5e1;">Total (LKR)</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml || '<tr><td colspan="4" style="text-align:center; color:#94a3b8; padding: 14px;">Items detailed in receipt.</td></tr>'}
        </tbody>
      </table>

      <!-- Bill Breakdown -->
      <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Subtotal:</td>
            <td style="padding: 6px 0; text-align: right; color: #1e293b; font-weight: 600;">LKR ${subtotal}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Service VAT (10%):</td>
            <td style="padding: 6px 0; text-align: right; color: #1e293b; font-weight: 600;">LKR ${serviceVat}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">${deliveryFeeLabel}</td>
            <td style="padding: 6px 0; text-align: right; color: #1e293b; font-weight: 600;">${deliveryFeeText}</td>
          </tr>
          <tr style="border-top: 2px solid #064e3b;">
            <td style="padding: 12px 0 6px 0; font-size: 16px; font-weight: 800; color: #064e3b;">Grand Total:</td>
            <td style="padding: 12px 0 6px 0; text-align: right; font-size: 17px; font-weight: 800; color: #064e3b;">LKR ${totalAmount}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #f8fafc; border-radius: 8px; padding: 18px; margin-top: 20px; border: 1px solid #e2e8f0;">
        <h4 style="margin: 0 0 8px 0; color: #0f172a; font-size: 14px;">Next Steps & Instructions:</h4>
        <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 13px; line-height: 1.6;">
          <li><strong>Estimated Preparation Time:</strong> 20–30 Minutes.</li>
          <li><strong>Pickup Location:</strong> Raalahami Heritage Pickup Counter, 123 Galle Road, Colombo 03.</li>
          <li><strong>Order Collection:</strong> Please quote <strong>#${orderId}</strong> at the pickup counter.</li>
        </ul>
      </div>
    `;

    html = renderEmailTemplate({
      title: subject,
      preheader: `Your Raalahami Takeaway Order #${orderId} has been confirmed. Total: LKR ${totalAmount}`,
      contentHtml,
      footerNote: 'Thank you for dining with Raalahami Royal Restaurant.',
    });
  } else {
    // DELIVERY: Home Delivery Receipt
    const contentHtml = `
      <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px;">
        <h2 style="color: #064e3b; margin: 0 0 6px 0; font-size: 20px;">Raalahami Royal Dining - Delivery Order Receipt</h2>
        <p style="margin: 0; color: #64748b; font-size: 14px;">Order Reference Number: <strong style="color: #065f46; font-size: 16px;">#${orderId}</strong></p>
      </div>

      <p style="font-size: 15px; color: #334155; line-height: 1.6;">
        Ayubowan <b>${recipientName}</b>, thank you for ordering delivery from <b>Raalahami Restaurant</b>.
      </p>

      <div style="background-color: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 18px; margin: 20px 0;">
        <h3 style="color: #115e59; margin: 0 0 12px 0; font-size: 16px; font-weight: 700;">
          🚚 DISPATCH CONFIRMATION - HOME DELIVERY
        </h3>
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          <tr>
            <td style="padding: 5px 0; color: #4b5563; width: 35%;"><strong>Recipient:</strong></td>
            <td style="padding: 5px 0; color: #111827; font-weight: 600;">${recipientName}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #4b5563;"><strong>Delivery Destination:</strong></td>
            <td style="padding: 5px 0; color: #111827; font-weight: 600;">${deliveryStreetAddress}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #4b5563;"><strong>Contact Phone:</strong></td>
            <td style="padding: 5px 0; color: #111827; font-weight: 600;">${phone}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #4b5563;"><strong>Delivery Instructions:</strong></td>
            <td style="padding: 5px 0; color: #92400e; font-weight: 500;">${deliveryInstructions}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #4b5563;"><strong>Delivery Fee:</strong></td>
            <td style="padding: 5px 0; color: #0f766e; font-weight: 600;">Royal Palace Delivery: Rs. ${deliveryFeeNum.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #4b5563;"><strong>Payment Method:</strong></td>
            <td style="padding: 5px 0; color: #111827; font-weight: 600;">${paymentMethod}</td>
          </tr>
        </table>
      </div>

      <!-- Itemized Bill Table -->
      <table class="table-container" style="width: 100%; border-collapse: collapse; margin-top: 18px; margin-bottom: 12px;">
        <thead>
          <tr style="background-color: #f1f5f9; text-align: left;">
            <th style="padding: 12px 10px; font-size: 12px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1;">Dish / Item</th>
            <th style="padding: 12px 10px; font-size: 12px; text-transform: uppercase; color: #475569; text-align: center; border-bottom: 2px solid #cbd5e1;">Qty</th>
            <th style="padding: 12px 10px; font-size: 12px; text-transform: uppercase; color: #475569; text-align: right; border-bottom: 2px solid #cbd5e1;">Price (LKR)</th>
            <th style="padding: 12px 10px; font-size: 12px; text-transform: uppercase; color: #475569; text-align: right; border-bottom: 2px solid #cbd5e1;">Total (LKR)</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml || '<tr><td colspan="4" style="text-align:center; color:#94a3b8; padding: 14px;">Items detailed in receipt.</td></tr>'}
        </tbody>
      </table>

      <!-- Bill Breakdown -->
      <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Subtotal:</td>
            <td style="padding: 6px 0; text-align: right; color: #1e293b; font-weight: 600;">LKR ${subtotal}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Service VAT (10%):</td>
            <td style="padding: 6px 0; text-align: right; color: #1e293b; font-weight: 600;">LKR ${serviceVat}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">${deliveryFeeLabel}</td>
            <td style="padding: 6px 0; text-align: right; color: #1e293b; font-weight: 600;">${deliveryFeeText}</td>
          </tr>
          <tr style="border-top: 2px solid #064e3b;">
            <td style="padding: 12px 0 6px 0; font-size: 16px; font-weight: 800; color: #064e3b;">Grand Total:</td>
            <td style="padding: 12px 0 6px 0; text-align: right; font-size: 17px; font-weight: 800; color: #064e3b;">LKR ${totalAmount}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #f8fafc; border-radius: 8px; padding: 18px; margin-top: 20px; border: 1px solid #e2e8f0;">
        <h4 style="margin: 0 0 8px 0; color: #0f172a; font-size: 14px;">Next Steps & Instructions:</h4>
        <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 13px; line-height: 1.6;">
          <li><strong>Estimated Preparation & Delivery:</strong> 30 – 45 minutes.</li>
          <li><strong>Cash Upon Delivery:</strong> Please have exact cash ready if paying COD.</li>
          <li><strong>Delivery Verification:</strong> Our courier will phone your contact number (${phone}) upon reaching your destination.</li>
          <li><strong>Order Reference Number:</strong> Please quote <strong>#${orderId}</strong> for any queries.</li>
        </ul>
      </div>
    `;

    html = renderEmailTemplate({
      title: subject,
      preheader: `Your Raalahami Order #${orderId} has been confirmed. Grand Total: LKR ${totalAmount}`,
      contentHtml,
      footerNote: 'Thank you for dining with Raalahami Royal Restaurant.',
    });
  }

  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject,
    html,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`✅ [ORDER CONFIRMATION SENT] to: ${toEmail} | Recipient: ${recipientName}`);
  return { success: true, messageId: info?.messageId };
};

/**
 * 3. Send 6-Digit Password Reset OTP Email
 */
const sendPasswordResetOtp = async (toEmail, otpCode) => {
  console.log('\n==================================================');
  console.log(`🔑 [OTP DISPATCH] Recipient: ${toEmail} | CODE: >>> ${otpCode} <<<`);
  console.log('==================================================\n');

  const mailOptions = {
    from: process.env.SMTP_FROM || `"Raalahami" <${smtpUser}>`,
    to: toEmail,
    subject: 'Raalahami Security - Password Reset OTP Code',
    html: `
      <div style="font-family: Arial, sans-serif; background: #0b0f19; color: #ffffff; padding: 24px; border-radius: 12px; border: 1px solid #d4af37;">
        <h2 style="color: #d4af37; margin-bottom: 8px;">Raalahami Royal Dining</h2>
        <p style="color: #cbd5e1;">You requested a password reset. Your 6-digit confidential code is:</p>
        <div style="background: #1e293b; padding: 16px; border-radius: 8px; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #fbbf24; text-align: center; margin: 20px 0;">
          ${otpCode}
        </div>
        <p style="color: #94a3b8; font-size: 13px;">This code will expire in 10 minutes. If you did not make this request, please ignore this email.</p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ [EMAIL DISPATCHED TO GMAIL]:', info.messageId, 'Recipient:', toEmail);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ [SMTP DISPATCH FAILED]:', error);
    throw error;
  }
};

/**
 * 4. Unified Royal Heritage Email Template Generator
 * Guarantees 100% design consistency across all outgoing admin responses and palace communications.
 */
const generateRoyalEmailTemplate = ({
  patronName = 'Valued Guest',
  inquiryType = 'General Inquiry',
  originalMessage = '',
  adminReply = '',
  inquiryId = '',
  preheader = '',
  repliedBy = 'Palace Concierge Administrator',
}) => {
  const cleanCustomerName = (patronName || 'Valued Guest').replace(/^Hon\.\s*/i, '').trim();
  const title = `Raalahami Royal Palace Concierge - Response to Your Inquiry: ${inquiryType}`;
  const previewText = preheader || `Official Royal Concierge response regarding "${inquiryType}" at Raalahami Restaurant.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #080c14; font-family: 'Georgia', 'Cambria', Times, serif; color: #f3f4f6; -webkit-font-smoothing: antialiased;">
  <!-- Preview Text -->
  <div style="display:none;font-size:1px;color:#333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${previewText}
  </div>

  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #080c14; padding: 40px 15px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 620px; background-color: #111827; border: 1px solid #d4af37; border-radius: 14px; overflow: hidden; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.75);">
          
          <!-- 1. Royal Crest Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 50%, #111827 100%); padding: 32px 24px; text-align: center; border-bottom: 2px solid #d4af37;">
              <div style="display: inline-block; padding: 6px 16px; border-radius: 9999px; background-color: rgba(212, 175, 55, 0.12); border: 1px solid rgba(212, 175, 55, 0.35); color: #f59e0b; font-size: 11px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                👑 PALACE CONCIERGE & FINE DINING
              </div>
              <h1 style="color: #f59e0b; margin: 0; font-size: 28px; letter-spacing: 3px; text-transform: uppercase; font-weight: 800;">
                RAALAHAMI
              </h1>
              <p style="color: #cbd5e1; margin: 6px 0 0; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                Royal Heritage Fine Dining • Ratnapura
              </p>
            </td>
          </tr>

          <!-- 2. Main Content Body -->
          <tr>
            <td style="padding: 36px 30px;">
              <!-- Title & Category Badge -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-bottom: 1px solid rgba(212, 175, 55, 0.3); padding-bottom: 14px; margin-bottom: 22px;">
                <tr>
                  <td>
                    <h2 style="color: #fbbf24; font-size: 21px; margin: 0; font-weight: 700;">
                      Palace Concierge Response
                    </h2>
                    <span style="font-size: 12px; color: #94a3b8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: inline-block; margin-top: 4px;">
                      Subject: <strong style="color: #e2e8f0;">${inquiryType}</strong>${inquiryId ? ` • Reference: <strong style="color: #f59e0b;">#${inquiryId}</strong>` : ''}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Salutation -->
              <p style="color: #e2e8f0; font-size: 16px; line-height: 1.7; margin: 0 0 14px 0;">
                Ayubowan <strong>Hon. ${cleanCustomerName}</strong>,
              </p>
              <p style="color: #cbd5e1; font-size: 14.5px; line-height: 1.7; margin: 0 0 24px 0;">
                Thank you for contacting <strong>Raalahami Restaurant</strong>. Our Royal Maître d' and Concierge Team have carefully reviewed your message and are pleased to provide the official response below.
              </p>

              <!-- Official Response Card -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #1e293b; border-left: 4px solid #f59e0b; border-right: 1px solid rgba(212, 175, 55, 0.25); border-top: 1px solid rgba(212, 175, 55, 0.25); border-bottom: 1px solid rgba(212, 175, 55, 0.25); border-radius: 8px; margin: 0 0 24px 0;">
                <tr>
                  <td style="padding: 22px;">
                    <div style="font-size: 11px; color: #f59e0b; text-transform: uppercase; letter-spacing: 1.5px; font-weight: bold; margin-bottom: 10px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                      👑 Official Royal Response ${repliedBy ? `(${repliedBy})` : ''}:
                    </div>
                    <div style="color: #ffffff; font-size: 15px; line-height: 1.8; white-space: pre-wrap; font-style: normal;">
                      ${adminReply}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Original Customer Inquiry Quote -->
              ${originalMessage ? `
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(15, 23, 42, 0.65); border: 1px solid #334155; border-radius: 8px; margin: 0 0 24px 0;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <span style="font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; font-weight: bold; display: block; margin-bottom: 6px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                      Your Inquiry (${inquiryType}):
                    </span>
                    <p style="color: #94a3b8; font-size: 13.5px; line-height: 1.6; margin: 0; font-style: italic;">
                      "${originalMessage}"
                    </p>
                  </td>
                </tr>
              </table>
              ` : ''}

              <!-- Verified Palace Coordinates Box -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(212, 175, 55, 0.07); border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 10px; margin: 0 0 24px 0;">
                <tr>
                  <td style="padding: 18px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                    <span style="color: #fbbf24; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 8px;">
                      📍 Palace Coordinates & Instant Desk:
                    </span>
                    <p style="color: #cbd5e1; font-size: 13px; line-height: 1.7; margin: 0;">
                      • <strong>Location:</strong> Riverside Road, Ratnapura, Sabaragamuwa Province, Sri Lanka<br/>
                      • <strong>Direct Telephone:</strong> +94 45 222 3456 / +94 77 123 4567<br/>
                      • <strong>WhatsApp VIP Concierge:</strong> +94 77 123 4567<br/>
                      • <strong>Online Menu & Reservations:</strong> <a href="${process.env.CORS_ORIGIN || 'http://localhost:3000'}" style="color: #f59e0b; text-decoration: underline; font-weight: bold;">Visit Raalahami Portal</a>
                    </p>
                  </td>
                </tr>
              </table>

              <p style="color: #94a3b8; font-size: 12.5px; margin: 0; text-align: center; line-height: 1.6; font-style: italic;">
                We remain honored to be at your royal service and look forward to welcoming you to the palace.
              </p>
            </td>
          </tr>

          <!-- 3. Royal Footer -->
          <tr>
            <td style="background-color: #0f172a; padding: 22px 24px; text-align: center; border-top: 1px solid #1e293b; font-size: 11.5px; color: #64748b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
              <p style="margin: 0 0 6px 0; color: #94a3b8;">
                © ${new Date().getFullYear()} Raalahami Fine Dining Restaurant. All Royal Rights Reserved.
              </p>
              <p style="margin: 0; color: #64748b; font-size: 11px;">
                Riverside Road, Ratnapura, Sri Lanka • Allergen Notice: Tree nuts, mustard & shellfish prepared on premises.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * 5. Send Royal Inquiry Response Email to Customer
 */
const sendInquiryReplyEmail = async ({
  toEmail,
  customerName = 'Valued Guest',
  inquirySubject = 'General Inquiry',
  originalMessage = '',
  adminReply = '',
  inquiryId = '',
  repliedBy = 'Palace Concierge Administrator',
}) => {
  const subject = `Raalahami Royal Palace Concierge - Response to Your Inquiry: ${inquirySubject}`;

  console.log('\n==================================================');
  console.log(`📩 [INQUIRY RESPONSE DISPATCH] Recipient: ${toEmail} | Subject: ${inquirySubject}`);
  console.log(`💬 Admin Reply: "${adminReply}"`);
  console.log('==================================================\n');

  // Strictly utilize the unified Royal Heritage HTML template generator
  const html = generateRoyalEmailTemplate({
    patronName: customerName,
    inquiryType: inquirySubject,
    originalMessage,
    adminReply,
    inquiryId,
    repliedBy,
  });

  const mailOptions = {
    from: process.env.SMTP_FROM || `"Raalahami Concierge" <${smtpUser}>`,
    to: toEmail,
    subject,
    html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ [INQUIRY REPLY EMAIL DISPATCHED TO GMAIL]:', info.messageId, 'Recipient:', toEmail);
    return { success: true, messageId: info.messageId, html };
  } catch (error) {
    console.warn('⚠️ [INQUIRY REPLY EMAIL WARNING]: Could not dispatch SMTP email (using simulated response):', error.message || error);
    return { success: false, error: error.message, simulated: true, html };
  }
};

const emailService = {
  transporter,
  resolvePaymentMethodName,
  formatDiningDate,
  formatDiningTime,
  generateDineInEmailHtml,
  generateRoyalEmailTemplate,
  sendWelcomeEmail,
  sendOrderConfirmationEmail,
  sendPasswordResetOtp,
  sendInquiryReplyEmail,
};

module.exports = emailService;
