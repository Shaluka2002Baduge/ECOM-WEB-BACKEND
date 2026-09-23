const express = require('express');
const router = express.Router();
const menuController = require('./menuController');
const { authenticateToken, authorizeRoles } = require('../../middleware/authAspect');

// Public browsing endpoints
router.get('/categories', menuController.getCategories);
router.get('/items', menuController.getMenuItems);
router.get('/items/:id', menuController.getMenuItemById);

// Protected management endpoints (Admin / Manager only)
router.post(
  '/categories',
  authenticateToken,
  authorizeRoles('ADMIN', 'MANAGER'),
  menuController.createCategory
);

router.post(
  '/items',
  authenticateToken,
  authorizeRoles('ADMIN', 'MANAGER'),
  menuController.createMenuItem
);

router.put(
  '/items/:id',
  authenticateToken,
  authorizeRoles('ADMIN', 'MANAGER'),
  menuController.updateMenuItem
);

router.delete(
  '/items/:id',
  authenticateToken,
  authorizeRoles('ADMIN', 'MANAGER'),
  menuController.deleteMenuItem
);

module.exports = router;
