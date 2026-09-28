const { pool } = require('../config/db');

async function fullReset() {
  console.log('🔄 [Hard Wipe]: Truncating reservations table CASCADE...');
  await pool.query('TRUNCATE TABLE reservations CASCADE;');

  console.log('🔄 [Order Cleanup]: Deleting Dine-In test payments, order items, and orders...');
  await pool.query("DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE order_type = 'DINE_IN');");
  await pool.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE order_type = 'DINE_IN');");
  await pool.query("DELETE FROM orders WHERE order_type = 'DINE_IN';");

  console.log('🔄 [Table Reset]: Resetting all tables back to AVAILABLE status...');
  await pool.query("UPDATE tables SET status = 'AVAILABLE', is_active = TRUE;");

  const tablesRes = await pool.query('SELECT id, hall_name, table_number, capacity, status FROM tables ORDER BY id ASC;');
  const resCount = await pool.query('SELECT COUNT(*) AS total FROM reservations;');
  const ordersCount = await pool.query("SELECT COUNT(*) AS total FROM orders WHERE order_type = 'DINE_IN';");

  console.log(`✅ [Verification]: Active Dine-In Reservations in DB: ${resCount.rows[0].total}`);
  console.log(`✅ [Verification]: Active Dine-In Orders in DB: ${ordersCount.rows[0].total}`);
  console.log(`✅ [Verification]: Active Tables: ${tablesRes.rowCount}`);
  console.table(tablesRes.rows);

  await pool.end();
}

if (require.main === module) {
  fullReset()
    .then(() => {
      console.log('🎉 Clean slate hard reset completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Reset failed:', err.message);
      process.exit(1);
    });
}

module.exports = { fullReset };
