const staffService = require('./staffService');
const { AppError } = require('../../middleware/errorAspect');

const getStaff = async (req, res, next) => {
  try {
    const { role, search } = req.query;
    const staff = await staffService.getStaffList(role, search);
    res.status(200).json({
      success: true,
      count: staff.length,
      data: staff,
    });
  } catch (error) {
    next(error);
  }
};

const getStaffById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const staff = await staffService.getStaffById(id);
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
    const { displayName, name, email, password, phone, role, department, station, shiftStatus, status } = req.body;
    if (!displayName && !name) {
      throw new AppError('Name is required.', 400);
    }
    if (!email) {
      throw new AppError('Email is required.', 400);
    }
    if (!role) {
      throw new AppError('Role is required.', 400);
    }

    const newStaff = await staffService.createStaffMember({
      displayName: displayName || name,
      email,
      password: password || 'Password123!',
      phone,
      role,
      department: department || station || 'General Operations',
      shiftStatus: shiftStatus || status || 'Active Shift',
    });

    res.status(201).json({
      success: true,
      message: 'Staff member account created and RBAC privileges granted successfully.',
      data: newStaff,
    });
  } catch (error) {
    next(error);
  }
};

const updateStaff = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await staffService.updateStaffMember(id, req.body);
    res.status(200).json({
      success: true,
      message: 'Staff details and station assignment updated successfully.',
      data: updated,
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
      throw new AppError('Role is required.', 400);
    }
    const updated = await staffService.updateStaffRole(id, role);
    res.status(200).json({
      success: true,
      message: 'Staff security role updated successfully.',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

const deleteStaff = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await staffService.deleteStaffMember(id);
    res.status(200).json({
      success: true,
      message: 'Staff member account revoked and removed from registry.',
      data: deleted,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getStaff,
  getStaffById,
  createStaff,
  updateStaff,
  updateRole,
  deleteStaff,
};
