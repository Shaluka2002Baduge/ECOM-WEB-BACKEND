const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');

/**
 * Enterprise Inventory Model
 * Manages raw stock, ingredients, packaged beverages, and nested variant structures (e.g. 500ml, 1L, 1.5L, 2L)
 * Aligned with CIS007-3 / CIS045-3 specifications.
 */
class InventoryModel {
  /**
   * Helper to parse variants safely
   */
  static parseVariants(rawVariants) {
    if (!rawVariants) return [];
    if (Array.isArray(rawVariants)) return rawVariants;
    if (typeof rawVariants === 'string') {
      try {
        const parsed = JSON.parse(rawVariants);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  /**
   * Find all inventory items with optional low stock filter
   */
  static async findAll({ lowStockOnly = false, category = null, search = null } = {}) {
    let queryText = `
      SELECT id, name, 
             COALESCE(category, 'General') AS category,
             COALESCE(supplier, 'Local Supplier') AS supplier,
             unit, current_stock, minimum_threshold,
             COALESCE(image_url, '') AS image_url,
             COALESCE(variants, '[]'::jsonb) AS variants,
             (current_stock <= minimum_threshold) AS is_low_stock,
             created_at, updated_at
      FROM inventory_items
      WHERE 1=1
    `;
    const params = [];

    if (lowStockOnly) {
      queryText += ' AND current_stock <= minimum_threshold';
    }

    if (category && category !== 'All') {
      params.push(category);
      queryText += ` AND category = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      queryText += ` AND (name ILIKE $${params.length} OR supplier ILIKE $${params.length})`;
    }

    queryText += ' ORDER BY is_low_stock DESC, name ASC';

    const result = await db.query(queryText, params);
    return result.rows.map((row) => {
      const parsedVariants = InventoryModel.parseVariants(row.variants);
      return {
        id: row.id,
        name: row.name,
        category: row.category,
        supplier: row.supplier,
        unit: row.unit,
        image: row.image_url,
        imageUrl: row.image_url,
        image_url: row.image_url,
        variants: parsedVariants,
        stock: parseFloat(row.current_stock) || 0,
        current_stock: parseFloat(row.current_stock) || 0,
        currentStock: parseFloat(row.current_stock) || 0,
        threshold: parseFloat(row.minimum_threshold) || 0,
        minimum_threshold: parseFloat(row.minimum_threshold) || 0,
        minimumThreshold: parseFloat(row.minimum_threshold) || 0,
        isLowStock: row.is_low_stock,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });
  }

  /**
   * Find single inventory item by ID
   */
  static async findById(id) {
    const result = await db.query(
      `SELECT id, name, category, supplier, unit, current_stock, minimum_threshold,
              COALESCE(image_url, '') AS image_url,
              COALESCE(variants, '[]'::jsonb) AS variants,
              created_at, updated_at
       FROM inventory_items
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const parsedVariants = InventoryModel.parseVariants(row.variants);
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      supplier: row.supplier,
      unit: row.unit,
      image: row.image_url,
      imageUrl: row.image_url,
      image_url: row.image_url,
      variants: parsedVariants,
      stock: parseFloat(row.current_stock) || 0,
      current_stock: parseFloat(row.current_stock) || 0,
      currentStock: parseFloat(row.current_stock) || 0,
      threshold: parseFloat(row.minimum_threshold) || 0,
      minimum_threshold: parseFloat(row.minimum_threshold) || 0,
      minimumThreshold: parseFloat(row.minimum_threshold) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Create a new inventory record with nested variants support
   */
  static async create({
    name,
    category = 'General',
    supplier = 'Local Supplier',
    unit = 'kg',
    currentStock = 0,
    stock = 0,
    minimumThreshold = 0,
    threshold = 0,
    image = null,
    imageUrl = null,
    image_url = null,
    variants = []
  }) {
    const parsedVariants = InventoryModel.parseVariants(variants);

    // If variants are provided, calculate total stock as sum of variant stocks
    let calculatedStock = currentStock !== undefined && currentStock !== 0 ? currentStock : stock || 0;
    if (parsedVariants.length > 0) {
      const variantTotal = parsedVariants.reduce((sum, v) => sum + (parseFloat(v.stock) || 0), 0);
      if (variantTotal > 0 || calculatedStock === 0) {
        calculatedStock = variantTotal;
      }
    }

    const finalThreshold = minimumThreshold !== undefined && minimumThreshold !== 0 ? minimumThreshold : threshold || 0;
    const finalImage = image || imageUrl || image_url || null;

    const result = await db.query(
      `INSERT INTO inventory_items (name, category, supplier, unit, current_stock, minimum_threshold, image_url, variants)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        name,
        category,
        supplier,
        unit,
        parseFloat(calculatedStock),
        parseFloat(finalThreshold),
        finalImage,
        JSON.stringify(parsedVariants)
      ]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      supplier: row.supplier,
      unit: row.unit,
      image: row.image_url,
      imageUrl: row.image_url,
      image_url: row.image_url,
      variants: parsedVariants,
      stock: parseFloat(row.current_stock) || 0,
      current_stock: parseFloat(row.current_stock) || 0,
      currentStock: parseFloat(row.current_stock) || 0,
      threshold: parseFloat(row.minimum_threshold) || 0,
      minimum_threshold: parseFloat(row.minimum_threshold) || 0,
      minimumThreshold: parseFloat(row.minimum_threshold) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Update an existing inventory item (including nested variants)
   */
  static async update(id, data) {
    const {
      name,
      category,
      supplier,
      unit,
      stock,
      currentStock,
      current_stock,
      threshold,
      minimumThreshold,
      minimum_threshold,
      image,
      imageUrl,
      image_url,
      variants
    } = data;

    let targetStock = stock !== undefined ? stock : (currentStock !== undefined ? currentStock : current_stock);
    const targetThreshold = threshold !== undefined ? threshold : (minimumThreshold !== undefined ? minimumThreshold : minimum_threshold);
    const targetImage = image !== undefined ? image : (imageUrl !== undefined ? imageUrl : image_url);

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

    if (variants !== undefined) {
      const parsedVariants = InventoryModel.parseVariants(variants);
      fields.push(`variants = $${index++}`);
      params.push(JSON.stringify(parsedVariants));

      // Auto-update total stock if variants provided and targetStock wasn't explicitly forced
      if (parsedVariants.length > 0 && targetStock === undefined) {
        targetStock = parsedVariants.reduce((sum, v) => sum + (parseFloat(v.stock) || 0), 0);
      }
    }

    if (targetStock !== undefined) {
      fields.push(`current_stock = $${index++}`);
      params.push(Math.max(0, parseFloat(targetStock)));
    }
    if (targetThreshold !== undefined) {
      fields.push(`minimum_threshold = $${index++}`);
      params.push(Math.max(0, parseFloat(targetThreshold)));
    }
    if (targetImage !== undefined) {
      fields.push(`image_url = $${index++}`);
      params.push(targetImage);
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
      image: row.image_url,
      imageUrl: row.image_url,
      image_url: row.image_url,
      variants: InventoryModel.parseVariants(row.variants),
      stock: parseFloat(row.current_stock) || 0,
      current_stock: parseFloat(row.current_stock) || 0,
      currentStock: parseFloat(row.current_stock) || 0,
      threshold: parseFloat(row.minimum_threshold) || 0,
      minimum_threshold: parseFloat(row.minimum_threshold) || 0,
      minimumThreshold: parseFloat(row.minimum_threshold) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Adjust stock level by absolute value or delta
   */
  static async adjustStock(id, { stockDelta, delta, absoluteStock, stock, currentStock, current_stock }, client = null) {
    const queryRunner = client || db;
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

    const result = await queryRunner.query(queryText, params);
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
      image: row.image_url,
      imageUrl: row.image_url,
      image_url: row.image_url,
      variants: InventoryModel.parseVariants(row.variants),
      stock: parseFloat(row.current_stock) || 0,
      current_stock: parseFloat(row.current_stock) || 0,
      currentStock: parseFloat(row.current_stock) || 0,
      threshold: parseFloat(row.minimum_threshold) || 0,
      minimum_threshold: parseFloat(row.minimum_threshold) || 0,
      minimumThreshold: parseFloat(row.minimum_threshold) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Deduct stock for a specific nested variant inside parent inventory document
   */
  static async deductNestedVariantStock(parentIdOrName, size, quantityToDeduct = 1, client = null) {
    const queryRunner = client || db;
    const qty = Math.max(1, parseInt(quantityToDeduct, 10) || 1);
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
    const cleanSize = norm(size);

    const matchSize = (sizeA, sizeB) => {
      const a = norm(sizeA);
      const b = norm(sizeB);
      if (!a || !b) return false;
      if (a === b) return true;
      if (a.replace(/l$/, 'liter') === b || b.replace(/l$/, 'liter') === a) return true;
      if (a === '500ml' && (b === '0.5l' || b === '0.5liter')) return true;
      if (b === '500ml' && (a === '0.5l' || a === '0.5liter')) return true;
      if (a === '1l' && (b === '1000ml' || b === '1liter')) return true;
      if (b === '1l' && (a === '1000ml' || a === '1liter')) return true;
      if (a === '1.5l' && (b === '1500ml' || b === '1.5liter')) return true;
      if (b === '1.5l' && (a === '1500ml' || a === '1.5liter')) return true;
      if (a === '2l' && (b === '2000ml' || b === '2liter')) return true;
      if (b === '2l' && (a === '2000ml' || a === '2liter')) return true;
      return false;
    };

    // 1. Fetch parent item
    const isNumericId = /^\d+$/.test(String(parentIdOrName).trim());
    let itemQuery = !isNumericId
      ? `SELECT * FROM inventory_items WHERE LOWER(name) = LOWER($1) OR LOWER(name) LIKE LOWER($2)`
      : `SELECT * FROM inventory_items WHERE id = $1`;
    let itemParams = !isNumericId
      ? [String(parentIdOrName).trim(), `%${String(parentIdOrName).trim()}%`]
      : [parseInt(parentIdOrName, 10)];

    const itemRes = await queryRunner.query(itemQuery, itemParams);
    if (!itemRes.rows || itemRes.rows.length === 0) {
      return null;
    }

    const parentRow = itemRes.rows[0];
    const variants = InventoryModel.parseVariants(parentRow.variants);

    if (variants.length > 0) {
      let matched = false;
      const updatedVariants = variants.map((v) => {
        if (matchSize(v.size, size)) {
          matched = true;
          const currentVariantStock = parseFloat(v.stock) || 0;
          const newVariantStock = Math.max(0, currentVariantStock - qty);
          return { ...v, stock: newVariantStock };
        }
        return v;
      });

      if (matched) {
        const newTotalStock = updatedVariants.reduce((sum, v) => sum + (parseFloat(v.stock) || 0), 0);
        const updateRes = await queryRunner.query(
          `UPDATE inventory_items 
           SET variants = $1, current_stock = $2
           WHERE id = $3
           RETURNING *`,
          [JSON.stringify(updatedVariants), newTotalStock, parentRow.id]
        );
        return {
          success: true,
          parentId: parentRow.id,
          parentName: parentRow.name,
          variantSize: size,
          deductedQty: qty,
          updatedVariants,
          newTotalStock
        };
      }
    }

    if (size) {
      // When a specific size variant was requested but this item has no matching variant, return null
      return null;
    }

    // Fallback: Decrement parent current_stock directly when no size variant was specified
    const fallbackRes = await queryRunner.query(
      `UPDATE inventory_items 
       SET current_stock = GREATEST(0, current_stock - $1)
       WHERE id = $2
       RETURNING *`,
      [qty, parentRow.id]
    );

    return {
      success: true,
      parentId: parentRow.id,
      parentName: parentRow.name,
      deductedQty: qty,
      newTotalStock: parseFloat(fallbackRes.rows[0]?.current_stock || 0)
    };
  }

  /**
   * Restock a specific nested variant inside parent inventory document (e.g. on order cancellation)
   */
  static async restockNestedVariantStock(parentIdOrName, size, quantityToRestock = 1, client = null) {
    const queryRunner = client || db;
    const qty = Math.max(1, parseInt(quantityToRestock, 10) || 1);
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '');

    const matchSize = (sizeA, sizeB) => {
      const a = norm(sizeA);
      const b = norm(sizeB);
      if (!a || !b) return false;
      if (a === b) return true;
      if (a.replace(/l$/, 'liter') === b || b.replace(/l$/, 'liter') === a) return true;
      if (a === '500ml' && (b === '0.5l' || b === '0.5liter')) return true;
      if (b === '500ml' && (a === '0.5l' || a === '0.5liter')) return true;
      if (a === '1l' && (b === '1000ml' || b === '1liter')) return true;
      if (b === '1l' && (a === '1000ml' || a === '1liter')) return true;
      if (a === '1.5l' && (b === '1500ml' || b === '1.5liter')) return true;
      if (b === '1.5l' && (a === '1500ml' || a === '1.5liter')) return true;
      if (a === '2l' && (b === '2000ml' || b === '2liter')) return true;
      if (b === '2l' && (a === '2000ml' || a === '2liter')) return true;
      return false;
    };

    // 1. Fetch parent item
    const isNumericId = /^\d+$/.test(String(parentIdOrName).trim());
    let itemQuery = !isNumericId
      ? `SELECT * FROM inventory_items WHERE LOWER(name) = LOWER($1) OR LOWER(name) LIKE LOWER($2)`
      : `SELECT * FROM inventory_items WHERE id = $1`;
    let itemParams = !isNumericId
      ? [String(parentIdOrName).trim(), `%${String(parentIdOrName).trim()}%`]
      : [parseInt(parentIdOrName, 10)];

    const itemRes = await queryRunner.query(itemQuery, itemParams);
    if (!itemRes.rows || itemRes.rows.length === 0) {
      return null;
    }

    const parentRow = itemRes.rows[0];
    const variants = InventoryModel.parseVariants(parentRow.variants);

    if (variants.length > 0) {
      let matched = false;
      const updatedVariants = variants.map((v) => {
        if (matchSize(v.size, size)) {
          matched = true;
          const currentVariantStock = parseFloat(v.stock) || 0;
          const newVariantStock = currentVariantStock + qty;
          return { ...v, stock: newVariantStock };
        }
        return v;
      });

      if (matched) {
        const newTotalStock = updatedVariants.reduce((sum, v) => sum + (parseFloat(v.stock) || 0), 0);
        await queryRunner.query(
          `UPDATE inventory_items 
           SET variants = $1, current_stock = $2
           WHERE id = $3
           RETURNING *`,
          [JSON.stringify(updatedVariants), newTotalStock, parentRow.id]
        );
        return {
          success: true,
          parentId: parentRow.id,
          parentName: parentRow.name,
          variantSize: size,
          restockedQty: qty,
          updatedVariants,
          newTotalStock
        };
      }
    }

    if (size) {
      return null;
    }

    // Fallback: Increment parent current_stock directly when no size variant was specified
    const fallbackRes = await queryRunner.query(
      `UPDATE inventory_items 
       SET current_stock = current_stock + $1
       WHERE id = $2
       RETURNING *`,
      [qty, parentRow.id]
    );

    return {
      success: true,
      parentId: parentRow.id,
      parentName: parentRow.name,
      restockedQty: qty,
      newTotalStock: parseFloat(fallbackRes.rows[0]?.current_stock || 0)
    };
  }

  /**
   * Delete an inventory item
   */
  static async delete(id) {
    try {
      await db.query('DELETE FROM menu_item_recipes WHERE inventory_item_id = $1', [id]);
    } catch (ignore) {}

    const result = await db.query('DELETE FROM inventory_items WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      throw new AppError('Inventory item not found.', 404);
    }
    return result.rows[0];
  }
}

module.exports = InventoryModel;
