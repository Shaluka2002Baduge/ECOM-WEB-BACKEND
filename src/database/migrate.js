const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

/**
 * Verifies table existence and automatically applies schema.sql and seeds.sql
 * in an idempotent, safe manner before Express starts listening.
 * @param {Object} options
 * @param {boolean} options.force - If true, force execute schema and seeds regardless of table existence
 * @returns {Promise<{ migrated: boolean, seeded: boolean }>}
 */
const runAutoMigration = async (options = {}) => {
  const { force = false } = options;

  console.log('[AutoMigration]: Checking PostgreSQL database table status...');

  // 1. Check if core tables exist in the public schema
  const tableCheckQuery = `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'users'
    ) AS tables_exist;
  `;

  const checkResult = await pool.query(tableCheckQuery);
  const tablesExist = checkResult.rows[0]?.tables_exist;

  if (tablesExist && !force) {
    console.log('✅ [AutoMigration]: Database tables already present. Skipping automatic schema setup.');
    return { migrated: false, seeded: false };
  }

  console.log('🔄 [AutoMigration]: Core tables not detected or force mode active. Initiating schema migration...');

  // 2. Read and apply schema.sql
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  await pool.query(schemaSql);
  console.log('✅ [AutoMigration]: schema.sql executed successfully.');

  // 3. Read and apply seeds.sql
  const seedsPath = path.join(__dirname, 'seeds.sql');
  const seedsSql = fs.readFileSync(seedsPath, 'utf8');

  await pool.query(seedsSql);
  console.log('🌱 [AutoMigration]: seeds.sql executed successfully. Baseline data loaded.');

  return { migrated: true, seeded: true };
};

// Enable standalone CLI execution (e.g. "node src/database/migrate.js" or "--force")
if (require.main === module) {
  const isForce = process.argv.includes('--force');
  runAutoMigration({ force: isForce })
    .then(() => {
      console.log('🎉 Migration completed.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = {
  runAutoMigration,
};
