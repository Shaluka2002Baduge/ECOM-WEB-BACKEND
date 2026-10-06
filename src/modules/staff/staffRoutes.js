const express = require('express');
const router = express.Router();
const staffController = require('./staffController');
const { verifyToken, requireRole } = require('../../middleware/authAspect');

// All staff endpoints require authentication and MANAGER or ADMIN privilege
router.use(verifyToken);
router.use(requireRole(['ADMIN', 'MANAGER']));

router.get('/', staffController.getStaff);
router.get('/:id', staffController.getStaffById);
router.post('/', staffController.createStaff);
router.patch('/:id', staffController.updateStaff);
router.put('/:id', staffController.updateStaff);
router.patch('/:id/role', staffController.updateRole);
router.delete('/:id', staffController.deleteStaff);

module.exports = router;
