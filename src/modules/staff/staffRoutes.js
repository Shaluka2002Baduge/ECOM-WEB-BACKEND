const express = require('express');
const router = express.Router();
const staffController = require('./staffController');
const { verifyToken, requireRole } = require('../../middleware/authAspect');

// All staff endpoints require authentication and MANAGER or ADMIN privilege
router.use(verifyToken);
router.use(requireRole(['ADMIN', 'MANAGER']));

router.get('/', staffController.getStaff);
router.post('/', staffController.createStaff);
router.patch('/:id/role', staffController.updateRole);

module.exports = router;

