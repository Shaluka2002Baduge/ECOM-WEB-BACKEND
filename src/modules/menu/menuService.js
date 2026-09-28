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
  let queryText = `
    SELECT m.id, m.name, m.description, m.price, m.image_url, m.image_alt_text,
           m.spice_level, m.dietary_tags,
           m.is_vegan, m.is_halal, m.is_gluten_free, m.is_available,
           c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
           m.created_at, m.updated_at
    FROM menu_items m
    LEFT JOIN categories c ON m.category_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (categoryId) {
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

  queryText += ' ORDER BY m.id ASC';

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

  if (itemResult.rows.length === 0) {
    throw new AppError('Menu item not found.', 404);
  }

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
  return item;
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
  const result = await db.query('DELETE FROM menu_items WHERE id = $1 RETURNING id', [id]);
  if (result.rows.length === 0) {
    throw new AppError('Menu item not found.', 404);
  }
  return { id };
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
