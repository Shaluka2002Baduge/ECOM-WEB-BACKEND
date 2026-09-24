const express = require('express');
const router = express.Router();
const inventoryController = require('./inventoryController');
const { verifyToken, requireRole } = require('../../middleware/authAspect');

// RBAC Role Guard: Inventory endpoints are strictly restricted to ADMIN and MANAGER
router.use(verifyToken);
router.use(requireRole(['ADMIN', 'MANAGER']));

router.get('/', inventoryController.getInventory);
router.post('/', inventoryController.addInventoryItem);
router.patch('/:id/stock', inventoryController.updateStock);
router.post('/recipes', inventoryController.mapRecipe);

module.exports = router;

