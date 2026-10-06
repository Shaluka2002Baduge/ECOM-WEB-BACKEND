const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');
const InventoryModel = require('./inventoryModel');

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
 * Fetch all inventory items from backend
 */
const getInventory = async (lowStockOnly = false) => {
  return InventoryModel.findAll({ lowStockOnly });
};

/**
 * Add a new raw ingredient or beverage item with nested variants
 */
const addInventoryItem = async (data) => {
  return InventoryModel.create(data);
};

/**
 * Update stock level of an inventory item
 */
const updateStockLevel = async (id, data, client = null) => {
  return InventoryModel.adjustStock(id, data, client);
};

/**
 * Update general fields of an inventory item (Name, Category, Supplier, Unit, Threshold, Stock, Image, Variants)
 */
const updateInventoryItem = async (id, data) => {
  return InventoryModel.update(id, data);
};

/**
 * Delete an inventory item
 */
const deleteInventoryItem = async (id) => {
  return InventoryModel.delete(id);
};

/**
 * Deduct inventory stock for ordered items based on:
 * 1. Nested variant size match inside parent inventory item (e.g., Natural Mountain Spring Water Bottle -> size '1L')
 * 2. Linked recipe bill-of-materials in `menu_item_recipes`
 * 3. Direct matching for standalone inventory items
 */
const deductInventoryStock = async (orderItems, externalClient = null) => {
  if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
    return { success: true, deductedCount: 0, items: [] };
  }

  const queryRunner = externalClient || db;
  const deductions = [];

  for (const item of orderItems) {
    const invId = item.inventoryItemId || item.inventory_item_id || (item.is_inventory_item ? item.id : null);
    const menuId = item.menuItemId || item.menu_item_id || (!item.is_inventory_item ? item.id : null);
    const quantity = parseInt(item.quantity || item.qty || 1, 10) || 1;
    const itemName = String(item.name || item.title || '').trim();
    let selectedSize = String(item.selectedSize || item.size || item.variant || '').trim();

    if (!selectedSize && itemName) {
      const match = itemName.match(/\(([^)]+)\)/);
      if (match) {
        selectedSize = match[1].trim();
      }
    }

    let deducted = false;

    // 1. Nested Variant Deduction inside Parent Inventory Document
    if (selectedSize) {
      if (invId && !isNaN(parseInt(invId, 10)) && parseInt(invId, 10) > 0) {
        const idRes = await InventoryModel.deductNestedVariantStock(
          parseInt(invId, 10),
          selectedSize,
          quantity,
          queryRunner
        );
        if (idRes && idRes.success) {
          deductions.push({
            inventoryItemId: idRes.parentId,
            itemName: `${idRes.parentName} (${selectedSize})`,
            deductedQty: quantity,
            variantSize: selectedSize,
            newTotalStock: idRes.newTotalStock,
            source: 'Nested Variant Sub-Document Stock Match by ID'
          });
          console.log(`📦 [NESTED VARIANT AUTO-DEDUCT]: Decremented ${quantity} units from variant "${selectedSize}" in parent "${idRes.parentName}" (ID #${idRes.parentId}). Remaining parent stock: ${idRes.newTotalStock}`);
          deducted = true;
        }
      }

      if (!deducted) {
        const baseCleanName = itemName.replace(/\s*\([^)]*\)/g, '').trim();
        const parentCandidates = [
          baseCleanName,
          itemName,
          itemName.replace(/bottle|bottles/gi, '').trim(),
          baseCleanName.replace(/bottle|bottles/gi, '').trim()
        ];

        for (const parentCandidate of parentCandidates) {
          if (!parentCandidate) continue;
          const res = await InventoryModel.deductNestedVariantStock(
            parentCandidate,
            selectedSize,
            quantity,
            queryRunner
          );

          if (res && res.success) {
            deductions.push({
              inventoryItemId: res.parentId,
              itemName: `${res.parentName} (${selectedSize})`,
              deductedQty: quantity,
              variantSize: selectedSize,
              newTotalStock: res.newTotalStock,
              source: 'Nested Variant Sub-Document Stock Match'
            });
            console.log(`📦 [NESTED VARIANT AUTO-DEDUCT]: Decremented ${quantity} units from variant "${selectedSize}" in parent "${res.parentName}" (ID #${res.parentId}). Remaining parent stock: ${res.newTotalStock}`);
            deducted = true;
            break;
          }
        }
      }
    }

    // 2. Recipe Bill of Materials deduction for prepared culinary dishes
    const resolvedMenuId = menuId && !isNaN(parseInt(menuId, 10)) ? parseInt(menuId, 10) : null;
    if (!deducted && resolvedMenuId) {
      const recipeRes = await queryRunner.query(
        `SELECT inventory_item_id, quantity_required 
         FROM menu_item_recipes 
         WHERE menu_item_id = $1`,
        [resolvedMenuId]
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
            source: `Recipe for Menu Item #${resolvedMenuId}`
          });
        }
        deducted = true;
      }
    }

    // 3. Direct ID matching for standalone inventory items without variants
    if (!deducted && invId && !isNaN(parseInt(invId, 10)) && parseInt(invId, 10) > 0) {
      await queryRunner.query(
        `UPDATE inventory_items 
         SET current_stock = GREATEST(0, current_stock - $1) 
         WHERE id = $2`,
        [quantity, parseInt(invId, 10)]
      );
      deductions.push({
        inventoryItemId: parseInt(invId, 10),
        itemName: itemName || `Inventory Item #${invId}`,
        deductedQty: quantity,
        source: 'Direct Inventory Item ID Match'
      });
      console.log(`📦 [INVENTORY AUTO-DEDUCT]: Decremented ${quantity} units from direct inventory item ID #${invId}.`);
      deducted = true;
    }

    // 4. Direct name matching fallback
    if (!deducted && itemName) {
      const cleanName = itemName.replace(/\s*\([^)]*\)/g, '').trim();
      const directMatchRes = await queryRunner.query(
        `SELECT id, name, category, current_stock 
         FROM inventory_items 
         WHERE LOWER(name) = LOWER($1) 
            OR LOWER(name) = LOWER($2)
            OR (category IN ('Beverages & Water Bottles', 'Coconuts & Produce', 'Packaging & Containers') AND LOWER(name) LIKE LOWER($3))`,
        [itemName, cleanName, `%${cleanName}%`]
      );

      if (directMatchRes.rows && directMatchRes.rows.length > 0) {
        const invRow = directMatchRes.rows[0];
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
          source: 'Direct Parent Item Match'
        });
        console.log(`📦 [INVENTORY AUTO-DEDUCT]: Decremented ${quantity} units from direct match "${invRow.name}" (ID #${invRow.id}).`);
      }
    }
  }

  return { success: true, deductedCount: deductions.length, deductions };
};

