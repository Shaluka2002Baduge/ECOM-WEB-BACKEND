const menuService = require('./menuService');
const { AppError } = require('../../middleware/errorAspect');

const getCategories = async (req, res, next) => {
  try {
    const categories = await menuService.getCategories();
    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

const createCategory = async (req, res, next) => {
  try {
    const { name, slug, description } = req.body;
    if (!name) {
      throw new AppError('Category name is required.', 400);
    }

    const category = await menuService.createCategory({ name, slug, description });
    res.status(201).json({
      success: true,
      message: 'Category created successfully.',
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

const getMenuItems = async (req, res, next) => {
  try {
    const items = await menuService.getMenuItems(req.query);
    res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error) {
    next(error);
  }
};

const getMenuItemById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid menu item ID.', 400);
    }

    const item = await menuService.getMenuItemById(id);
    res.status(200).json({
      success: true,
      data: item,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Maps numeric or descriptive spice level to integer 0-5
 * @param {any} spice 
 * @returns {number} 0-5 or NaN if invalid
 */
const mapSpiceLevel = (spice) => {
  if (spice === undefined || spice === null || spice === '') return 0;
  if (typeof spice === 'number' && Number.isInteger(spice) && spice >= 0 && spice <= 5) return spice;
  const num = Number(spice);
  if (!isNaN(num) && Number.isInteger(num) && num >= 0 && num <= 5) return num;
  const lower = String(spice).trim().toLowerCase();
  if (lower === 'none' || lower === 'no spice' || lower === 'zero') return 0;
  if (lower === 'mild' || lower === 'low') return 1;
  if (lower === 'medium' || lower === 'medium spice') return 2;
  if (lower === 'hot' || lower === 'spicy') return 3;
  if (lower === 'extra hot' || lower === 'very hot') return 4;
  if (lower === 'extreme' || lower === 'fiery') return 5;
  return NaN;
};

/**
 * Validates dish input for creation and update
 * @param {Object} data - Input payload
 * @param {boolean} isUpdate - True if updating existing dish
 * @returns {string[]} Array of validation error messages
 */
const validateDishInput = (data, isUpdate = false) => {
  const errors = [];
  const {
    name,
    price,
    description,
    spice_level,
    spiceLevel,
  } = data;

  const rawSpice = spice_level !== undefined ? spice_level : spiceLevel;

  // Name validation: Required on create, string, trimmed length between 3 and 120
  if (!isUpdate || name !== undefined) {
    if (name === undefined || name === null || typeof name !== 'string' || name.trim().length < 3 || name.trim().length > 120) {
      errors.push('name is required and must be between 3 and 120 characters.');
    }
  }

  // Price validation: Required on create, numeric, > 0
  if (!isUpdate || price !== undefined) {
    const numPrice = Number(price);
    if (price === undefined || price === null || price === '' || isNaN(numPrice) || numPrice <= 0) {
      errors.push('price is required, must be numeric, and must be greater than 0.');
    }
  }

  // Description validation: Required on create, trimmed length between 10 and 1000
  if (!isUpdate || description !== undefined) {
    if (description === undefined || description === null || typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 1000) {
      errors.push('description is required and must be between 10 and 1000 characters.');
    }
  }

  // Spice level validation: Integer between 0 and 5
  if (rawSpice !== undefined && rawSpice !== null && rawSpice !== '') {
    const spiceNum = mapSpiceLevel(rawSpice);
    if (isNaN(spiceNum) || spiceNum < 0 || spiceNum > 5) {
      errors.push('spice_level must be an integer between 0 and 5.');
    }
  }

  return errors;
};

const createMenuItem = async (req, res, next) => {
  try {
    const {
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
    } = req.body;

    const finalSpice = spice_level !== undefined ? Number(spice_level) : (spiceLevel !== undefined ? Number(spiceLevel) : 0);
    let finalAvailability = true;
    if (is_available !== undefined) finalAvailability = Boolean(is_available);
    else if (isAvailable !== undefined) finalAvailability = Boolean(isAvailable);
    else if (status !== undefined) finalAvailability = status.toLowerCase() === 'available';

    const finalImageUrl = image_url || image || '/images/default-dish.jpg';
    const tagsArray = Array.isArray(dietary_tags || dietaryTags) 
      ? (dietary_tags || dietaryTags) 
      : ((dietary_tags || dietaryTags) ? (dietary_tags || dietaryTags).split(',').map(s => s.trim()).filter(Boolean) : []);

    const validationErrors = validateDishInput({
      name,
      price,
      description,
      spice_level: rawSpiceOrSpiceLevel(spice_level, spiceLevel),
      image_url: finalImageUrl,
    }, false);

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: validationErrors,
      });
    }

    const newDish = await menuService.createMenuItem(req.body);

    console.log('💾 [MENU ITEM CREATED & PERSISTED]:', { id: newDish.id, name: newDish.name, price: newDish.price, hasImage: Boolean(finalImageUrl) });

    return res.status(201).json({
      success: true,
      message: 'Menu item created successfully',
      data: newDish,
    });
  } catch (error) {
    next(error);
  }
};

const rawSpiceOrSpiceLevel = (spice1, spice2) => (spice1 !== undefined ? spice1 : spice2);

const updateMenuItem = async (req, res, next) => {
  try {
    const dishId = req.params.id;
    const {
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
      imagePreview,
    } = req.body;

    const finalImageUrl = image_url || image || imagePreview || undefined;

    const validationErrors = validateDishInput({
      name,
      price,
      description,
      spice_level: rawSpiceOrSpiceLevel(spice_level, spiceLevel),
      image_url: finalImageUrl,
    }, true);

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: validationErrors,
      });
    }

    const updated = await menuService.updateMenuItem(dishId, req.body);

    console.log('💾 [MENU ITEM UPDATED & PERSISTED]:', { id: dishId, name: updated?.name || name, price: updated?.price || price, hasImage: Boolean(finalImageUrl) });

    res.status(200).json({
      success: true,
      message: 'Menu item updated successfully.',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

const deleteMenuItem = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid menu item ID.', 400);
    }

    await menuService.deleteMenuItem(id);
    res.status(200).json({
      success: true,
      message: 'Menu item deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
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
