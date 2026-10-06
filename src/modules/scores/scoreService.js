const { pool } = require('../../config/db');
const { AppError } = require('../../middleware/errorAspect');

/**
 * Score & Leaderboard Service
 * Handles score records, foreign key integrity with users, and secure leaderboard aggregation.
 */
class ScoreService {
  /**
   * Record a new score for an authenticated user
   * @param {Object} params
   * @param {string} params.userId - UUID of authenticated user
   * @param {number} params.score - Non-negative integer score
   * @param {string} [params.gameMode='STANDARD']
   * @param {Object} [params.metadata={}]
   */
  async recordScore({ userId, score, gameMode = 'STANDARD', metadata = {} }) {
    if (!userId) {
      throw new AppError('User ID is required to record score', 400);
    }

    const numScore = Number(score);
    if (isNaN(numScore) || !Number.isInteger(numScore) || numScore < 0) {
      throw new AppError('Score must be a non-negative integer', 400);
    }

    const query = `
      INSERT INTO scores (user_id, score, game_mode, metadata)
      VALUES ($1, $2, $3, $4)
      RETURNING id, user_id, score, game_mode, metadata, created_at, updated_at
    `;

    const result = await pool.query(query, [
      userId,
      numScore,
      gameMode || 'STANDARD',
      JSON.stringify(metadata || {})
    ]);

    return result.rows[0];
  }

  /**
   * Fetch leaderboard ordered strictly by highest score first (DESC)
   * Ensures zero exposure of password hashes or sensitive internal credentials.
   * @param {Object} [options]
   * @param {number} [options.limit=10]
   * @param {number} [options.offset=0]
   */
  async getLeaderboard({ limit = 10, offset = 0 } = {}) {
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const query = `
      SELECT 
        s.id,
        s.user_id,
        s.score,
        s.game_mode,
        s.created_at,
        u.display_name,
        u.email,
        u.role
      FROM scores s
      JOIN users u ON s.user_id = u.id
      ORDER BY s.score DESC, s.created_at ASC
      LIMIT $1 OFFSET $2
    `;

    const result = await pool.query(query, [parsedLimit, parsedOffset]);
    return result.rows;
  }
}

module.exports = new ScoreService();
