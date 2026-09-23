const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');

/**
 * Fetch all inventory items, with optional lowStock flag
 */
const getInventory = async (lowStockOnly = false) => {
  let queryText = `
    SELECT id, name, unit, current_stock, minimum_threshold,
           (current_stock <= minimum_threshold) AS is_low_stock,
           created_at, updated_at
    FROM inventory_items
  `;

  if (lowStockOnly) {
    queryText += ' WHERE current_stock <= minimum_threshold';
  }

  queryText += ' ORDER BY is_low_stock DESC, name ASC';

  const result = await db.query(queryText);
  return result.rows;
};

/**
 * Add a new raw ingredient / inventory item
 */
const addInventoryItem = async ({ name, unit, currentStock = 0, minimumThreshold = 0 }) => {
  const result = await db.query(
    `INSERT INTO inventory_items (name, unit, current_stock, minimum_threshold)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [name, unit, currentStock, minimumThreshold]
  );
  return result.rows[0];
};

/**
 * Update stock level of an inventory item (e.g. replenishment, stock count)
 */
const updateStockLevel = async (id, { stockDelta, absoluteStock }) => {
  let queryText;
  let params;

  if (absoluteStock !== undefined) {
    if (absoluteStock < 0) {
      throw new AppError('Stock level cannot be negative.', 400);
    }
    queryText = `
      UPDATE inventory_items
      SET current_stock = $1
      WHERE id = $2
      RETURNING *
    `;
    params = [absoluteStock, id];
  } else if (stockDelta !== undefined) {
    queryText = `
      UPDATE inventory_items
      SET current_stock = current_stock + $1
      WHERE id = $2
      RETURNING *
    `;
    params = [stockDelta, id];
  } else {
    throw new AppError('Either stockDelta or absoluteStock must be provided.', 400);
  }

  const result = await db.query(queryText, params);
  if (result.rows.length === 0) {
    throw new AppError('Inventory item not found.', 404);
  }

  return result.rows[0];
};

/**
 * Map recipe requirements for a menu item (Bill of Materials)
 */
const mapMenuItemRecipe = async (menuItemId, inventoryItemId, quantityRequired) => {
  if (quantityRequired <= 0) {
    throw new AppError('quantityRequired must be greater than zero.', 400);
  }

  const result = await db.query(
    `INSERT INTO menu_item_recipes (menu_item_id, inventory_item_id, quantity_required)
     VALUES ($1, $2, $3)
     ON CONFLICT (menu_item_id, inventory_item_id)
     DO UPDATE SET quantity_required = EXCLUDED.quantity_required
     RETURNING *`,
    [menuItemId, inventoryItemId, quantityRequired]
  );

  return result.rows[0];
};

module.exports = {
  getInventory,
  addInventoryItem,
  updateStockLevel,
  mapMenuItemRecipe,
};
