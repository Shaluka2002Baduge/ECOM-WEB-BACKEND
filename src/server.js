const app = require('./app');
const { pool } = require('./config/db');

const PORT = process.env.PORT || 5000;

// Catch uncaught exceptions during startup
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception encountered:', err);
  process.exit(1);
});

// Start listening on configured port
const server = app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(`🚀 Ralahami Restaurant Backend Server Operational`);
  console.log(`📡 Network Protocol: RESTful JSON over HTTP`);
  console.log(`🔌 Listening Port   : http://localhost:${PORT}`);
  console.log(`🌱 Environment      : ${process.env.NODE_ENV || 'development'}`);
  console.log(`====================================================`);

  // Verify PostgreSQL database connectivity
  try {
    const res = await pool.query('SELECT NOW() AS server_time');
    console.log(`✅ [Database Connection]: PostgreSQL Connected Successfully at ${res.rows[0].server_time}`);
  } catch (error) {
    console.warn(`⚠️ [Database Connection Warning]: Could not connect to PostgreSQL: ${error.message}`);
    console.warn(`👉 Ensure PostgreSQL service is running and DATABASE_URL in .env is configured.`);
  }
});

// Graceful shutdown handler
const gracefulShutdown = (signal) => {
  console.log(`\n[Process] Received ${signal}. Commencing graceful server shutdown...`);
  server.close(async () => {
    console.log('[HTTP Server]: Closed remaining active connections.');
    try {
      await pool.end();
      console.log('[Database Pool]: Successfully drained all client connections.');
      process.exit(0);
    } catch (err) {
      console.error('[Database Pool]: Error while draining connections:', err);
      process.exit(1);
    }
  });

  // Force close after 10s if shutdown hangs
  setTimeout(() => {
    console.error('[Process]: Graceful shutdown timed out. Forcing process termination.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});
