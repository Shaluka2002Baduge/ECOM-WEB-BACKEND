const express = require('express');
const router = express.Router();
const usersController = require('./userController');
const { authenticateToken } = require('../../middleware/authAspect');

// All user routes require authentication
router.use(authenticateToken);

// User profile
router.get('/profile', usersController.getProfile);
router.put('/profile', usersController.updateProfile);

// User addresses
router.get('/addresses', usersController.getAddresses);
router.post('/addresses', usersController.addAddress);
router.delete('/addresses/:id', usersController.deleteAddress);

module.exports = router;
