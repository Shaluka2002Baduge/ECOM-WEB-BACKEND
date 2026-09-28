const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const db = require('../src/config/db');
const emailService = require('../src/services/emailService');
const authService = require('../src/modules/auth/authService');

describe('Email Service & Forgot Password OTP Flow (CIS007-3 / CIS045-3 Standards)', () => {
  const secret = process.env.JWT_SECRET || 'ralahami_super_secret_jwt_key_2026_change_in_production';

  const mockCustomer = {
    id: '11111111-2222-3333-4444-555555555599',
    displayName: 'Kamal Perera',
    email: 'kamal.perera@example.com',
    role: 'CUSTOMER',
  };

  const mockCustomerToken = jwt.sign(mockCustomer, secret);

  beforeEach(() => {
    // Clear in-memory OTP store before each test
    authService.otpStore.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ====================================================================
  // 1. EMAIL SERVICE TEMPLATES & DISPATCH TESTS
  // ====================================================================
  describe('Email Service Branded Templates & Dispatch', () => {
    test('sendWelcomeEmail generates branded HTML containing user display name', async () => {
      const emailSpy = jest.spyOn(emailService.transporter, 'sendMail').mockResolvedValueOnce({
        messageId: 'mock-welcome-id',
      });

      const res = await emailService.sendWelcomeEmail('test@ralahami.lk', 'Anoma Silva');

      expect(emailSpy).toHaveBeenCalledTimes(1);
      const callArgs = emailSpy.mock.calls[0][0];
      expect(callArgs.to).toBe('test@ralahami.lk');
      expect(callArgs.subject).toContain('Welcome to Raalahami');
      expect(callArgs.html).toContain('Raalahami');
      expect(callArgs.html).toContain('Anoma Silva');
      expect(res.success).toBe(true);
    });

    test('sendOrderConfirmationEmail generates itemized dishes, prices, total LKR, and instructions', async () => {
      const emailSpy = jest.spyOn(emailService.transporter, 'sendMail').mockResolvedValueOnce({
        messageId: 'mock-order-id',
      });

      const mockOrder = {
        id: 701,
        customerName: 'Sunil Shantha',
        order_type: 'TAKEAWAY',
        total_amount: '3450.00',
        notes: 'Extra spicy sambal please',
        items: [
          { name: 'Lamprais Special', quantity: 2, unitPrice: '1500.00', specialInstructions: 'Banana leaf wrapped' },
          { name: 'Watalappam Pot', quantity: 1, unitPrice: '450.00' },
        ],
      };

      const res = await emailService.sendOrderConfirmationEmail('sunil@example.com', mockOrder);

      expect(emailSpy).toHaveBeenCalledTimes(1);
      const callArgs = emailSpy.mock.calls[0][0];
      expect(callArgs.to).toBe('sunil@example.com');
      expect(callArgs.subject).toContain('#701');
      expect(callArgs.html).toContain('Lamprais Special');
      expect(callArgs.html).toContain('Watalappam Pot');
      expect(callArgs.html).toContain('LKR 3450.00');
      expect(res.success).toBe(true);
    });

    test('sendPasswordResetOtp formats 6-digit OTP code and 10-minute expiry warning', async () => {
      const emailSpy = jest.spyOn(emailService.transporter, 'sendMail').mockResolvedValueOnce({
        messageId: 'mock-otp-id',
      });

      const res = await emailService.sendPasswordResetOtp('user@ralahami.lk', '654321');

      expect(emailSpy).toHaveBeenCalledTimes(1);
      const callArgs = emailSpy.mock.calls[0][0];
      expect(callArgs.to).toBe('user@ralahami.lk');
      expect(callArgs.subject).toContain('Password Reset');
      expect(callArgs.html).toContain('654321');
      expect(callArgs.html).toContain('10 minutes');
      expect(res.success).toBe(true);
    });
  });

  // ====================================================================
  // 2. TRIGGER WELCOME EMAIL ON REGISTRATION
  // ====================================================================
  describe('Trigger Welcome Email upon Registration', () => {
    test('POST /api/auth/register triggers sendWelcomeEmail asynchronously', async () => {
      const welcomeSpy = jest.spyOn(emailService, 'sendWelcomeEmail').mockResolvedValueOnce({
        success: true,
      });

      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [] }) // Email check: available
        .mockResolvedValueOnce({
          rows: [
            {
              id: '99999999-9999-9999-9999-999999999999',
              display_name: 'Nayani Jayasinghe',
              email: 'nayani@example.com',
              role: 'CUSTOMER',
              created_at: new Date().toISOString(),
            },
          ],
        });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          displayName: 'Nayani Jayasinghe',
          email: 'nayani@example.com',
          password: 'Password123!',
          phone: '+94771239999',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(welcomeSpy).toHaveBeenCalledWith('nayani@example.com', 'Nayani Jayasinghe');
    });
  });

  // ====================================================================
  // 3. TRIGGER ORDER CONFIRMATION FOR GUEST & REGISTERED USERS
  // ====================================================================
  describe('Trigger Order Confirmation Email (Guest & Registered)', () => {
    test('POST /api/orders triggers confirmation email for Authenticated Customer', async () => {
      const orderSpy = jest.spyOn(emailService, 'sendOrderConfirmationEmail').mockResolvedValueOnce({
        success: true,
      });

      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      jest.spyOn(db, 'getClient').mockResolvedValueOnce(mockClient);

      // BEGIN -> Menu query -> Insert Order -> Insert Item -> COMMIT
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 10, name: 'Devilled Chicken', price: '1800.00', is_available: true }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 801, user_id: mockCustomer.id, status: 'PLACED', total_amount: '1800.00' }],
        })
        .mockResolvedValueOnce({}) // line item
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${mockCustomerToken}`)
        .send({
          items: [{ menuItemId: 10, quantity: 1 }],
          orderType: 'DINE_IN',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(orderSpy).toHaveBeenCalledTimes(1);
      expect(orderSpy).toHaveBeenCalledWith(
        mockCustomer.email,
        expect.objectContaining({
          id: 801,
          customerName: mockCustomer.displayName,
        })
      );
    });

    test('POST /api/orders triggers confirmation email for Guest Checkout via req.body.customerEmail', async () => {
      const orderSpy = jest.spyOn(emailService, 'sendOrderConfirmationEmail').mockResolvedValueOnce({
        success: true,
      });

      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      jest.spyOn(db, 'getClient').mockResolvedValueOnce(mockClient);

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 12, name: 'Seafood Kottu', price: '2200.00', is_available: true }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 802, user_id: null, status: 'PLACED', total_amount: '2200.00' }],
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/api/orders')
        .send({
          customerEmail: 'guest.patron@example.com',
          customerName: 'Guest Patron',
          items: [{ menuItemId: 12, quantity: 1 }],
          orderType: 'DELIVERY',
          notes: 'Doorbell is broken, please call',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(orderSpy).toHaveBeenCalledTimes(1);
      expect(orderSpy).toHaveBeenCalledWith(
        'guest.patron@example.com',
        expect.objectContaining({
          id: 802,
          customerName: 'Guest Patron',
        })
      );
    });

    test('POST /api/orders extracts email from patronEmail and deliveryContact.email fields', async () => {
      const orderSpy = jest.spyOn(emailService, 'sendOrderConfirmationEmail').mockResolvedValueOnce({
        success: true,
      });

      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      jest.spyOn(db, 'getClient').mockResolvedValueOnce(mockClient);

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 14, name: 'Egg Roti', price: '300.00', is_available: true }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 803, user_id: null, status: 'PLACED', total_amount: '600.00' }],
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/api/orders')
        .send({
          deliveryContact: { email: 'patron.delivery@example.com' },
          deliveryStreetAddress: 'No. 45 Queen Street, Colombo',
          paymentMethod: 'Cash Upon Delivery (COD)',
          items: [{ menuItemId: 14, quantity: 2 }],
        });

      expect(response.status).toBe(201);
      expect(orderSpy).toHaveBeenCalledWith(
        'patron.delivery@example.com',
        expect.objectContaining({
          id: 803,
          deliveryStreetAddress: 'No. 45 Queen Street, Colombo',
          paymentMethod: 'Cash Upon Delivery (COD)',
        })
      );
    });

    test('POST /api/orders warns and skips email when no recipient email is present', async () => {
      const orderSpy = jest.spyOn(emailService, 'sendOrderConfirmationEmail');
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      jest.spyOn(db, 'getClient').mockResolvedValueOnce(mockClient);

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 15, name: 'String Hoppers', price: '450.00', is_available: true }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 804, user_id: null, status: 'PLACED', total_amount: '450.00' }],
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/api/orders')
        .send({
          items: [{ menuItemId: 15, quantity: 1 }],
        });

      expect(response.status).toBe(201);
      expect(orderSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[RECEIPT EMAIL SKIPPED]'));
      warnSpy.mockRestore();
    });

    test('POST /api/orders does not fail order placement if async email dispatch throws', async () => {
      jest.spyOn(emailService, 'sendOrderConfirmationEmail').mockRejectedValueOnce(
        new Error('SMTP connection timed out')
      );
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      jest.spyOn(db, 'getClient').mockResolvedValueOnce(mockClient);

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 16, name: 'Pol Roti', price: '200.00', is_available: true }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 805, user_id: null, status: 'PLACED', total_amount: '200.00' }],
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/api/orders')
        .send({
          email: 'retry.later@example.com',
          items: [{ menuItemId: 16, quantity: 1 }],
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      // Wait for microtask queue to process async .catch handler
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(errorSpy).toHaveBeenCalledWith(
        '❌ [RECEIPT DISPATCH ERROR]:',
        'SMTP connection timed out'
      );
      errorSpy.mockRestore();
    });
  });

  // ====================================================================
  // 4. FORGOT PASSWORD & 6-DIGIT OTP FLOW
  // ====================================================================
  describe('Forgot Password & 6-Digit OTP Endpoints', () => {
    test('POST /api/auth/forgot-password generates 6-digit OTP, stores expiry, and dispatches email', async () => {
      const otpSpy = jest.spyOn(emailService, 'sendPasswordResetOtp').mockResolvedValueOnce({
        success: true,
      });

      jest.spyOn(db, 'query')
        .mockResolvedValueOnce({
          rows: [{ id: 'user-uuid-1', display_name: 'Nimal', email: 'nimal@ralahami.lk' }],
        }) // User lookup
        .mockResolvedValueOnce({}); // DB OTP update

      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nimal@ralahami.lk' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toMatch(/verification code sent/i);
      expect(otpSpy).toHaveBeenCalledTimes(1);

      const [recipient, sentOtp] = otpSpy.mock.calls[0];
      expect(recipient).toBe('nimal@ralahami.lk');
      expect(sentOtp).toMatch(/^\d{6}$/); // Exactly 6 digits

      // Verify stored in memory cache with valid expiry
      const cached = authService.otpStore.get('nimal@ralahami.lk');
      expect(cached).toBeDefined();
      expect(cached.otp).toBe(sentOtp);
      expect(cached.expiresAt).toBeGreaterThan(Date.now());
    });

    test('POST /api/auth/forgot-password returns 404 if email does not exist', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/no account found/i);
    });

    test('POST /api/auth/forgot-password returns 400 if email is missing', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('POST /api/auth/verify-otp successfully validates correct unexpired OTP', async () => {
      // Pre-seed OTP in store
      authService.otpStore.set('testuser@ralahami.lk', {
        otp: '482910',
        expiresAt: Date.now() + 10 * 60 * 1000,
        userId: 'user-1',
      });

      const response = await request(app)
        .post('/api/auth/verify-otp')
        .send({
          email: 'testuser@ralahami.lk',
          otp: '482910',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toMatch(/OTP verified successfully/i);
    });

    test('POST /api/auth/verify-otp rejects incorrect OTP code with 400', async () => {
      authService.otpStore.set('testuser@ralahami.lk', {
        otp: '123456',
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      const response = await request(app)
        .post('/api/auth/verify-otp')
        .send({
          email: 'testuser@ralahami.lk',
          otp: '999999',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/Invalid verification code/i);
    });

    test('POST /api/auth/verify-otp rejects expired OTP code with 400', async () => {
      authService.otpStore.set('expired@ralahami.lk', {
        otp: '555666',
        expiresAt: Date.now() - 1000, // Expired 1 second ago
      });

      const response = await request(app)
        .post('/api/auth/verify-otp')
        .send({
          email: 'expired@ralahami.lk',
          otp: '555666',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/expired/i);
    });

    test('POST /api/auth/reset-password hashes new password, updates DB, and clears OTP', async () => {
      const email = 'resetuser@ralahami.lk';
      const validOtp = '777888';

      authService.otpStore.set(email, {
        otp: validOtp,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      const dbUpdateSpy = jest.spyOn(db, 'query').mockResolvedValueOnce({ rowCount: 1 });

      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({
          email,
          otp: validOtp,
          newPassword: 'BrandNewSecurePassword2026!',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toMatch(/Password has been reset successfully/i);

      // Verify db query executed with hashed password
      expect(dbUpdateSpy).toHaveBeenCalledTimes(1);
      const queryParams = dbUpdateSpy.mock.calls[0][1];
      const hashedPassword = queryParams[0];
      expect(hashedPassword).not.toBe('BrandNewSecurePassword2026!');
      const isMatch = await bcrypt.compare('BrandNewSecurePassword2026!', hashedPassword);
      expect(isMatch).toBe(true);

      // Verify OTP is cleared from memory cache to prevent replay attacks
      expect(authService.otpStore.has(email)).toBe(false);
    });

    test('POST /api/auth/reset-password rejects short or weak password with 400', async () => {
      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({
          email: 'resetuser@ralahami.lk',
          otp: '123456',
          newPassword: '123',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/at least 6 characters/i);
    });
  });

  // ====================================================================
  // 6. TYPE-SPECIFIC ORDER RECEIPTS & RECIPIENT NAME HONORING
  // ====================================================================
  describe('Type-specific Email Receipts & Recipient Name Honoring', () => {
    test('sendOrderConfirmationEmail renders DINE_IN reservation box and complimentary delivery fee', async () => {
      const emailSpy = jest.spyOn(emailService.transporter, 'sendMail').mockResolvedValueOnce({
        messageId: 'mock-dinein-id',
      });

      const dineInOrder = {
        orderId: 'RAALAHAMI-889900',
        recipientName: 'Hon. Pradeep Fernando',
        orderType: 'DINE_IN',
        reservation: {
          diningDate: '2026-10-05',
          diningTime: '19:30',
          guestsCount: 4,
          seatingPreference: 'Intimate Garden Veranda',
        },
        items: [
          { name: 'Jaffna Fiery Lagoon Crab Curry', quantity: 1, unitPrice: '3800.00' },
        ],
        subtotal: 3800,
        serviceVat: 380,
        deliveryFee: 0,
        totalAmount: 4180,
        paymentMethod: 'CREDIT_CARD',
      };

      const result = await emailService.sendOrderConfirmationEmail('pradeep@example.lk', dineInOrder);

      expect(result.success).toBe(true);
      expect(emailSpy).toHaveBeenCalledTimes(1);
      const callArgs = emailSpy.mock.calls[0][0];
      expect(callArgs.html).toContain('Ayubowan <b>Hon. Pradeep Fernando</b>');
      expect(callArgs.html).toContain('🍽️ CONFIRMED ROYAL TABLE RESERVATION');
      expect(callArgs.html).toContain('2026-10-05');
      expect(callArgs.html).toContain('19:30');
      expect(callArgs.html).toContain('4 Guests');
      expect(callArgs.html).toContain('Intimate Garden Veranda');
      expect(callArgs.html).toContain('Your table will be held for 15 minutes past reserved time.');
      expect(callArgs.html).toContain('Royal Delivery: Rs. 0.00 (Dine-In Complimentary)');
      expect(callArgs.html).toContain('LKR 4180.00');
    });

    test('sendOrderConfirmationEmail renders TAKEAWAY pickup counter box and free delivery fee', async () => {
      const emailSpy = jest.spyOn(emailService.transporter, 'sendMail').mockResolvedValueOnce({
        messageId: 'mock-takeaway-id',
      });

      const takeawayOrder = {
        orderId: 'RAALAHAMI-778899',
        recipientName: 'Chathurika De Silva',
        orderType: 'TAKEAWAY',
        items: [
          { name: 'Signature Cheese Chicken Kottu', quantity: 2, unitPrice: '1550.00' },
        ],
        subtotal: 3100,
        serviceVat: 310,
        deliveryFee: 0,
        totalAmount: 3410,
        paymentMethod: 'CASH_ON_DELIVERY',
      };

      const result = await emailService.sendOrderConfirmationEmail('chathurika@example.lk', takeawayOrder);

      expect(result.success).toBe(true);
      const callArgs = emailSpy.mock.calls[0][0];
      expect(callArgs.html).toContain('Ayubowan <b>Chathurika De Silva</b>');
      expect(callArgs.html).toContain('🥡 ROYAL TAKEAWAY & PICKUP CONFIRMATION');
      expect(callArgs.html).toContain('Raalahami Heritage Pickup Counter');
      expect(callArgs.html).toContain('20–30 Minutes');
      expect(callArgs.html).toContain('Royal Delivery: Rs. 0.00 (Self Pickup / Free)');
    });

    test('sendOrderConfirmationEmail renders DELIVERY dispatch box with address, phone, and Rs. 450.00 delivery fee', async () => {
      const emailSpy = jest.spyOn(emailService.transporter, 'sendMail').mockResolvedValueOnce({
        messageId: 'mock-delivery-id',
      });

      const deliveryOrder = {
        orderId: 'RAALAHAMI-667788',
        recipientName: 'Kavinda Perera',
        orderType: 'DELIVERY',
        deliveryStreetAddress: 'No. 24, Flower Road, Colombo 07',
        phone: '+94778899001',
        deliveryInstructions: 'Ring the front gate buzzer',
        items: [
          { name: 'Ceylon Black Pepper Chicken Curry', quantity: 1, unitPrice: '1650.00' },
        ],
        subtotal: 1650,
        serviceVat: 165,
        deliveryFee: 450,
        totalAmount: 2265,
        paymentMethod: 'CASH_ON_DELIVERY',
      };

      const result = await emailService.sendOrderConfirmationEmail('kavinda@example.lk', deliveryOrder);

      expect(result.success).toBe(true);
      const callArgs = emailSpy.mock.calls[0][0];
      expect(callArgs.html).toContain('Ayubowan <b>Kavinda Perera</b>');
      expect(callArgs.html).toContain('🚚 DISPATCH CONFIRMATION - HOME DELIVERY');
      expect(callArgs.html).toContain('No. 24, Flower Road, Colombo 07');
      expect(callArgs.html).toContain('+94778899001');
      expect(callArgs.html).toContain('Ring the front gate buzzer');
      expect(callArgs.html).toContain('Royal Palace Delivery: Rs. 450.00');
    });

    test('POST /api/orders prioritizes explicitly typed recipientName over account name', async () => {
      const orderSpy = jest.spyOn(emailService, 'sendOrderConfirmationEmail').mockResolvedValueOnce({
        success: true,
      });

      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      jest.spyOn(db, 'getClient').mockResolvedValueOnce(mockClient);

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'Fish Cutlets', price: '650.00', is_available: true }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 999, user_id: null, status: 'PLACED', total_amount: '650.00', order_number: 'RAALAHAMI-999999', recipient_name: 'Explicit Recipient VIP' }],
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/api/orders')
        .send({
          recipientName: 'Explicit Recipient VIP',
          customerName: 'Fallback Account Name',
          customerEmail: 'vip@example.com',
          phone: '+94770001111',
          deliveryStreetAddress: '100 Marine Drive',
          orderType: 'DELIVERY',
          items: [{ menuItemId: 1, quantity: 1 }],
        });

      expect(response.status).toBe(201);
      expect(orderSpy).toHaveBeenCalledTimes(1);
      expect(orderSpy).toHaveBeenCalledWith(
        'vip@example.com',
        expect.objectContaining({
          recipientName: 'Explicit Recipient VIP',
          phone: '+94770001111',
          deliveryStreetAddress: '100 Marine Drive',
          deliveryFee: 450,
        })
      );
    });

    test('resolvePaymentMethodName formats Cash on Delivery (COD) for DELIVERY and Counter Settlement for DINE_IN/TAKEAWAY', () => {
      expect(emailService.resolvePaymentMethodName('CASH', 'DELIVERY')).toBe('Cash on Delivery (COD)');
      expect(emailService.resolvePaymentMethodName('COD', 'DELIVERY')).toBe('Cash on Delivery (COD)');
      expect(emailService.resolvePaymentMethodName('CASH_ON_DELIVERY', 'DELIVERY')).toBe('Cash on Delivery (COD)');
      expect(emailService.resolvePaymentMethodName('CASH', 'TAKEAWAY')).toBe('Counter Settlement');
      expect(emailService.resolvePaymentMethodName('COUNTER_SETTLEMENT', 'TAKEAWAY')).toBe('Counter Settlement');
      expect(emailService.resolvePaymentMethodName('CASH', 'DINE_IN')).toBe('Counter Settlement');
      expect(emailService.resolvePaymentMethodName('CARD', 'DELIVERY')).toBe('Credit / Debit Card (Online)');
      expect(emailService.resolvePaymentMethodName('ONLINE_CARD', 'TAKEAWAY')).toBe('Credit / Debit Card (Online)');
      expect(emailService.resolvePaymentMethodName('DIGITAL_WALLET', 'DINE_IN')).toBe('Digital Wallet');
    });
  });
});
