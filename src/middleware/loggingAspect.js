/**
 * Logging Aspect (AOP)
 * Intercepts incoming HTTP requests and responses to monitor latency,
 * status codes, and network traffic without polluting domain controllers.
 */
const loggingAspect = (req, res, next) => {
  const startTime = Date.now();
  const { method, originalUrl, ip } = req;

  // Intercept completion of the response pipeline
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const statusColor =
      statusCode >= 500
        ? '\x1b[31m' // Red
        : statusCode >= 400
        ? '\x1b[33m' // Yellow
        : statusCode >= 300
        ? '\x1b[36m' // Cyan
        : '\x1b[32m'; // Green
    const resetColor = '\x1b[0m';

    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] [AOP:Logger] ${method} ${originalUrl} -> ${statusColor}${statusCode}${resetColor} (${duration}ms) - IP: ${ip}`
    );
  });

  next();
};

module.exports = loggingAspect;