/**
 * Reverse inventory stock deductions when an order is cancelled
 */
const restockInventoryStock = async (orderItems, externalClient = null) => {
  if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
    return { success: true, restockedCount: 0, items: [] };
  }

  const queryRunner = externalClient || db;
  const restocks = [];

  for (const item of orderItems) {
    const invId = item.inventoryItemId || item.inventory_item_id || (item.is_inventory_item ? item.id : null);
    const menuId = item.menuItemId || item.menu_item_id || (!item.is_inventory_item ? item.id : null);
    const quantity = parseInt(item.quantity || item.qty || 1, 10) || 1;
    const itemName = String(item.name || item.title || item.item_name || '').trim();
    let selectedSize = String(item.selectedSize || item.size || item.variant || item.special_instructions || '').trim();

    if (!selectedSize && itemName) {
      const match = itemName.match(/\(([^)]+)\)/);
      if (match) {
        selectedSize = match[1].trim();
      }
    }

    let restocked = false;

    // 1. Nested Variant Restock inside Parent Inventory Document
    if (selectedSize) {
      if (invId && !isNaN(parseInt(invId, 10)) && parseInt(invId, 10) > 0) {
        const idRes = await InventoryModel.restockNestedVariantStock(
          parseInt(invId, 10),
          selectedSize,
          quantity,
          queryRunner
        );
        if (idRes && idRes.success) {
          restocks.push({
            inventoryItemId: idRes.parentId,
            itemName: `${idRes.parentName} (${selectedSize})`,
            restockedQty: quantity,
            variantSize: selectedSize,
            newTotalStock: idRes.newTotalStock,
            source: 'Nested Variant Sub-Document Restock Match by ID'
          });
          console.log(`📦 [NESTED VARIANT AUTO-RESTOCK]: Restored ${quantity} units to variant "${selectedSize}" in parent "${idRes.parentName}" (ID #${idRes.parentId}). New parent stock: ${idRes.newTotalStock}`);
          restocked = true;
        }
      }

      if (!restocked) {
        const baseCleanName = itemName.replace(/\s*\([^)]*\)/g, '').trim();
        const parentCandidates = [
          baseCleanName,
          itemName,
          itemName.replace(/bottle|bottles/gi, '').trim(),
          baseCleanName.replace(/bottle|bottles/gi, '').trim()
        ];

        for (const parentCandidate of parentCandidates) {
          if (!parentCandidate) continue;
          const res = await InventoryModel.restockNestedVariantStock(
            parentCandidate,
            selectedSize,
            quantity,
            queryRunner
          );

          if (res && res.success) {
            restocks.push({
              inventoryItemId: res.parentId,
              itemName: `${res.parentName} (${selectedSize})`,
              restockedQty: quantity,
              variantSize: selectedSize,
              newTotalStock: res.newTotalStock,
              source: 'Nested Variant Sub-Document Restock Match'
            });
            console.log(`📦 [NESTED VARIANT AUTO-RESTOCK]: Restored ${quantity} units to variant "${selectedSize}" in parent "${res.parentName}" (ID #${res.parentId}). New parent stock: ${res.newTotalStock}`);
            restocked = true;
            break;
          }
        }
      }
    }

    // 2. Recipe Bill of Materials restock for prepared culinary dishes
    const resolvedMenuId = menuId && !isNaN(parseInt(menuId, 10)) ? parseInt(menuId, 10) : null;
    if (!restocked && resolvedMenuId) {
      const recipeRes = await queryRunner.query(
        `SELECT inventory_item_id, quantity_required 
         FROM menu_item_recipes 
         WHERE menu_item_id = $1`,
        [resolvedMenuId]
      );

      if (recipeRes.rows && recipeRes.rows.length > 0) {
        for (const recipe of recipeRes.rows) {
          const restockQty = parseFloat(recipe.quantity_required) * quantity;
          await queryRunner.query(
            `UPDATE inventory_items 
             SET current_stock = current_stock + $1 
             WHERE id = $2`,
            [restockQty, recipe.inventory_item_id]
          );
          restocks.push({
            inventoryItemId: recipe.inventory_item_id,
            restockedQty: restockQty,
            source: `Recipe Restock for Menu Item #${resolvedMenuId}`
          });
        }
        restocked = true;
      }
    }

    // 3. Direct ID matching for standalone inventory items without variants
    if (!restocked && invId && !isNaN(parseInt(invId, 10)) && parseInt(invId, 10) > 0) {
      await queryRunner.query(
        `UPDATE inventory_items 
         SET current_stock = current_stock + $1 
         WHERE id = $2`,
        [quantity, parseInt(invId, 10)]
      );
      restocks.push({
        inventoryItemId: parseInt(invId, 10),
        itemName: itemName || `Inventory Item #${invId}`,
        restockedQty: quantity,
        source: 'Direct Inventory Item ID Match Restock'
      });
      console.log(`📦 [INVENTORY AUTO-RESTOCK]: Restored ${quantity} units to direct inventory item ID #${invId}.`);
      restocked = true;
    }

    // 4. Direct name matching fallback
    if (!restocked && itemName) {
      const cleanName = itemName.replace(/\s*\([^)]*\)/g, '').trim();
      const directMatchRes = await queryRunner.query(
        `SELECT id, name, category, current_stock 
         FROM inventory_items 
         WHERE LOWER(name) = LOWER($1) 
            OR LOWER(name) = LOWER($2)
            OR (category IN ('Beverages & Water Bottles', 'Coconuts & Produce', 'Packaging & Containers') AND LOWER(name) LIKE LOWER($3))`,
        [itemName, cleanName, `%${cleanName}%`]
      );

      if (directMatchRes.rows && directMatchRes.rows.length > 0) {
        const invRow = directMatchRes.rows[0];
        await queryRunner.query(
          `UPDATE inventory_items 
           SET current_stock = current_stock + $1 
           WHERE id = $2`,
          [quantity, invRow.id]
        );
        restocks.push({
          inventoryItemId: invRow.id,
          itemName: invRow.name,
          restockedQty: quantity,
          source: 'Direct Parent Item Match Restock'
        });
        console.log(`📦 [INVENTORY AUTO-RESTOCK]: Restored ${quantity} units to direct match "${invRow.name}" (ID #${invRow.id}).`);
      }
    }
  }

  return { success: true, restockedCount: restocks.length, restocks };
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

