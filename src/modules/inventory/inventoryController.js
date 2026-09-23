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
    const { name, unit, currentStock, minimumThreshold } = req.body;
    if (!name || !unit) {
      throw new AppError('name and unit are required fields.', 400);
    }

    const item = await inventoryService.addInventoryItem({
      name,
      unit,
      currentStock: currentStock ? parseFloat(currentStock) : 0,
      minimumThreshold: minimumThreshold ? parseFloat(minimumThreshold) : 0,
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

    const { stockDelta, absoluteStock } = req.body;
    const updated = await inventoryService.updateStockLevel(id, {
      stockDelta: stockDelta !== undefined ? parseFloat(stockDelta) : undefined,
      absoluteStock: absoluteStock !== undefined ? parseFloat(absoluteStock) : undefined,
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

module.exports = {
  getInventory,
  addInventoryItem,
  updateStock,
  mapRecipe,
};
