const express = require('express');
const router = express.Router();
const inventoryController = require('./inventoryController');
const { verifyToken, requireRole } = require('../../middleware/authAspect');
const upload = require('../../middleware/uploadMiddleware');

// RBAC Role Guard: Inventory endpoints are strictly restricted to ADMIN and MANAGER
router.use(verifyToken);
router.use(requireRole(['ADMIN', 'MANAGER']));

router.get('/', inventoryController.getInventory);
router.get('/reports/daily', inventoryController.getDailyInventoryReport);
router.get('/daily-report', inventoryController.getDailyInventoryReport);
router.post('/', upload.single('image'), inventoryController.addInventoryItem);
router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No image file uploaded.' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.status(200).json({ success: true, url: fileUrl, imageUrl: fileUrl, filename: req.file.filename });
});
router.post('/deduct', inventoryController.deductStock);
router.put('/:id/restock', inventoryController.updateStock);
router.patch('/:id/stock', inventoryController.updateStock);
router.patch('/:id/restock', inventoryController.updateStock);
router.put('/:id', upload.single('image'), inventoryController.updateInventoryItem);
router.patch('/:id', upload.single('image'), inventoryController.updateInventoryItem);
router.delete('/:id', inventoryController.deleteInventoryItem);
router.post('/recipes', inventoryController.mapRecipe);

module.exports = router;

