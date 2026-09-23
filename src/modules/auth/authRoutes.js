const express = require('express');
const router = express.Router();
const authController = require('./authController');
const { authenticateToken } = require('../../middleware/authAspect');

// Public authentication routes
router.post('/register', authController.register);
router.post('/login', authController.login);

// Protected token inspection route
router.get('/me', authenticateToken, authController.getMe);

module.exports = router;
