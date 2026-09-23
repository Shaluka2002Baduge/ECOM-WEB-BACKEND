const staffService = require('./staffService');
const { AppError } = require('../../middleware/errorAspect');

const getStaff = async (req, res, next) => {
  try {
    const { role } = req.query;
    const staff = await staffService.getStaffList(role);
    res.status(200).json({
      success: true,
      data: staff,
    });
  } catch (error) {
    next(error);
  }
};

const createStaff = async (req, res, next) => {
  try {
    const { displayName, email, password, phone, role } = req.body;
    if (!displayName || !email || !password || !role) {
      throw new AppError('displayName, email, password, and role are required.', 400);
    }

    const newStaff = await staffService.createStaffMember({
      displayName,
      email,
      password,
      phone,
      role,
    });

    res.status(201).json({
      success: true,
      message: 'Staff member account created successfully.',
      data: newStaff,
    });
  } catch (error) {
    next(error);
  }
};

const updateRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role) {
      throw new AppError('role is required.', 400);
    }

    const updated = await staffService.updateStaffRole(id, role);
    res.status(200).json({
      success: true,
      message: 'Staff role updated successfully.',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getStaff,
  createStaff,
  updateRole,
};
