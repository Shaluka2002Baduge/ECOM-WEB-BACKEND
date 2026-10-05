const db = require('./src/config/db');

async function updateCategories() {
  await db.query(`
    UPDATE categories 
    SET name = 'Crafted Drinks', 
        slug = 'crafted-drinks', 
        description = 'Artisanal juices, handcrafted iced coolers, spiced lassis, and herbal infusions prepared fresh to order.' 
    WHERE id = 6;
  `);

  await db.query(`
    INSERT INTO categories (id, name, slug, description)
    VALUES (7, 'Beverages & Water Bottles', 'beverages-water-bottles', 'Chilled estate mineral water and bottled beverages synced live from our cellars.')
    ON CONFLICT (id) DO UPDATE 
    SET name = EXCLUDED.name, 
        slug = EXCLUDED.slug, 
        description = EXCLUDED.description;
  `);

  const res = await db.query('SELECT * FROM categories ORDER BY id ASC;');
  console.log('Updated categories in DB:', res.rows);
  process.exit(0);
}

updateCategories().catch(err => {
  console.error(err);
  process.exit(1);
});
