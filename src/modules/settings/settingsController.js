const settingsService = require('./settingsService');

/**
 * GET /api/admin/settings
 * Retrieve current restaurant & system settings
 */
const getSettings = async (req, res, next) => {
  try {
    const settings = await settingsService.getSettings();
    res.status(200).json({
      success: true,
      message: 'Settings retrieved successfully.',
      data: settings,
      settings
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/settings
 * Update restaurant & system settings
 */
const updateSettings = async (req, res, next) => {
  try {
    const updated = await settingsService.updateSettings(req.body);
    res.status(200).json({
      success: true,
      message: 'Restaurant settings updated successfully.',
      data: updated,
      settings: updated
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/settings/password
 * Update admin login password securely
 */
const updateAdminPassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    const result = await settingsService.updateAdminPassword({
      userId,
      userEmail,
      currentPassword,
      newPassword,
      confirmPassword
    });

    res.status(200).json({
      success: true,
      message: 'Password updated successfully. Please use your new password for subsequent logins.',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getSettings,
  updateSettings,
  updateAdminPassword
};
