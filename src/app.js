const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// Cross-cutting Aspects (AOP)
const loggingAspect = require('./middleware/loggingAspect');
const { errorAspect, AppError } = require('./middleware/errorAspect');

// Modular Route Handlers
const authRoutes = require('./modules/auth/authRoutes');
const userRoutes = require('./modules/users/userRoutes');
const staffRoutes = require('./modules/staff/staffRoutes');
const menuRoutes = require('./modules/menu/menuRoutes');
const inventoryRoutes = require('./modules/inventory/inventoryRoutes');
const orderRoutes = require('./modules/orders/orderRoutes');
const reservationRoutes = require('./modules/reservations/reservationRoutes');
const paymentRoutes = require('./modules/payments/paymentRoutes');
const reviewRoutes = require('./modules/reviews/reviewRoutes');

const app = express();

// ====================================================================
// 1. GLOBAL INFRASTRUCTURE MIDDLEWARE & AOP ASPECTS
// ====================================================================
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// AOP Logging Aspect: Intercepts all incoming HTTP calls
app.use(loggingAspect);

// ====================================================================
// 2. HEALTH & SYSTEM METRICS
// ====================================================================
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    system: 'Ralahami Restaurant Enterprise Backend',
    version: '1.0.0',
    status: 'HEALTHY',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to Ralahami Restaurant API Gateway',
    documentation: '/api/docs',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      staff: '/api/staff',
      menu: '/api/menu',
      inventory: '/api/inventory',
      orders: '/api/orders',
      reservations: '/api/reservations',
      payments: '/api/payments',
      reviews: '/api/reviews',
    },
  });
});

// ====================================================================
// 3. MODULAR DOMAIN ROUTE MOUNTING (High Cohesion, Low Coupling)
// ====================================================================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reviews', reviewRoutes);

// ====================================================================
// 4. UNMATCHED ROUTE (404) HANDLER
// ====================================================================
app.all('*', (req, res, next) => {
  next(new AppError(`Cannot find endpoint ${req.method} ${req.originalUrl} on this server.`, 404));
});

// ====================================================================
// 5. GLOBAL ERROR HANDLING ASPECT (AOP)
// ====================================================================
app.use(errorAspect);

module.exports = app;
