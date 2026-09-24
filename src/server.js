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

  // 2. Start HTTP listener with clean error listener
  server = app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Ralahami Restaurant Backend Server Operational`);
    console.log(`📡 Network Protocol: RESTful JSON over HTTP`);
    console.log(`🔌 Listening Port   : http://localhost:${PORT}`);
    console.log(`🌱 Environment      : ${process.env.NODE_ENV || 'development'}`);
    console.log(`====================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ [Port Collision]: Port ${PORT} is already in use by another process.`);
      console.error(`👉 Running 'npx kill-port ${PORT}' will free the port.`);
    } else {
      console.error('[Server Error]:', err);
    }
    process.exit(1);
  });
};

startServer();

// Rapid socket termination & graceful shutdown handler
const gracefulShutdown = (signal) => {
  console.log(`\n[Process] Received ${signal}. Releasing network port immediately...`);
  if (server) {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close(async () => {
      console.log('[HTTP Server]: Closed remaining active connections.');
      try {
        await pool.end();
      } catch (err) {
        // ignore on exit
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  // Force close after 1s so port 5000 is freed immediately for nodemon restarts
  setTimeout(() => {
    process.exit(0);
  }, 1000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Nodemon graceful restart signal
process.once('SIGUSR2', () => {
  if (server) {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close(() => {
      process.kill(process.pid, 'SIGUSR2');
    });
  } else {
    process.kill(process.pid, 'SIGUSR2');
  }
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