/**
 * Generate Comprehensive Daily Inventory & Stock Movement Report
 * @param {string} date - 'YYYY-MM-DD'
 */
const getDailyInventoryReport = async (date) => {
  const resolvedDate = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) 
    ? date.trim() 
    : new Date().toISOString().split('T')[0];

  const inventoryItems = await InventoryModel.findAll({});

  // 1. Calculate stock consumption from direct inventory and recipe bill-of-materials on the chosen date
  const consumptionQuery = `
    SELECT 
      COALESCE(inv.name, 'Ingredient') AS name,
      COALESCE(inv.unit, 'units') AS unit,
      COALESCE(inv.category, 'General') AS category,
      SUM(
        CASE 
          WHEN oi.inventory_item_id IS NOT NULL THEN oi.quantity
          WHEN mir.quantity_required IS NOT NULL THEN (oi.quantity * mir.quantity_required)
          ELSE 0
        END
      )::numeric AS consumed_quantity
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN menu_item_recipes mir ON mir.menu_item_id = oi.menu_item_id
    LEFT JOIN inventory_items inv ON (inv.id = oi.inventory_item_id OR inv.id = mir.inventory_item_id)
    WHERE o.status != 'CANCELLED'
      AND o.created_at >= '${resolvedDate} 00:00:00' 
      AND o.created_at <= '${resolvedDate} 23:59:59'
      AND inv.id IS NOT NULL
    GROUP BY inv.name, inv.unit, inv.category
    ORDER BY consumed_quantity DESC;
  `;

  const consumptionRes = await db.query(consumptionQuery);
  const consumedItems = consumptionRes.rows.map(row => ({
    name: row.name,
    unit: row.unit,
    category: row.category,
    consumedQuantity: parseFloat(row.consumed_quantity) || 0,
    formattedQuantity: `${parseFloat(row.consumed_quantity).toFixed(2)} ${row.unit}`
  }));

  const totalItems = inventoryItems.length;
  let healthyCount = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let totalStockUnits = 0;

  const enrichedItems = inventoryItems.map(item => {
    const stock = parseFloat(item.currentStock ?? item.stock ?? item.current_stock ?? 0);
    const threshold = parseFloat(item.minimumThreshold ?? item.threshold ?? item.minimum_threshold ?? 0);
    totalStockUnits += stock;

    let status = 'HEALTHY';
    if (stock <= 0) {
      status = 'OUT_OF_STOCK';
      outOfStockCount++;
    } else if (stock <= threshold) {
      status = 'LOW_STOCK';
      lowStockCount++;
    } else {
      healthyCount++;
    }

    return {
      id: item.id,
      name: item.name,
      category: item.category || 'General',
      supplier: item.supplier || 'Local Supplier',
      unit: item.unit || 'units',
      currentStock: stock,
      stock: stock,
      minimumThreshold: threshold,
      threshold: threshold,
      status,
      variants: item.variants || []
    };
  });

  const totalConsumedUnits = consumedItems.reduce((sum, i) => sum + i.consumedQuantity, 0);

  return {
    success: true,
    reportType: 'DAILY_INVENTORY_STOCK_REPORT',
    date: resolvedDate,
    formattedDate: new Date(resolvedDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    generatedAt: new Date().toISOString(),
    summary: {
      totalItems,
      healthyCount,
      lowStockCount,
      outOfStockCount,
      stockHealthPercent: totalItems > 0 ? `${((healthyCount / totalItems) * 100).toFixed(1)}%` : '100%',
      totalStockUnits: Math.round(totalStockUnits),
      totalConsumedUnits: parseFloat(totalConsumedUnits.toFixed(2)),
      totalConsumedUnitsFormatted: `${totalConsumedUnits.toFixed(2)} units`
    },
    inventory: enrichedItems,
    consumedItems
  };
};

module.exports = {
  INVENTORY_CATEGORIES,
  getInventory,
  addInventoryItem,
  updateStockLevel,
  updateInventoryItem,
  deleteInventoryItem,
  deductInventoryStock,
  restockInventoryStock,
  mapMenuItemRecipe,
  getDailyInventoryReport,
};
