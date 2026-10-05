const InventoryModel = require('../src/modules/inventory/inventoryModel');
const menuService = require('../src/modules/menu/menuService');
const db = require('../src/config/db');

async function testRealtimeSync() {
  console.log('🧪 === STARTING REAL-TIME ADMIN-TO-MENU SYNC TEST ===\n');

  // Pre-cleanup test items
  await db.query("DELETE FROM inventory_items WHERE name IN ('Cocacola Zero Sugar', 'Cocacola Classic')");

  // 1. ADD NEW BEVERAGE IN INVENTORY
  console.log('1️⃣ Step 1: Admin registers new beverage "Cocacola Zero Sugar" in Inventory...');
  const newBeverage = await InventoryModel.create({
    name: 'Cocacola Zero Sugar',
    category: 'Beverages & Water Bottles',
    supplier: 'Ceylon Beverage Guild',
    unit: 'bottles',
    currentStock: 50,
    minimumThreshold: 10,
    image_url: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=800&q=80',
    variants: [
      { size: '500ml', stock: 30, price: 350 },
      { size: '1L', stock: 20, price: 600 }
    ]
  });

  console.log('✅ Created Inventory Item ID:', newBeverage.id, 'Name:', newBeverage.name);

  // Check Royal Menu output
  let menu = await menuService.getMenuItems();
  let foundOnMenu = menu.find((item) => item.name === 'Cocacola Zero Sugar');
  if (!foundOnMenu) {
    throw new Error('❌ FAILURE: Newly added beverage not found on Royal Menu!');
  }
  console.log('🎉 Royal Menu verified: "Cocacola Zero Sugar" dynamically appeared on Menu! Details:', {
    id: foundOnMenu.id,
    name: foundOnMenu.name,
    category: foundOnMenu.category_name,
    price: foundOnMenu.price,
    variants: foundOnMenu.variants
  });

  // 2. UPDATE BEVERAGE (NAME, PRICE, VARIANTS, IMAGE)
  console.log('\n2️⃣ Step 2: Admin updates product name to "Cocacola Classic", adjusts price to 400 & 700, and updates image...');
  const updatedBeverage = await InventoryModel.update(newBeverage.id, {
    name: 'Cocacola Classic',
    image_url: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=800&q=80',
    variants: [
      { size: '500ml', stock: 30, price: 400 },
      { size: '1L', stock: 20, price: 700 }
    ]
  });

  console.log('✅ Updated Inventory Item:', updatedBeverage.name);

  // Check Royal Menu output
  menu = await menuService.getMenuItems();
  const oldItemCheck = menu.find((item) => item.name === 'Cocacola Zero Sugar');
  const updatedItemCheck = menu.find((item) => item.name === 'Cocacola Classic');

  if (oldItemCheck) {
    throw new Error('❌ FAILURE: Stale product name still found on Royal Menu!');
  }
  if (!updatedItemCheck) {
    throw new Error('❌ FAILURE: Updated product name "Cocacola Classic" not found on Royal Menu!');
  }
  if (Number(updatedItemCheck.price) !== 400) {
    throw new Error(`❌ FAILURE: Price not updated! Expected 400, got ${updatedItemCheck.price}`);
  }

  console.log('🎉 Royal Menu verified: "Cocacola Classic" dynamically updated with price Rs.', updatedItemCheck.price, 'and image:', updatedItemCheck.image_url);

  // 3. DELETE BEVERAGE IN INVENTORY
  console.log('\n3️⃣ Step 3: Admin deletes "Cocacola Classic" from Inventory...');
  await InventoryModel.delete(newBeverage.id);
  console.log('✅ Deleted Inventory Item ID:', newBeverage.id);

  // Check Royal Menu output
  menu = await menuService.getMenuItems();
  const deletedCheck = menu.find((item) => item.name === 'Cocacola Classic' || item.name === 'Cocacola Zero Sugar' || item.id === newBeverage.id);

  if (deletedCheck) {
    throw new Error('❌ FAILURE: Deleted product still appeared on Royal Menu!');
  }

  console.log('🎉 Royal Menu verified: Product was instantly removed and vanished from Menu!');
  console.log('\n🏆 === ALL REAL-TIME SYNC CHECKS PASSED PERFECTLY ===\n');
  process.exit(0);
}

testRealtimeSync().catch((err) => {
  console.error(err);
  process.exit(1);
});
