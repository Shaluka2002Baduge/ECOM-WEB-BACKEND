const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');

/**
 * Standard Inventory Category List
 */
const INVENTORY_CATEGORIES = [
  'Grains & Rice',
  'Seafood',
  'Meat & Poultry',
  'Coconuts & Produce',
  'Beverages & Water Bottles',
  'Packaging & Containers',
  'Spices & Seasoning',
  'Sweeteners & Treacle',
  'Dairy & Oils',
  'Nuts & Seeds',
  'General'
];

/**
 * Fetch all inventory items, with optional lowStock flag
 */
const getInventory = async (lowStockOnly = false) => {
  let queryText = `
    SELECT id, name, 
           COALESCE(category, 'General') AS category,
           COALESCE(supplier, 'Local Supplier') AS supplier,
           unit, current_stock, minimum_threshold,
           (current_stock <= minimum_threshold) AS is_low_stock,
           created_at, updated_at
    FROM inventory_items
  `;

  if (lowStockOnly) {
    queryText += ' WHERE current_stock <= minimum_threshold';
  }

  queryText += ' ORDER BY is_low_stock DESC, name ASC';

  const result = await db.query(queryText);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    supplier: row.supplier,
    unit: row.unit,
    stock: parseFloat(row.current_stock) || 0,
    current_stock: parseFloat(row.current_stock) || 0,
    currentStock: parseFloat(row.current_stock) || 0,
    threshold: parseFloat(row.minimum_threshold) || 0,
    minimum_threshold: parseFloat(row.minimum_threshold) || 0,
    minimumThreshold: parseFloat(row.minimum_threshold) || 0,
    isLowStock: row.is_low_stock,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
};

/**
 * Add a new raw ingredient / inventory item
 */
