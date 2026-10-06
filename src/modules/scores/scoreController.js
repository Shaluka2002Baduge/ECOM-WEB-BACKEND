const scoreService = require('./scoreService');
const { AppError } = require('../../middleware/errorAspect');

/**
 * Score Controller
 * Exposes endpoints for recording scores and fetching leaderboard data.
 */
class ScoreController {
  /**
   * POST /api/scores
   * Secure endpoint requiring JWT. Links score to authenticated user.
   */
  async submitScore(req, res, next) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return next(new AppError('Unauthorized: User ID missing from session', 401));
      }

      const { score, gameMode, metadata } = req.body;

      if (
        score === undefined ||
        score === null ||
        typeof score === 'boolean' ||
        isNaN(Number(score)) ||
        !Number.isInteger(Number(score)) ||
        Number(score) < 0
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid score payload. Score must be a valid non-negative integer (>= 0).'
        });
      }

      const scoreRecord = await scoreService.recordScore({
        userId,
        score: Number(score),
        gameMode,
        metadata
      });

      return res.status(201).json({
        success: true,
        message: 'Score successfully recorded',
        data: scoreRecord
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/scores/leaderboard
   * Returns sorted leaderboard (highest score first) without sensitive user fields.
   */
  async getLeaderboard(req, res, next) {
    try {
      const { limit, offset } = req.query;
      const leaderboard = await scoreService.getLeaderboard({ limit, offset });

      return res.status(200).json({
        success: true,
        count: leaderboard.length,
        data: leaderboard
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ScoreController();
