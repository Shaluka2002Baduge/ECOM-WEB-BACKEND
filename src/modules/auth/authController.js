const authService = require('./authService');
const { AppError } = require('../../middleware/errorAspect');

/**
 * Handle user registration request
 */
const register = async (req, res, next) => {
  try {
    const { displayName, email, password, phone, role } = req.body;

    if (!displayName || !email || !password) {
      throw new AppError('displayName, email, and password are required fields.', 400);
    }

    if (password.length < 6) {
      throw new AppError('Password must be at least 6 characters in length.', 400);
    }

    // Prevent non-admin users from registering as staff/admin directly through public endpoint
    const safeRole = role && ['ADMIN', 'MANAGER', 'KITCHEN_STAFF', 'WAITER'].includes(role)
      ? 'CUSTOMER'
      : role || 'CUSTOMER';

    const { user, token } = await authService.registerUser({
      displayName,
      email,
      password,
      phone,
      role: safeRole,
    });

    res.status(201).json({
      success: true,
      message: 'User account registered successfully.',
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handle user login request
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Both email and password are required.', 400);
    }

    const { user, token } = await authService.loginUser({ email, password });

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: {
        user,
        token,
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
    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully.',
      data: {
        user: req.user,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  getMe,
};
