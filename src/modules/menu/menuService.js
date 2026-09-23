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

  queryText += ' ORDER BY m.category_id ASC, m.name ASC';

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
 * Create a new menu item (WCAG image_alt_text is mandatory)
 */
const createMenuItem = async (data) => {
  const {
    categoryId,
    name,
    description,
    price,
    imageUrl,
    imageAltText,
    isVegan = false,
    isHalal = false,
    isGlutenFree = false,
    isAvailable = true,
  } = data;

  if (!imageAltText || imageAltText.trim() === '') {
    throw new AppError('image_alt_text is mandatory for WCAG accessibility compliance.', 400);
  }

  const result = await db.query(
    `INSERT INTO menu_items (
       category_id, name, description, price, image_url, image_alt_text,
       is_vegan, is_halal, is_gluten_free, is_available
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      categoryId || null,
      name,
      description || null,
      price,
      imageUrl || null,
      imageAltText,
      isVegan,
      isHalal,
      isGlutenFree,
      isAvailable,
    ]
  );

  return result.rows[0];
};

/**
 * Update a menu item
 */
const updateMenuItem = async (id, data) => {
  const current = await getMenuItemById(id);

  const updatedFields = {
    categoryId: data.categoryId !== undefined ? data.categoryId : current.category_id,
    name: data.name || current.name,
    description: data.description !== undefined ? data.description : current.description,
    price: data.price !== undefined ? data.price : current.price,
    imageUrl: data.imageUrl !== undefined ? data.imageUrl : current.image_url,
    imageAltText: data.imageAltText || current.image_alt_text,
    isVegan: data.isVegan !== undefined ? data.isVegan : current.is_vegan,
    isHalal: data.isHalal !== undefined ? data.isHalal : current.is_halal,
    isGlutenFree: data.isGlutenFree !== undefined ? data.isGlutenFree : current.is_gluten_free,
    isAvailable: data.isAvailable !== undefined ? data.isAvailable : current.is_available,
  };

  const result = await db.query(
    `UPDATE menu_items
     SET category_id = $1, name = $2, description = $3, price = $4,
         image_url = $5, image_alt_text = $6, is_vegan = $7,
         is_halal = $8, is_gluten_free = $9, is_available = $10
     WHERE id = $11
     RETURNING *`,
    [
      updatedFields.categoryId,
      updatedFields.name,
      updatedFields.description,
      updatedFields.price,
      updatedFields.imageUrl,
      updatedFields.imageAltText,
      updatedFields.isVegan,
      updatedFields.isHalal,
      updatedFields.isGlutenFree,
      updatedFields.isAvailable,
      id,
    ]
  );

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
