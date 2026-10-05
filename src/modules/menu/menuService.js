const db = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');

/**
 * Fetch all menu categories
 */
const getCategories = async () => {
  const result = await db.query(
    'SELECT id, name, slug, description, created_at FROM categories ORDER BY id ASC'
  );
  return result.rows;
};

/**
 * Create a new menu category
 */
const createCategory = async ({ name, slug, description }) => {
  const generatedSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const result = await db.query(
    `INSERT INTO categories (name, slug, description)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, generatedSlug, description || null]
  );
  return result.rows[0];
};

/**
 * Fetch menu items with optional category and dietary filters
 */
const getMenuItems = async (filters = {}) => {
  const { categoryId, isVegan, isHalal, isGlutenFree, isAvailable, search } = filters;
  
  const isAll = !categoryId || String(categoryId).toLowerCase() === 'all';
  const isInventoryBeveragesCat =
    String(categoryId) === '7' ||
    String(categoryId).toLowerCase() === 'beverages-water-bottles' ||
    String(categoryId).toLowerCase() === 'beverages & water bottles';
  const isHandCraftedDrinksCat =
    String(categoryId) === '6' ||
    String(categoryId).toLowerCase() === 'hand-crafted-drinks' ||
    String(categoryId).toLowerCase() === 'hand crafted drinks' ||
    String(categoryId).toLowerCase() === 'craft-beverages' ||
    String(categoryId).toLowerCase() === 'craft beverages';

  let includeMenuItems = isAll || !isInventoryBeveragesCat;
  let includeInventoryItems = isAll || isInventoryBeveragesCat;

  let queryText = '';
  const params = [];

  if (includeMenuItems) {
    queryText += `
      SELECT m.id, m.name, m.description,
             m.price::numeric(10,2) AS price,
             m.image_url::text AS image_url,
             m.image_alt_text::text AS image_alt_text,
             m.spice_level::text AS spice_level,
             m.dietary_tags::text[] AS dietary_tags,
             m.is_vegan::boolean AS is_vegan,
             m.is_halal::boolean AS is_halal,
             m.is_gluten_free::boolean AS is_gluten_free,
             m.is_available::boolean AS is_available,
             '[]'::jsonb AS variants,
             c.id::int AS category_id,
             c.name::text AS category_name,
             c.slug::text AS category_slug,
             'menu'::text AS item_source,
             FALSE::boolean AS is_inventory_item,
             FALSE::boolean AS is_inventory_synced,
             m.created_at::timestamptz AS created_at,
             m.updated_at::timestamptz AS updated_at
      FROM menu_items m
      LEFT JOIN categories c ON m.category_id = c.id
      WHERE 1=1
    `;

    if (categoryId && !isAll && !isInventoryBeveragesCat) {
      params.push(categoryId);
      queryText += ` AND m.category_id = $${params.length}`;
    }

    if (isVegan !== undefined) {
      params.push(isVegan === 'true' || isVegan === true);
      queryText += ` AND m.is_vegan = $${params.length}`;
    }

    if (isHalal !== undefined) {
      params.push(isHalal === 'true' || isHalal === true);
      queryText += ` AND m.is_halal = $${params.length}`;
    }

    if (isGlutenFree !== undefined) {
      params.push(isGlutenFree === 'true' || isGlutenFree === true);
      queryText += ` AND m.is_gluten_free = $${params.length}`;
    }

    if (isAvailable !== undefined) {
      params.push(isAvailable === 'true' || isAvailable === true);
      queryText += ` AND m.is_available = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      queryText += ` AND (m.name ILIKE $${params.length} OR m.description ILIKE $${params.length})`;
    }
  }

  if (includeInventoryItems) {
    if (includeMenuItems) {
      queryText += ` UNION ALL `;
    }

    queryText += `
      SELECT inv.id, inv.name,
             ('Fresh authentic ' || inv.name || ' curated directly from our certified estates. Select your preferred bottle size.')::text AS description,
             COALESCE((inv.variants->0->>'price')::numeric, 150.00)::numeric(10,2) AS price,
             COALESCE(NULLIF(inv.image_url, ''), 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?auto=format&fit=crop&w=800&q=80')::text AS image_url,
             ('Authentic royal beverage: ' || inv.name)::text AS image_alt_text,
             'None'::text AS spice_level,
             ARRAY['Vegetarian', 'Vegan', 'Halal', 'Chef Special']::text[] AS dietary_tags,
             TRUE::boolean AS is_vegan,
             TRUE::boolean AS is_halal,
             TRUE::boolean AS is_gluten_free,
             (inv.current_stock > 0)::boolean AS is_available,
             COALESCE(inv.variants, '[]'::jsonb)::jsonb AS variants,
             7::int AS category_id,
             'Beverages & Water Bottles'::text AS category_name,
             'beverages-water-bottles'::text AS category_slug,
             'inventory'::text AS item_source,
             TRUE::boolean AS is_inventory_item,
             TRUE::boolean AS is_inventory_synced,
             inv.created_at::timestamptz AS created_at,
             inv.updated_at::timestamptz AS updated_at
      FROM inventory_items inv
      WHERE (inv.category = 'Beverages & Water Bottles' OR (inv.variants IS NOT NULL AND inv.variants != '[]'::jsonb AND inv.variants::text != '""'))
        AND NOT EXISTS (SELECT 1 FROM menu_items m2 WHERE LOWER(m2.name) = LOWER(inv.name))
    `;

    if (search) {
      params.push(`%${search}%`);
      queryText += ` AND (inv.name ILIKE $${params.length})`;
    }
  }

  queryText += ' ORDER BY id ASC';

  const result = await db.query(queryText, params);
  return result.rows;
};

