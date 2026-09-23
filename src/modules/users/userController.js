const usersService = require('./userService');
const { AppError } = require('../../middleware/errorAspect');

const getProfile = async (req, res, next) => {
  try {
    const profile = await usersService.getUserProfile(req.user.id);
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { displayName, phone } = req.body;
    const updated = await usersService.updateUserProfile(req.user.id, { displayName, phone });
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

const getAddresses = async (req, res, next) => {
  try {
    const addresses = await usersService.getUserAddresses(req.user.id);
    res.status(200).json({
      success: true,
      data: addresses,
    });
  } catch (error) {
    next(error);
  }
};

const addAddress = async (req, res, next) => {
  try {
    const { addressLine1, addressLine2, city, stateProvince, postalCode, isDefault } = req.body;

    if (!addressLine1 || !city || !postalCode) {
      throw new AppError('addressLine1, city, and postalCode are required.', 400);
    }

    const newAddress = await usersService.addUserAddress(req.user.id, {
      addressLine1,
      addressLine2,
      city,
      stateProvince,
      postalCode,
      isDefault,
    });

    res.status(201).json({
      success: true,
      message: 'Address added successfully.',
      data: newAddress,
    });
  } catch (error) {
    next(error);
  }
};

const deleteAddress = async (req, res, next) => {
  try {
    const addressId = parseInt(req.params.id, 10);
    if (isNaN(addressId)) {
      throw new AppError('Invalid address ID.', 400);
    }

    await usersService.deleteUserAddress(req.user.id, addressId);
    res.status(200).json({
      success: true,
      message: 'Address deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  getAddresses,
  addAddress,
  deleteAddress,
};
