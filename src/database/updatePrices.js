const { pool } = require('../config/db');

async function updatePrices() {
  const queries = [
    "UPDATE menu_items SET price = 1550.00 WHERE name ILIKE '%Cheese%Kottu%';",
    "UPDATE menu_items SET price = 650.00 WHERE name ILIKE '%Cutlet%';",
    "UPDATE menu_items SET price = 550.00 WHERE name ILIKE '%Samosa%';",
    "UPDATE menu_items SET price = 1650.00 WHERE name ILIKE '%Chicken Curry%';",
    "UPDATE menu_items SET price = 850.00 WHERE name ILIKE '%Dhal%';",
    "UPDATE menu_items SET price = 3800.00 WHERE name ILIKE '%Crab%';",
    "UPDATE menu_items SET price = 1850.00 WHERE name ILIKE '%Lamprais%';",
    "UPDATE menu_items SET price = 2200.00 WHERE name ILIKE '%Pork%';",
    "UPDATE menu_items SET price = price * 100 WHERE price < 100;"
  ];

  console.log('🔄 Applying menu item price updates...');
  for (const q of queries) {
    const res = await pool.query(q);
    console.log(`Executed: ${q.trim()} -> Updated: ${res.rowCount}`);
  }

  const all = await pool.query('SELECT id, name, price FROM menu_items ORDER BY id;');
  console.log('\n📋 Current menu_items in PostgreSQL:');
  console.table(all.rows);

  await pool.end();
  console.log('\n✅ Menu item prices updated successfully.');
}

updatePrices().catch((err) => {
  console.error('❌ Error updating prices:', err);
  process.exit(1);
});