const addInventoryItem = async ({
  name,
  category = 'General',
  supplier = 'Local Supplier',
  unit = 'kg',
  currentStock = 0,
  stock = 0,
  minimumThreshold = 0,
  threshold = 0
}) => {
  const finalStock = currentStock !== undefined && currentStock !== 0 ? currentStock : stock || 0;
  const finalThreshold = minimumThreshold !== undefined && minimumThreshold !== 0 ? minimumThreshold : threshold || 0;

  const result = await db.query(
    `INSERT INTO inventory_items (name, category, supplier, unit, current_stock, minimum_threshold)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, category, supplier, unit, parseFloat(finalStock), parseFloat(finalThreshold)]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    category: row.category || category,
    supplier: row.supplier || supplier,
    unit: row.unit,
    stock: parseFloat(row.current_stock) || 0,
    current_stock: parseFloat(row.current_stock) || 0,
    currentStock: parseFloat(row.current_stock) || 0,
    threshold: parseFloat(row.minimum_threshold) || 0,
    minimum_threshold: parseFloat(row.minimum_threshold) || 0,
    minimumThreshold: parseFloat(row.minimum_threshold) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

/**
 * Update stock level of an inventory item (e.g. replenishment, stock count, quick restock)
 */
const updateStockLevel = async (id, { stockDelta, delta, absoluteStock, stock, currentStock, current_stock }) => {
  let finalAbsolute = absoluteStock !== undefined ? absoluteStock : (stock !== undefined ? stock : (currentStock !== undefined ? currentStock : current_stock));
  let finalDelta = stockDelta !== undefined ? stockDelta : delta;

  let queryText;
  let params;

  if (finalAbsolute !== undefined) {
    if (finalAbsolute < 0) {
      throw new AppError('Stock level cannot be negative.', 400);
    }
    queryText = `
      UPDATE inventory_items
      SET current_stock = $1
      WHERE id = $2
      RETURNING *
    `;
    params = [parseFloat(finalAbsolute), id];
  } else if (finalDelta !== undefined) {
    queryText = `
      UPDATE inventory_items
      SET current_stock = GREATEST(0, current_stock + $1)
      WHERE id = $2
      RETURNING *
    `;
    params = [parseFloat(finalDelta), id];
  } else {
    throw new AppError('Either stockDelta or absoluteStock must be provided.', 400);
  }

  const result = await db.query(queryText, params);
  if (result.rows.length === 0) {
    throw new AppError('Inventory item not found.', 404);
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    supplier: row.supplier,
    unit: row.unit,
    stock: parseFloat(row.current_stock) || 0,
    current_stock: parseFloat(row.current_stock) || 0,
    currentStock: parseFloat(row.current_stock) || 0,
    threshold: parseFloat(row.minimum_threshold) || 0,
    minimum_threshold: parseFloat(row.minimum_threshold) || 0,
    minimumThreshold: parseFloat(row.minimum_threshold) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

/**
 * Update general fields of an inventory item (Name, Category, Supplier, Unit, Threshold, Stock)
 */
const updateInventoryItem = async (id, data) => {
  const { name, category, supplier, unit, stock, currentStock, current_stock, threshold, minimumThreshold, minimum_threshold } = data;
  const targetStock = stock !== undefined ? stock : (currentStock !== undefined ? currentStock : current_stock);
  const targetThreshold = threshold !== undefined ? threshold : (minimumThreshold !== undefined ? minimumThreshold : minimum_threshold);

  const fields = [];
  const params = [];
  let index = 1;

  if (name !== undefined) {
    fields.push(`name = $${index++}`);
    params.push(name);
  }
  if (category !== undefined) {
    fields.push(`category = $${index++}`);
    params.push(category);
  }
  if (supplier !== undefined) {
    fields.push(`supplier = $${index++}`);
    params.push(supplier);
  }
  if (unit !== undefined) {
    fields.push(`unit = $${index++}`);
    params.push(unit);
  }
  if (targetStock !== undefined) {
    fields.push(`current_stock = $${index++}`);
    params.push(Math.max(0, parseFloat(targetStock)));
  }
  if (targetThreshold !== undefined) {
    fields.push(`minimum_threshold = $${index++}`);
    params.push(Math.max(0, parseFloat(targetThreshold)));
  }

  if (fields.length === 0) {
    throw new AppError('No fields provided to update.', 400);
  }

  params.push(id);
  const queryText = `
    UPDATE inventory_items
    SET ${fields.join(', ')}
    WHERE id = $${index}
    RETURNING *
  `;

  const result = await db.query(queryText, params);
  if (result.rows.length === 0) {
    throw new AppError('Inventory item not found.', 404);
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    supplier: row.supplier,
    unit: row.unit,
    stock: parseFloat(row.current_stock) || 0,
    current_stock: parseFloat(row.current_stock) || 0,
    currentStock: parseFloat(row.current_stock) || 0,
    threshold: parseFloat(row.minimum_threshold) || 0,
    minimum_threshold: parseFloat(row.minimum_threshold) || 0,
    minimumThreshold: parseFloat(row.minimum_threshold) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

/**
 * Delete an inventory item
 */
const deleteInventoryItem = async (id) => {
  try {
    await db.query('DELETE FROM menu_item_recipes WHERE inventory_item_id = $1', [id]);
  } catch (ignore) {}

  const result = await db.query('DELETE FROM inventory_items WHERE id = $1 RETURNING *', [id]);
  if (result.rows.length === 0) {
    throw new AppError('Inventory item not found.', 404);
  }
  return result.rows[0];
};

/**
 * Deduct inventory stock for ordered items based on:
 * 1. Linked recipe bill-of-materials in `menu_item_recipes`
 * 2. Direct matching for beverages, water bottles, produce, and packaging
 */
const deductInventoryStock = async (orderItems, externalClient = null) => {
  if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
    return { success: true, deductedCount: 0, items: [] };
  }

  const queryRunner = externalClient || db;
  const deductions = [];

  for (const item of orderItems) {
    const rawId = item.id || item.menu_item_id || item.menuItemId || item.itemId;
    const menuItemId = parseInt(rawId, 10);
    const quantity = parseInt(item.quantity || item.qty || 1, 10) || 1;
    const itemName = item.name || item.title || '';

    // 1. Recipe Bill of Materials deduction
    if (!isNaN(menuItemId)) {
      const recipeRes = await queryRunner.query(
        `SELECT inventory_item_id, quantity_required 
         FROM menu_item_recipes 
         WHERE menu_item_id = $1`,
        [menuItemId]
      );

      if (recipeRes.rows && recipeRes.rows.length > 0) {
        for (const recipe of recipeRes.rows) {
          const deductQty = parseFloat(recipe.quantity_required) * quantity;
          await queryRunner.query(
            `UPDATE inventory_items 
             SET current_stock = GREATEST(0, current_stock - $1) 
             WHERE id = $2`,
            [deductQty, recipe.inventory_item_id]
          );
          deductions.push({
            inventoryItemId: recipe.inventory_item_id,
            deductedQty: deductQty,
            source: `Recipe for Menu Item #${menuItemId}`
          });
        }
      }
    }

    // 2. Direct matching for standalone inventory items (e.g. Water Bottles, Fresh King Coconut, Craft Beers, Packaging)
    if (itemName) {
      const directMatchRes = await queryRunner.query(
        `SELECT id, name, category, current_stock 
         FROM inventory_items 
         WHERE LOWER(name) = LOWER($1) 
            OR (category IN ('Beverages & Water Bottles', 'Coconuts & Produce', 'Packaging & Containers') AND LOWER(name) LIKE LOWER($2))`,
        [itemName.trim(), `%${itemName.trim()}%`]
      );

      if (directMatchRes.rows && directMatchRes.rows.length > 0) {
        for (const invRow of directMatchRes.rows) {
          await queryRunner.query(
            `UPDATE inventory_items 
             SET current_stock = GREATEST(0, current_stock - $1) 
             WHERE id = $2`,
            [quantity, invRow.id]
          );
          deductions.push({
            inventoryItemId: invRow.id,
            itemName: invRow.name,
            deductedQty: quantity,
            source: 'Direct Item Match'
          });
        }
      }
    }
  }

  return { success: true, deductedCount: deductions.length, deductions };
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
  INVENTORY_CATEGORIES,
  getInventory,
  addInventoryItem,
  updateStockLevel,
  updateInventoryItem,
  deleteInventoryItem,
  deductInventoryStock,
  mapMenuItemRecipe,
};
