const express = require('express');
const router = express.Router();
const scoreController = require('./scoreController');
const { verifyToken } = require('../../middleware/authAspect');

// Public / open leaderboard endpoint
router.get('/leaderboard', (req, res, next) => scoreController.getLeaderboard(req, res, next));
router.get('/', (req, res, next) => scoreController.getLeaderboard(req, res, next));

// Protected score submission endpoint (JWT required)
router.post('/', verifyToken, (req, res, next) => scoreController.submitScore(req, res, next));

module.exports = router;
