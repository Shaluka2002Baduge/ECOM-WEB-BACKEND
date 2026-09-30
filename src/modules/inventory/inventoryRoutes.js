const express = require('express');
const router = express.Router();
const inventoryController = require('./inventoryController');
const { verifyToken, requireRole } = require('../../middleware/authAspect');

// RBAC Role Guard: Inventory endpoints are strictly restricted to ADMIN and MANAGER
router.use(verifyToken);
router.use(requireRole(['ADMIN', 'MANAGER']));

router.get('/', inventoryController.getInventory);
router.post('/', inventoryController.addInventoryItem);
router.post('/deduct', inventoryController.deductStock);
router.put('/:id/restock', inventoryController.updateStock);
router.patch('/:id/stock', inventoryController.updateStock);
router.patch('/:id/restock', inventoryController.updateStock);
router.put('/:id', inventoryController.updateInventoryItem);
router.patch('/:id', inventoryController.updateInventoryItem);
router.delete('/:id', inventoryController.deleteInventoryItem);
router.post('/recipes', inventoryController.mapRecipe);

module.exports = router;