/**
 * Get a single menu item with linked recipe ingredients
 */
const getMenuItemById = async (id) => {
  const itemResult = await db.query(
    `SELECT m.*, c.name AS category_name
     FROM menu_items m
     LEFT JOIN categories c ON m.category_id = c.id
     WHERE m.id = $1`,
    [id]
  );

  if (itemResult.rows.length > 0) {
    const item = itemResult.rows[0];

    // Fetch recipe components
    const recipeResult = await db.query(
      `SELECT r.id, r.inventory_item_id, i.name AS ingredient_name, i.unit, r.quantity_required
       FROM menu_item_recipes r
       JOIN inventory_items i ON r.inventory_item_id = i.id
       WHERE r.menu_item_id = $1`,
      [id]
    );

    item.recipes = recipeResult.rows;

    // Check if there's matching inventory item with live variants / image
    try {
      const invCheck = await db.query(
        `SELECT id, name, current_stock, image_url, variants FROM inventory_items WHERE id = $1 OR LOWER(name) = LOWER($2)`,
        [id, item.name]
      );
      if (invCheck.rows.length > 0) {
        const invRow = invCheck.rows[0];
        if (invRow.image_url) item.image_url = invRow.image_url;
        let parsedVariants = [];
        try {
          parsedVariants = typeof invRow.variants === 'string' ? JSON.parse(invRow.variants) : (invRow.variants || []);
        } catch (e) {}
        if (parsedVariants.length > 0) {
          item.variants = parsedVariants;
          if (parsedVariants[0].price) item.price = parseFloat(parsedVariants[0].price);
        }
        item.is_available = parseFloat(invRow.current_stock || 0) > 0;
      }
    } catch (ignore) {}

    return item;
  }

  // If not in menu_items, check inventory_items directly
  const invResult = await db.query(
    `SELECT id, name, category, supplier, unit, current_stock, minimum_threshold,
            COALESCE(image_url, '') AS image_url,
            COALESCE(variants, '[]'::jsonb) AS variants,
            created_at, updated_at
     FROM inventory_items
     WHERE id = $1`,
    [id]
  );

  if (invResult.rows.length > 0) {
    const inv = invResult.rows[0];
    let parsedVariants = [];
    try {
      parsedVariants = typeof inv.variants === 'string' ? JSON.parse(inv.variants) : (inv.variants || []);
    } catch (e) {}
    const basePrice = parsedVariants.length > 0 ? parseFloat(parsedVariants[0].price || 0) : 150;

    return {
      id: inv.id,
      name: inv.name,
      description: `Fresh authentic ${inv.name} curated directly from our certified estates. Select your preferred bottle size.`,
      price: basePrice,
      image_url: inv.image_url || 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?auto=format&fit=crop&w=800&q=80',
      image_alt_text: `Authentic royal beverage: ${inv.name}`,
      spice_level: 0,
      dietary_tags: ['Vegetarian', 'Vegan', 'Halal', 'Chef Special'],
      is_vegan: true,
      is_halal: true,
      is_gluten_free: true,
      is_available: parseFloat(inv.current_stock || 0) > 0,
      variants: parsedVariants,
      category_id: 7,
      category_name: 'Beverages & Water Bottles',
      category_slug: 'beverages-water-bottles',
      item_source: 'inventory',
      is_inventory_item: true,
      is_inventory_synced: true,
      created_at: inv.created_at,
      updated_at: inv.updated_at,
      recipes: []
    };
  }

  throw new AppError('Menu item not found.', 404);
};

/**
 * Resolves category_id from numeric ID or category name string
 * @param {any} rawCategoryId 
 * @param {string} rawCategoryName 
 * @returns {Promise<number>}
 */
const resolveCategoryId = async (rawCategoryId, rawCategoryName) => {
  let resolvedCategoryId = rawCategoryId;

  if (resolvedCategoryId === undefined || resolvedCategoryId === null || resolvedCategoryId === '' || isNaN(Number(resolvedCategoryId))) {
    const categoryName = (rawCategoryName || resolvedCategoryId || '').toString().trim();
    if (categoryName) {
      const categoryRes = await db.query(
        'SELECT id FROM categories WHERE LOWER(name) = LOWER($1) LIMIT 1',
        [categoryName]
      );
      if (categoryRes.rows.length > 0) {
        return categoryRes.rows[0].id;
      }
    }
    const defaultCat = await db.query('SELECT id FROM categories ORDER BY id ASC LIMIT 1');
    return defaultCat.rows[0]?.id || 1;
  }
  return parseInt(resolvedCategoryId, 10);
};

