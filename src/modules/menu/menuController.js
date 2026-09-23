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

const createMenuItem = async (req, res, next) => {
  try {
    const { categoryId, name, description, price, imageUrl, imageAltText, isVegan, isHalal, isGlutenFree, isAvailable } = req.body;

    if (!name || price === undefined || !imageAltText) {
      throw new AppError('name, price, and imageAltText are required fields.', 400);
    }

    const newItem = await menuService.createMenuItem({
      categoryId,
      name,
      description,
      price: parseFloat(price),
      imageUrl,
      imageAltText,
      isVegan,
      isHalal,
      isGlutenFree,
      isAvailable,
    });

    res.status(201).json({
      success: true,
      message: 'Menu item created successfully.',
      data: newItem,
    });
  } catch (error) {
    next(error);
  }
};

const updateMenuItem = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid menu item ID.', 400);
    }

    const updated = await menuService.updateMenuItem(id, req.body);
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
