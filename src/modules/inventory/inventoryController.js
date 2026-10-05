const inventoryService = require('./inventoryService');
const { AppError } = require('../../middleware/errorAspect');

const getInventory = async (req, res, next) => {
  try {
    const lowStock = req.query.lowStock === 'true';
    const items = await inventoryService.getInventory(lowStock);
    res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error) {
    next(error);
  }
};

const addInventoryItem = async (req, res, next) => {
  try {
    const { name, category, supplier, unit, currentStock, stock, minimumThreshold, threshold, image, imageUrl, image_url, variants } = req.body;
    if (!name) {
      throw new AppError('Item name is required.', 400);
    }

    let finalImage = image || imageUrl || image_url || null;
    if (req.file) {
      finalImage = `/uploads/${req.file.filename}`;
    }

    let parsedVariants = variants || [];
    if (typeof variants === 'string') {
      try {
        parsedVariants = JSON.parse(variants);
      } catch (e) {
        parsedVariants = [];
      }
    }

    const item = await inventoryService.addInventoryItem({
      name,
      category: category || 'General',
      supplier: supplier || 'Local Supplier',
      unit: unit || 'kg',
      currentStock: currentStock !== undefined ? parseFloat(currentStock) : (stock !== undefined ? parseFloat(stock) : 0),
      minimumThreshold: minimumThreshold !== undefined ? parseFloat(minimumThreshold) : (threshold !== undefined ? parseFloat(threshold) : 0),
      image: finalImage,
      imageUrl: finalImage,
      image_url: finalImage,
      variants: parsedVariants
    });

    res.status(201).json({
      success: true,
      message: 'Inventory item added successfully.',
      data: item,
    });
  } catch (error) {
    next(error);
  }
};

const updateStock = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid inventory item ID.', 400);
    }

    const { stockDelta, delta, absoluteStock, stock, currentStock } = req.body;
    const updated = await inventoryService.updateStockLevel(id, {
      stockDelta: stockDelta !== undefined ? parseFloat(stockDelta) : (delta !== undefined ? parseFloat(delta) : undefined),
      absoluteStock: absoluteStock !== undefined ? parseFloat(absoluteStock) : (stock !== undefined ? parseFloat(stock) : (currentStock !== undefined ? parseFloat(currentStock) : undefined)),
    });

    res.status(200).json({
      success: true,
      message: 'Stock level updated successfully.',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

const updateInventoryItem = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid inventory item ID.', 400);
    }

    const payload = { ...req.body };
    if (req.file) {
      payload.image = `/uploads/${req.file.filename}`;
      payload.imageUrl = `/uploads/${req.file.filename}`;
      payload.image_url = `/uploads/${req.file.filename}`;
    }
    if (typeof payload.variants === 'string') {
      try {
        payload.variants = JSON.parse(payload.variants);
      } catch (e) {
        payload.variants = [];
      }
    }

    const updated = await inventoryService.updateInventoryItem(id, payload);

    res.status(200).json({
      success: true,
      message: 'Inventory item updated successfully.',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

const deleteInventoryItem = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid inventory item ID.', 400);
    }

    const deleted = await inventoryService.deleteInventoryItem(id);

    res.status(200).json({
      success: true,
      message: 'Inventory item removed successfully.',
      data: deleted,
    });
  } catch (error) {
    next(error);
  }
};

const mapRecipe = async (req, res, next) => {
  try {
    const { menuItemId, inventoryItemId, quantityRequired } = req.body;
    if (!menuItemId || !inventoryItemId || !quantityRequired) {
      throw new AppError('menuItemId, inventoryItemId, and quantityRequired are required.', 400);
    }

    const recipe = await inventoryService.mapMenuItemRecipe(
      parseInt(menuItemId, 10),
      parseInt(inventoryItemId, 10),
      parseFloat(quantityRequired)
    );

    res.status(200).json({
      success: true,
      message: 'Recipe ingredient mapped successfully.',
      data: recipe,
    });
  } catch (error) {
    next(error);
  }
};

const deductStock = async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      throw new AppError('items array is required for stock deduction.', 400);
    }

    const result = await inventoryService.deductInventoryStock(items);

    res.status(200).json({
      success: true,
      message: 'Inventory stock auto-deducted successfully.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getInventory,
  addInventoryItem,
  updateStock,
  updateInventoryItem,
  deleteInventoryItem,
  deductStock,
  mapRecipe,
};
