const express = require('express');
const router = express.Router();
const menuController = require('./menuController');
const { verifyToken, requireRole } = require('../../middleware/authAspect');

// Public browsing endpoints
router.get('/', menuController.getMenuItems); // Enables GET /api/menu and GET /api/menu-items
router.get('/items', menuController.getMenuItems);
router.get('/categories', menuController.getCategories);
router.get('/items/:id', menuController.getMenuItemById);
router.get('/:id', menuController.getMenuItemById);

// Protected management endpoints (Admin / Manager only)
router.post(
  '/categories',
  verifyToken,
  requireRole(['ADMIN', 'MANAGER']),
  menuController.createCategory
);

router.post(
  '/',
  verifyToken,
  requireRole(['ADMIN', 'MANAGER']),
  menuController.createMenuItem
);

router.post(
  '/items',
  verifyToken,
  requireRole(['ADMIN', 'MANAGER']),
  menuController.createMenuItem
);

router.put(
  '/items/:id',
  verifyToken,
  requireRole(['ADMIN', 'MANAGER']),
  menuController.updateMenuItem
);

router.put(
  '/:id',
  verifyToken,
  requireRole(['ADMIN', 'MANAGER']),
  menuController.updateMenuItem
);

router.delete(
  '/items/:id',
  verifyToken,
  requireRole(['ADMIN', 'MANAGER']),
  menuController.deleteMenuItem
);

router.delete(
  '/:id',
  verifyToken,
  requireRole(['ADMIN', 'MANAGER']),
  menuController.deleteMenuItem
);

module.exports = router;

