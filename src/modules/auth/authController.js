const authService = require('./authService');
const emailService = require('../../services/emailService');
const { AppError } = require('../../middleware/errorAspect');

/**
 * Handle user registration request
 */
const register = async (req, res, next) => {
  try {
    const displayName = req.body?.displayName || req.body?.fullName || req.body?.name;
    const { email, password, phone, role } = req.body || {};

    if (!displayName || !email || !password) {
      throw new AppError('displayName, email, and password are required fields.', 400);
    }

    // Prevent non-admin users from registering as staff/admin directly through public endpoint
    const safeRole = role && ['ADMIN', 'MANAGER', 'KITCHEN_STAFF', 'WAITER'].includes(role)
      ? 'CUSTOMER'
      : role || 'CUSTOMER';

    await authService.registerUser({
      displayName,
      email,
      password,
      phone,
      role: safeRole,
    });

    // Trigger branded Welcome Email asynchronously without blocking client response
    emailService.sendWelcomeEmail(email, displayName).catch((err) => {
      console.error(`[AuthController] Async welcome email failed for ${email}:`, err.message);
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please sign in to continue.',
    });
  } catch (error) {
    next(error);
  }
};


/**
 * Handle user login request
 * Strictly accepts ONLY email and password.
 * Sets HTTP-Only secure cookie AND returns JSON payload:
 * { success: true, token, user: { id, displayName, email, role } }
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      throw new AppError('Both email and password are required.', 400);
    }

    const { user, token } = await authService.loginUser({ email, password });

    // Set HTTP-Only secure cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    const userPayload = {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
    };

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: userPayload,
      data: {
        token,
        user: userPayload,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get profile of current logged-in user
 */
const getMe = async (req, res, next) => {
  try {
    const userPayload = {
      id: req.user.id,
      displayName: req.user.displayName || req.user.display_name,
      email: req.user.email,
      role: req.user.role,
    };

    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully.',
      user: userPayload,
      data: {
        user: userPayload,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Clear authentication session and HTTP-Only cookie
 */
const logout = async (req, res, next) => {
  try {
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handle forgot password request
 * POST /api/auth/forgot-password: { email }
 */
const forgotPassword = async (req, res, next) => {
  try {
    const email = req.body?.email?.trim().toLowerCase();
    if (!email) {
      throw new AppError('Email address is required.', 400);
    }

    const { user, otpCode } = await authService.forgotPassword({ email });

    // Explicitly await email dispatch so any SMTP handshake errors are visible in terminal
    await emailService.sendPasswordResetOtp(user.email, otpCode);

    res.status(200).json({
      success: true,
      message: 'Verification code sent to your email.',
    });
  } catch (error) {
    console.error('❌ [AUTH CONTROLLER] Forgot password error:', error.message || error);
    next(error);
  }
};

/**
 * Handle OTP verification request
 * POST /api/auth/verify-otp: { email, otp }
 */
const verifyOtp = async (req, res, next) => {
  try {
    const email = req.body?.email?.trim().toLowerCase();
    const otp = req.body?.otp;
    if (!email || !otp) {
      throw new AppError('Email and OTP code are required.', 400);
    }

    await authService.verifyOtp({ email, otp });

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully. You may now reset your password.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handle password reset request
 * POST /api/auth/reset-password: { email, otp, newPassword }
 */
const resetPassword = async (req, res, next) => {
  try {
    const email = req.body?.email?.trim().toLowerCase();
    const otp = req.body?.otp;
    const newPassword = req.body?.newPassword || req.body?.password;

    if (!email || !otp || !newPassword) {
      throw new AppError('Email, OTP code, and new password are required.', 400);
    }

    await authService.resetPassword({ email, otp, newPassword });

    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  getMe,
  logout,
  forgotPassword,
  verifyOtp,
  resetPassword,
};


