const express = require('express');
const router = express.Router();
const inventoryController = require('./inventoryController');
const { authenticateToken, authorizeRoles } = require('../../middleware/authAspect');

// Inventory endpoints are restricted to Staff (Kitchen Staff, Manager, Admin)
router.use(authenticateToken);
router.use(authorizeRoles('ADMIN', 'MANAGER', 'KITCHEN_STAFF'));

router.get('/', inventoryController.getInventory);
router.post('/', inventoryController.addInventoryItem);
router.patch('/:id/stock', inventoryController.updateStock);
router.post('/recipes', inventoryController.mapRecipe);

module.exports = router;
