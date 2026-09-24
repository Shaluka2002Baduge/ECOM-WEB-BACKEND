const jwt = require('jsonwebtoken');

/**
 * Authentication Aspect (AOP) - Token Verification Guard
 * Verifies JWT authenticity from HTTP-Only cookie or Authorization header.
 * Populates req.user with { id, displayName, email, role }.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const verifyToken = (req, res, next) => {
  let token = null;

  // 1. Extract from Authorization header (Bearer <token>)
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else {
      token = authHeader.trim();
    }
  }

  // 2. Fallback to HTTP-Only cookie if not provided in header
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

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

    // Normalize user payload on req.user for downstream handlers & guards
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      displayName: decoded.displayName || decoded.display_name,
      display_name: decoded.displayName || decoded.display_name,
    };

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
 * Role-Based Access Control Aspect (RBAC) - Role Guard
 * Restricts endpoint invocation strictly to designated user roles.
 * Allowed roles: 'CUSTOMER', 'KITCHEN_STAFF', 'WAITER', 'MANAGER', 'ADMIN'
 *
 * Rejects unauthorized users with HTTP 403 Forbidden.
 *
 * @param  {...string|string[]} roles - Allowed role(s) passed as array or variable arguments
 * @returns {import('express').RequestHandler}
 */
const requireRole = (...roles) => {
  // Support both requireRole(['ADMIN', 'MANAGER']) and requireRole('ADMIN', 'MANAGER')
  const allowedRoles = roles.flat();

  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User authentication context required.',
        code: 'USER_ROLE_MISSING',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Access requires one of the following roles: [${allowedRoles.join(', ')}]. Current role: '${req.user.role}'.`,
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }

    next();
  };
};

// Aliases for seamless backward compatibility
const authenticateToken = verifyToken;
const authorizeRoles = requireRole;

module.exports = {
  verifyToken,
  authenticateToken,
  requireRole,
  authorizeRoles,
};