/**
 * Create a new menu item
 */
const createMenuItem = async (data) => {
  const {
    category_id,
    categoryId,
    category,
    name,
    description,
    price,
    spice_level,
    spiceLevel,
    is_available,
    isAvailable,
    status,
    dietary_tags,
    dietaryTags,
    image_url,
    image,
  } = data;

  const resolvedCategoryId = await resolveCategoryId(category_id || categoryId, category);

  const finalSpice = spice_level !== undefined ? Number(spice_level) : (spiceLevel !== undefined ? Number(spiceLevel) : 0);
  let finalAvailability = true;
  if (is_available !== undefined) finalAvailability = Boolean(is_available);
  else if (isAvailable !== undefined) finalAvailability = Boolean(isAvailable);
  else if (status !== undefined) finalAvailability = status.toLowerCase() === 'available';

  const finalImageUrl = image_url || image || '/images/default-dish.jpg';
  const finalAltText = data.image_alt_text || data.imageAltText || name || 'Dish image';
  const tagsArray = Array.isArray(dietary_tags || dietaryTags) 
    ? (dietary_tags || dietaryTags) 
    : ((dietary_tags || dietaryTags) ? (dietary_tags || dietaryTags).split(',').map(s => s.trim()).filter(Boolean) : []);

  const result = await db.query(
    `INSERT INTO menu_items (
       category_id,
       name,
       description,
       price,
       image_url,
       image_alt_text,
       spice_level,
       dietary_tags,
       is_available
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *;`,
    [
      resolvedCategoryId,
      name,
      description || null,
      Number(price),
      finalImageUrl,
      finalAltText,
      finalSpice,
      tagsArray,
      finalAvailability,
    ]
  );

  return result.rows[0];
};

/**
 * Update a menu item
 */
const updateMenuItem = async (id, data) => {
  const {
    name,
    category_id,
    categoryId,
    category,
    price,
    description,
    spice_level,
    spiceLevel,
    is_available,
    isAvailable,
    status,
    dietary_tags,
    dietaryTags,
    image_url,
    image,
    imagePreview,
  } = data;

  let resolvedCategoryId = null;
  if (category_id !== undefined || categoryId !== undefined || category !== undefined) {
    resolvedCategoryId = await resolveCategoryId(category_id !== undefined ? category_id : categoryId, category);
  }

  const finalSpice = spice_level !== undefined ? Number(spice_level) : (spiceLevel !== undefined ? Number(spiceLevel) : 0);
  let finalAvailability = true;
  if (is_available !== undefined) finalAvailability = Boolean(is_available);
  else if (isAvailable !== undefined) finalAvailability = Boolean(isAvailable);
  else if (status !== undefined) finalAvailability = status.toLowerCase() === 'available';

  const finalImageUrl = image_url || image || imagePreview || null;
  const tagsArray = Array.isArray(dietary_tags || dietaryTags) 
    ? (dietary_tags || dietaryTags) 
    : ((dietary_tags || dietaryTags) ? (dietary_tags || dietaryTags).split(',').map(s => s.trim()).filter(Boolean) : null);

  const result = await db.query(
    `UPDATE menu_items
     SET 
       name = COALESCE($1, name),
       category_id = COALESCE($2, category_id),
       price = COALESCE($3, price),
       description = COALESCE($4, description),
       spice_level = $5,
       is_available = $6,
       dietary_tags = COALESCE($7, dietary_tags),
       image_url = COALESCE($8, image_url),
       updated_at = NOW()
     WHERE id = $9
     RETURNING *;`,
    [
      name !== undefined ? name : null,
      resolvedCategoryId,
      price !== undefined ? Number(price) : null,
      description !== undefined ? description : null,
      finalSpice,
      finalAvailability,
      tagsArray,
      finalImageUrl,
      id,
    ]
  );

  if (result.rows.length === 0) {
    throw new AppError('Menu item not found.', 404);
  }

  return result.rows[0];
};

/**
 * Delete a menu item
 */
const deleteMenuItem = async (id) => {
  // 1. Clean up associated recipe links if any
  try {
    await db.query('DELETE FROM menu_item_recipes WHERE menu_item_id = $1', [id]);
  } catch (ignore) {}

  // 2. Clean up associated order line items if any
  try {
    await db.query('DELETE FROM order_items WHERE menu_item_id = $1', [id]);
  } catch (ignore) {}

  const result = await db.query('DELETE FROM menu_items WHERE id = $1 RETURNING id, name', [id]);
  if (result.rows.length === 0) {
    const invCheck = await db.query('SELECT id, name FROM inventory_items WHERE id = $1', [id]);
    if (invCheck.rows.length > 0) {
      throw new AppError(
        `"${invCheck.rows[0].name}" is managed in Inventory. Please delete or modify it directly from the Inventory section to prevent sync breaks.`,
        400
      );
    }
    throw new AppError('Menu item not found.', 404);
  }
  return { id: result.rows[0].id, name: result.rows[0].name };
};

module.exports = {
  getCategories,
  createCategory,
  getMenuItems,
  getMenuItemById,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
};
