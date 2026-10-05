const menuService = require('../src/modules/menu/menuService');
const InventoryModel = require('../src/modules/inventory/inventoryModel');
const db = require('../src/config/db');

async function testMenuIntegration() {
  console.log('🧪 === STARTING COMPREHENSIVE MENU & INVENTORY INTEGRATION TEST ===\n');

  // Pre-cleanup test items
  await db.query("DELETE FROM menu_items WHERE name IN ('Royal Ceylon Saffron Rice', 'Royal Ceylon Emerald Biryani')");
  await db.query("DELETE FROM inventory_items WHERE name IN ('King Coconut Fresh Reserve')");

  // 1. ADD NEW INVENTORY ITEM
  console.log('1️⃣ Step 1: Create an Inventory-synced product...');
  const invItem = await InventoryModel.create({
    name: 'King Coconut Fresh Reserve',
    category: 'Beverages & Water Bottles',
    supplier: 'Royal Palm Grove',
    unit: 'bottles',
    currentStock: 45,
    minimumThreshold: 5,
    image_url: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?auto=format&fit=crop&w=800&q=80',
    variants: [{ size: '500ml', stock: 45, price: 320 }]
  });
  console.log('✅ Created Inventory Item ID:', invItem.id);

  // 2. CREATE HAND-CRAFTED DISH VIA MENU SERVICE
  console.log('\n2️⃣ Step 2: Create a Hand-Crafted Dish via Menu Service ("Royal Ceylon Saffron Rice")...');
  const craftedDish = await menuService.createMenuItem({
    name: 'Royal Ceylon Saffron Rice',
    category_id: 1,
    price: 1850,
    description: 'Fragrant basmati rice infused with pure Persian saffron, cardamom, and roasted cashews.',
    spice_level: 1,
    dietary_tags: ['Vegetarian', 'Gluten-Free', 'Halal'],
    image_url: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=800&q=80',
    is_available: true
  });
  console.log('✅ Created Hand-Crafted Dish ID:', craftedDish.id, 'Name:', craftedDish.name);

  // 3. VERIFY UNIFIED MENU WITH METADATA TAGS
  console.log('\n3️⃣ Step 3: Fetching unified menu items and verifying role & source distinctions...');
  const menuItems = await menuService.getMenuItems();
  
  const foundCrafted = menuItems.find(item => item.name === 'Royal Ceylon Saffron Rice');
  const foundInventory = menuItems.find(item => item.name === 'King Coconut Fresh Reserve');

  if (!foundCrafted) {
    throw new Error('❌ FAILURE: Hand-crafted dish not found on menu!');
  }
  if (!foundInventory) {
    throw new Error('❌ FAILURE: Inventory-synced item not found on menu!');
  }

  console.log('✅ Hand-Crafted Dish Metadata:', {
    id: foundCrafted.id,
    name: foundCrafted.name,
    item_source: foundCrafted.item_source,
    is_inventory_item: foundCrafted.is_inventory_item
  });
  console.log('✅ Inventory Item Metadata:', {
    id: foundInventory.id,
    name: foundInventory.name,
    item_source: foundInventory.item_source,
    is_inventory_item: foundInventory.is_inventory_item
  });

  if (foundCrafted.is_inventory_item !== false || foundCrafted.item_source !== 'menu') {
    throw new Error('❌ FAILURE: Hand-crafted dish incorrectly flagged as inventory item!');
  }
  if (foundInventory.is_inventory_item !== true || foundInventory.item_source !== 'inventory') {
    throw new Error('❌ FAILURE: Inventory item not correctly flagged with inventory source metadata!');
  }

  // 4. ATTEMPT TO DELETE INVENTORY ITEM VIA MENU SERVICE (SHOULD BE REJECTED)
  console.log('\n4️⃣ Step 4: Attempting to delete inventory item via menu endpoint (Should be blocked)...');
  let deleteBlocked = false;
  try {
    await menuService.deleteMenuItem(invItem.id);
  } catch (err) {
    deleteBlocked = true;
    console.log('🛡️ Expected Protection Triggered:', err.message);
  }
  if (!deleteBlocked) {
    throw new Error('❌ FAILURE: Inventory item was not protected against deletion from Menu endpoint!');
  }

  // 5. UPDATE HAND-CRAFTED DISH
  console.log('\n5️⃣ Step 5: Updating Hand-Crafted Dish ("Royal Ceylon Emerald Biryani", price 2200)...');
  const updatedDish = await menuService.updateMenuItem(craftedDish.id, {
    name: 'Royal Ceylon Emerald Biryani',
    price: 2200,
    description: 'Slow-cooked aromatic basmati rice with minted herbs, caramelized shallots, and whole spices.'
  });
  console.log('✅ Updated Dish Name:', updatedDish.name, 'Price:', updatedDish.price);

  const updatedMenu = await menuService.getMenuItems();
  const foundUpdated = updatedMenu.find(item => item.id === craftedDish.id);
  if (!foundUpdated || foundUpdated.name !== 'Royal Ceylon Emerald Biryani' || Number(foundUpdated.price) !== 2200) {
    throw new Error('❌ FAILURE: Updated dish details did not synchronize immediately to the menu!');
  }
  console.log('🎉 Menu Verified: Updated details instantly reflected on Royal Menu!');

  // 6. DELETE HAND-CRAFTED DISH DIRECTLY
  console.log('\n6️⃣ Step 6: Deleting Hand-Crafted Dish from Menu Management...');
  await menuService.deleteMenuItem(craftedDish.id);
  console.log('✅ Hand-Crafted Dish Deleted Successfully ID:', craftedDish.id);

  const menuAfterDelete = await menuService.getMenuItems();
  const deletedCheck = menuAfterDelete.find(item => item.id === craftedDish.id || item.name === 'Royal Ceylon Emerald Biryani');
  if (deletedCheck) {
    throw new Error('❌ FAILURE: Deleted dish still found in menu list!');
  }
  console.log('🎉 Menu Verified: Hand-crafted dish instantly vanished from Royal Menu!');

  // Cleanup inventory item
  await InventoryModel.delete(invItem.id);

  console.log('\n🏆 === ALL MENU INTEGRATION & PERMISSION CHECKS PASSED PERFECTLY ===\n');
  process.exit(0);
}

testMenuIntegration().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
