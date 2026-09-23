/**
 * Custom Operational Application Error Class
 */
class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Global Error Handling Aspect (AOP)
 * Catches all unhandled rejections and operational exceptions across all modules.
 * Standardizes API responses and masks internal database leaks in production.
 */
const errorAspect = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let details = err.details || null;

  // Handle specific PostgreSQL error codes
  if (err.code) {
    switch (err.code) {
      case '23505': // Unique key violation
        statusCode = 409;
        message = 'Conflict: Duplicate record already exists.';
        details = err.detail || null;
        break;
      case '23503': // Foreign key violation
        statusCode = 400;
        message = 'Bad Request: Referenced entity does not exist.';
        details = err.detail || null;
        break;
      case '23514': // Check constraint violation
        statusCode = 400;
        message = 'Bad Request: Constraint violation encountered.';
        details = err.detail || null;
        break;
      case '22P02': // Invalid text representation (e.g. invalid UUID format)
        statusCode = 400;
        message = 'Bad Request: Invalid format or identifier.';
        break;
      default:
        break;
    }
  }

  // Handle JSON parse errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400;
    message = 'Bad Request: Malformed JSON syntax in request body.';
  }

  // Log error details for diagnosis
  console.error(`[AOP:ErrorHandler] [Status: ${statusCode}] ${req.method} ${req.originalUrl}:`, {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    code: err.code,
  });

  res.status(statusCode).json({
    success: false,
    message,
    details: process.env.NODE_ENV === 'development' ? details || err.stack : details,
    timestamp: new Date().toISOString(),
  });
};

module.exports = {
  AppError,
  errorAspect,
};
