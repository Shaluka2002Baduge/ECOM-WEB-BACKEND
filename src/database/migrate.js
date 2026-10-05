const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

/**
 * Ensures explicit test accounts exist in the database with valid hashed passwords
 * Aligned with CIS007-3 / CIS045-3 specifications:
 *  - Admin: admin@ralahami.lk (Role: ADMIN)
 *  - Kitchen: kitchen@ralahami.lk (Role: KITCHEN_STAFF)
 *  - Customer: patron@ralahami.lk (Role: CUSTOMER)
 */
const ensureDefaultCredentials = async () => {
  console.log('[AutoMigration]: Ensuring explicit RBAC test accounts with bcrypt hashed passwords...');

  const defaultAccounts = [
    {
      id: '11111111-2222-3333-4444-555555555501',
      displayName: 'System Administrator',
      email: 'admin@ralahami.lk',
      password: 'Password123!',
      role: 'ADMIN',
      phone: '+94771234567',
    },
    {
      id: '11111111-2222-3333-4444-555555555502',
      displayName: 'Kitchen Head Chef',
      email: 'kitchen@ralahami.lk',
      password: 'Password123!',
      role: 'MANAGER',
      phone: '+94773456789',
    },
    {
      id: '11111111-2222-3333-4444-555555555500',
      displayName: 'User Customer',
      email: 'user@ralahami.lk',
      password: 'Password123!',
      role: 'CUSTOMER',
      phone: '+94775678901',
    },
    {
      id: '11111111-2222-3333-4444-555555555503',
      displayName: 'Patron Customer',
      email: 'patron@ralahami.lk',
      password: 'Password123!',
      role: 'CUSTOMER',
      phone: '+94775678901',
    },
    {
      id: '11111111-2222-3333-4444-555555555504',
      displayName: 'Operations Manager',
      email: 'manager@ralahami.lk',
      password: 'Password123!',
      role: 'MANAGER',
      phone: '+94772345678',
    },
  ];

  for (const account of defaultAccounts) {
    const passwordHash = await bcrypt.hash(account.password, 10);
    await pool.query(
      `INSERT INTO users (id, display_name, email, password_hash, role, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         phone = EXCLUDED.phone;`,
      [account.id, account.displayName, account.email.toLowerCase(), passwordHash, account.role, account.phone]
    );
  }

  // Also apply seeds.sql to update any existing baseline accounts
  const seedsPath = path.join(__dirname, 'seeds.sql');
  if (fs.existsSync(seedsPath)) {
    const seedsSql = fs.readFileSync(seedsPath, 'utf8');
    await pool.query(seedsSql);
  }

  console.log('✅ [AutoMigration]: Default test accounts verified & seeded successfully.');
};

/**
 * Seed & Synchronize Beverage and Water Bottle Size Variants into both
 * inventory_items (for stock tracking) and menu_items (for Royal Menu display)
 */
