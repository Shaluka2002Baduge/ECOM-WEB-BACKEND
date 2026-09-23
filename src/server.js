const app = require('./app');
const { pool } = require('./config/db');

const PORT = process.env.PORT || 5000;

// Catch uncaught exceptions during startup
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception encountered:', err);
  process.exit(1);
});

const { runAutoMigration } = require('./database/migrate');

let server;

// Start server with automatic database migration
const startServer = async () => {
  try {
    // 1. Verify and automatically apply schema and seed data if missing
    await runAutoMigration();
  } catch (error) {
    console.warn(`⚠️ [Database Migration Warning]: Auto-migration could not complete: ${error.message}`);
    console.warn(`👉 Verify that PostgreSQL service is active and credentials in .env are correct.`);
  }

  // 2. Start HTTP listener
  server = app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Ralahami Restaurant Backend Server Operational`);
    console.log(`📡 Network Protocol: RESTful JSON over HTTP`);
    console.log(`🔌 Listening Port   : http://localhost:${PORT}`);
    console.log(`🌱 Environment      : ${process.env.NODE_ENV || 'development'}`);
    console.log(`====================================================`);
  });
};

startServer();

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
