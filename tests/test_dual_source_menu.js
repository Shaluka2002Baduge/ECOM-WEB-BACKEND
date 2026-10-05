const menuService = require('../src/modules/menu/menuService');
const InventoryModel = require('../src/modules/inventory/inventoryModel');
const db = require('../src/config/db');

async function testDualSourceMenu() {
  console.log('🧪 === STARTING DUAL-SOURCE DECOUPLED MENU TEST ===\n');

  // Pre-cleanup test items
  await db.query("DELETE FROM menu_items WHERE name IN ('Ceylon Royal Passion Fruit Mojito')");
  await db.query("DELETE FROM inventory_items WHERE name IN ('Knuckles Mountain Sparkling Soda')");

  // 1. VERIFY DUAL-SOURCE CATEGORIES
  console.log('1️⃣ Step 1: Checking categories for distinct Hand-Crafted & Inventory categories...');
  const categories = await menuService.getCategories();
  const handCraftedCat = categories.find(c => c.name === 'Crafted Drinks' || c.slug === 'crafted-drinks' || c.name === 'Hand Crafted Drinks' || c.name === 'Craft Beverages');
  const inventoryCat = categories.find(c => c.name === 'Beverages & Water Bottles' || c.slug === 'beverages-water-bottles');

  if (!handCraftedCat) {
    throw new Error('❌ FAILURE: Crafted Drinks category not found in categories list!');
  }
  if (!inventoryCat) {
    throw new Error('❌ FAILURE: Beverages & Water Bottles category not found in categories list!');
  }

  console.log('✅ Found Category 6 (Hand-Crafted):', handCraftedCat.name, '| Slug:', handCraftedCat.slug);
  console.log('✅ Found Category 7 (Inventory):', inventoryCat.name, '| Slug:', inventoryCat.slug);

  // 2. CREATE HAND-CRAFTED DRINK VIA MENU SERVICE
  console.log('\n2️⃣ Step 2: Creating Hand-Crafted Drink ("Ceylon Royal Passion Fruit Mojito")...');
  const handCraftedDrink = await menuService.createMenuItem({
    name: 'Ceylon Royal Passion Fruit Mojito',
    category_id: 6,
    price: 850,
    description: 'Fresh passion fruit pulp muddled with garden mint, lime juice, sparkling water, and kitul treacle.',
    spice_level: 0,
    dietary_tags: ['Vegetarian', 'Vegan', 'Halal', 'Chef Special'],
    image_url: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80',
    is_available: true
  });
  console.log('✅ Created Hand-Crafted Drink ID:', handCraftedDrink.id, 'Name:', handCraftedDrink.name);

  // 3. CREATE INVENTORY BEVERAGE VIA INVENTORY MODEL
  console.log('\n3️⃣ Step 3: Registering Inventory Beverage ("Knuckles Mountain Sparkling Soda")...');
  const invBeverage = await InventoryModel.create({
    name: 'Knuckles Mountain Sparkling Soda',
    category: 'Beverages & Water Bottles',
    supplier: 'Knuckles Mountain Estate',
    unit: 'bottles',
    currentStock: 60,
    minimumThreshold: 10,
    image_url: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=800&q=80',
    variants: [
      { size: '500ml', stock: 40, price: 250 },
      { size: '1L', stock: 20, price: 450 }
    ]
  });
  console.log('✅ Created Inventory Item ID:', invBeverage.id, 'Name:', invBeverage.name);

  // 4. VERIFY STRICT DUAL-SOURCE ISOLATION IN GETMENUITEMS
  console.log('\n4️⃣ Step 4: Testing filtered category fetching to verify zero cross-pollution...');
  
  // A. Fetch only Hand-Crafted Drinks (Category 6)
  const handCraftedList = await menuService.getMenuItems({ categoryId: 6 });
  const inHandCrafted1 = handCraftedList.some(item => item.name === 'Ceylon Royal Passion Fruit Mojito');
  const inHandCrafted2 = handCraftedList.some(item => item.name === 'Knuckles Mountain Sparkling Soda');

  if (!inHandCrafted1) {
    throw new Error('❌ FAILURE: "Ceylon Royal Passion Fruit Mojito" not found in Hand-Crafted Drinks category!');
  }
  if (inHandCrafted2) {
    throw new Error('❌ FAILURE: Inventory item leaked into Hand-Crafted Drinks category!');
  }
  console.log('✅ Hand-Crafted Drinks category (6) contains strictly hand-crafted drinks. Total count:', handCraftedList.length);

  // B. Fetch only Inventory Beverages & Water Bottles (Category 7)
  const inventoryList = await menuService.getMenuItems({ categoryId: 7 });
  const inInventory1 = inventoryList.some(item => item.name === 'Knuckles Mountain Sparkling Soda');
  const inInventory2 = inventoryList.some(item => item.name === 'Ceylon Royal Passion Fruit Mojito');

  if (!inInventory1) {
    throw new Error('❌ FAILURE: "Knuckles Mountain Sparkling Soda" not found in Beverages & Water Bottles category!');
  }
  if (inInventory2) {
    throw new Error('❌ FAILURE: Hand-crafted drink leaked into Beverages & Water Bottles category!');
  }
  console.log('✅ Beverages & Water Bottles category (7) contains strictly inventory items. Total count:', inventoryList.length);

  // C. Fetch All menu items
  const allList = await menuService.getMenuItems();
  const allHasCrafted = allList.some(item => item.name === 'Ceylon Royal Passion Fruit Mojito' && item.is_inventory_item === false);
  const allHasInv = allList.some(item => item.name === 'Knuckles Mountain Sparkling Soda' && item.is_inventory_item === true);

  if (!allHasCrafted || !allHasInv) {
    throw new Error('❌ FAILURE: All view did not correctly assemble both sources with proper metadata!');
  }
  console.log('✅ "All" menu view cleanly unites both sources side-by-side. Total items:', allList.length);

  // 5. INDEPENDENT DELETION CHECKS
  console.log('\n5️⃣ Step 5: Testing independent deletions...');
  // Delete hand-crafted drink
  await menuService.deleteMenuItem(handCraftedDrink.id);
  console.log('✅ Deleted Hand-Crafted Drink ID:', handCraftedDrink.id);

  // Verify inventory item is intact
  const invCheck = await menuService.getMenuItems({ categoryId: 7 });
  const invStillExists = invCheck.some(item => item.name === 'Knuckles Mountain Sparkling Soda');
  if (!invStillExists) {
    throw new Error('❌ FAILURE: Deleting hand-crafted drink inadvertently affected inventory item!');
  }
  console.log('✅ Inventory item preserved completely after hand-crafted deletion.');

  // Delete inventory item
  await InventoryModel.delete(invBeverage.id);
  console.log('✅ Deleted Inventory Item ID:', invBeverage.id);

  console.log('\n🏆 === DUAL-SOURCE ROYAL MENU ARCHITECTURE VERIFIED 100% ===\n');
  process.exit(0);
}

testDualSourceMenu().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
