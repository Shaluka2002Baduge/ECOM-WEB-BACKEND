const express = require('express');
const router = express.Router();
const authController = require('./authController');
const { verifyToken } = require('../../middleware/authAspect');

// Public authentication routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', authController.logout);

// Protected token inspection route (inspect virtual identity)
router.get('/me', verifyToken, authController.getMe);

module.exports = router;

