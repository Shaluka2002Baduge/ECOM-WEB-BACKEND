const jwt = require('jsonwebtoken');

/**
 * Authentication Aspect (AOP)
 * Intercepts protected requests, verifies JWT authenticity,
 * and populates req.user.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token =
    (authHeader && authHeader.startsWith('Bearer ') && authHeader.split(' ')[1]) ||
    (req.cookies && req.cookies.token);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access Denied: Missing authentication token.',
      code: 'AUTH_TOKEN_REQUIRED',
    });
  }

  try {
    const secret = process.env.JWT_SECRET || 'ralahami_fallback_secret_key';
    const decoded = jwt.verify(token, secret);
    req.user = decoded; // { id, email, role, display_name }
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Authentication session expired. Please log in again.',
        code: 'AUTH_TOKEN_EXPIRED',
      });
    }

    return res.status(403).json({
      success: false,
      message: 'Invalid or malformed authentication token.',
      code: 'AUTH_TOKEN_INVALID',
    });
  }
};

/**
 * Role-Based Access Control Aspect (RBAC)
 * Restricts endpoint invocation to specific user roles.
 * Allowed roles: 'CUSTOMER', 'KITCHEN_STAFF', 'WAITER', 'MANAGER', 'ADMIN'
 * @param  {...string} allowedRoles
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User role context not found.',
        code: 'USER_ROLE_MISSING',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Access requires one of the following roles: [${allowedRoles.join(', ')}].`,
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  authorizeRoles,
};