const seedBeverageVariants = async () => {
  console.log('[AutoMigration]: Seeding & synchronizing Beverage and Water Bottle size variants...');

  // 1. Ensure Category 6 (Craft Beverages) exists
  await pool.query(`
    INSERT INTO categories (id, name, slug, description)
    VALUES (6, 'Craft Beverages', 'craft-beverages', 'Fresh island coolers, natural spring water bottles, and spiced Ceylon drinks.')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug;
  `);

  // 2. Clean up unwanted beverage items so Admin Inventory only contains Natural Mountain Spring Water Bottle and Cocacola
  await pool.query(`
    DELETE FROM inventory_items 
    WHERE name ILIKE '%(500ml)%' 
       OR name ILIKE '%(1L)%' 
       OR name ILIKE '%(1.5L)%' 
       OR name ILIKE '%(2L)%'
       OR (category = 'Beverages & Water Bottles' AND LOWER(name) NOT IN ('natural mountain spring water bottle', 'natural spring water bottles (750ml)', 'cocacola'));
  `);

  // 3. Seed / Update Parent Inventory Items with Nested Size Variants
  const parentInventoryItems = [
    {
      name: 'Natural Mountain Spring Water Bottle',
      category: 'Beverages & Water Bottles',
      supplier: 'Knuckles Mountain Springs',
      unit: 'bottles',
      minimum_threshold: 30,
      image_url: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?auto=format&fit=crop&w=800&q=80',
      variants: [
        { size: '500ml', stock: 50, price: 150 },
        { size: '1L', stock: 40, price: 250 },
        { size: '1.5L', stock: 30, price: 350 },
        { size: '2L', stock: 20, price: 450 }
      ]
    },
    {
      name: 'Cocacola',
      category: 'Beverages & Water Bottles',
      supplier: 'Ceylon Craft Brews',
      unit: 'bottles',
      minimum_threshold: 20,
      image_url: '/uploads/inv-1790845264830-169188868.jpeg',
      variants: [
        { size: '500ml', stock: 40, price: 350 },
        { size: '1L', stock: 30, price: 650 },
        { size: '1.5L', stock: 20, price: 950 },
        { size: '2L', stock: 15, price: 1250 }
      ]
    },

    // Standard raw materials image enrichments
    {
      name: 'Boneless Chicken Breast',
      category: 'Meat & Poultry',
      supplier: 'Central Highlands Farm',
      unit: 'kg',
      current_stock: 45,
      minimum_threshold: 10,
      image_url: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=800&q=80',
      variants: []
    },
    {
      name: 'Lagoon Mud Crab',
      category: 'Seafood',
      supplier: 'Negombo Coastal Co-op',
      unit: 'kg',
      current_stock: 20,
      minimum_threshold: 5,
      image_url: 'https://images.unsplash.com/photo-1559847844-5315695dadae?auto=format&fit=crop&w=800&q=80',
      variants: []
    },
    {
      name: 'Thick Coconut Milk',
      category: 'Coconuts & Produce',
      supplier: 'Kurunegala Coconut Triangle',
      unit: 'liters',
      current_stock: 50,
      minimum_threshold: 12,
      image_url: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=800&q=80',
      variants: []
    },
    {
      name: 'Red Split Lentils',
      category: 'Grains & Rice',
      supplier: 'Polonnaruwa Mills',
      unit: 'kg',
      current_stock: 35,
      minimum_threshold: 8,
      image_url: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=800&q=80',
      variants: []
    },
    {
      name: 'Kitul Palm Jaggery',
      category: 'Sweeteners & Treacle',
      supplier: 'Sinharaja Rainforest Guild',
      unit: 'kg',
      current_stock: 12,
      minimum_threshold: 3,
      image_url: 'https://images.unsplash.com/photo-1587314168485-3236d6710814?auto=format&fit=crop&w=800&q=80',
      variants: []
    }
  ];

  for (const inv of parentInventoryItems) {
    const totalStock = inv.variants && inv.variants.length > 0
      ? inv.variants.reduce((sum, v) => sum + (parseFloat(v.stock) || 0), 0)
      : (inv.current_stock || 0);

    const existing = await pool.query('SELECT id, image_url, variants FROM inventory_items WHERE LOWER(name) = LOWER($1)', [inv.name]);
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO inventory_items (name, category, supplier, unit, current_stock, minimum_threshold, image_url, variants)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          inv.name,
          inv.category,
          inv.supplier,
          inv.unit,
          totalStock,
          inv.minimum_threshold,
          inv.image_url,
          JSON.stringify(inv.variants || [])
        ]
      );
    } else {
      await pool.query(
        `UPDATE inventory_items 
         SET image_url = COALESCE(image_url, $1), 
             category = $2, 
             supplier = $3, 
             variants = $4,
             current_stock = $5
         WHERE id = $6`,
        [
          inv.image_url,
          inv.category,
          inv.supplier,
          JSON.stringify(inv.variants || []),
          totalStock,
          existing.rows[0].id
        ]
      );
    }
  }

  // 3. Ensure Hand-Crafted Menu Items have clean single prices and no size variant arrays
  await pool.query("UPDATE menu_items SET variants = '[]'::jsonb WHERE variants IS NOT NULL AND variants != '[]'::jsonb;");

  console.log('✅ [AutoMigration]: Beverage and Water Bottle size variants seeded successfully.');
};

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
    console.log('✅ [AutoMigration]: Database tables already present.');
    try {
      await pool.query(`
        DO $$ BEGIN
          ALTER TYPE reservation_status ADD VALUE IF NOT EXISTS 'COMPLETED';
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;

        ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp VARCHAR(10);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_expires_at TIMESTAMPTZ;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number VARCHAR(100);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(150);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(50);
        ALTER TABLE orders ALTER COLUMN status TYPE VARCHAR(50);
        ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS spice_level VARCHAR(50);
        ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS dietary_tags TEXT[];
        ALTER TABLE menu_items ALTER COLUMN image_alt_text DROP NOT NULL;
        
        ALTER TABLE tables ADD COLUMN IF NOT EXISTS hall_name VARCHAR(100) DEFAULT 'Royal Dining Hall';
        ALTER TABLE tables ADD COLUMN IF NOT EXISTS capacity INT DEFAULT 4;
        ALTER TABLE tables ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE';
        ALTER TABLE tables DROP CONSTRAINT IF EXISTS tables_table_number_key;
        
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS hall_name VARCHAR(100);
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS table_number VARCHAR(50);
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reservation_date DATE;
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS patron_name VARCHAR(150);
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS email VARCHAR(150);
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS order_id INT REFERENCES orders(id) ON DELETE SET NULL;
        ALTER TABLE reservations ADD COLUMN IF NOT EXISTS booking_source VARCHAR(100) DEFAULT 'Online / App';
        ALTER TABLE reservations ALTER COLUMN table_id DROP NOT NULL;
        ALTER TABLE reservations ALTER COLUMN status TYPE VARCHAR(50);

        ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'Grains';
        ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS supplier VARCHAR(150) DEFAULT 'Local Supplier';
        ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS image_url TEXT;
        ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE order_items ALTER COLUMN menu_item_id DROP NOT NULL;
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS inventory_item_id INT REFERENCES inventory_items(id) ON DELETE SET NULL;
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_name VARCHAR(255);
      `);

      // Seed / Update Beverage and Water Bottle Size Variants (500ml, 1L, 1.5L, 2L)
      await seedBeverageVariants();
    } catch (colErr) {
      console.warn(`[AutoMigration]: Optional column check notice: ${colErr.message}`);
    }
    await ensureDefaultCredentials();
    return { migrated: false, seeded: true };
  }

  console.log('🔄 [AutoMigration]: Core tables not detected or force mode active. Initiating schema migration...');

  // 2. Read and apply schema.sql
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  await pool.query(schemaSql);
  console.log('✅ [AutoMigration]: schema.sql executed successfully.');

  // 3. Read and apply seeds.sql & ensure default credentials
  await ensureDefaultCredentials();
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
  ensureDefaultCredentials,
};

