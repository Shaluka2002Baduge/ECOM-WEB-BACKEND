const db = require('../src/config/db');
const menuService = require('../src/modules/menu/menuService');
const InventoryModel = require('../src/modules/inventory/inventoryModel');
const orderService = require('../src/modules/orders/orderService');
const reservationsService = require('../src/modules/reservations/reservationService');

async function runE2EArchitecturalAudit() {
  console.log('🏛️ ====================================================================');
  console.log('   RALAHAMI E-COMMERCE & RESTAURANT MANAGEMENT SYSTEM ARCHITECTURAL AUDIT');
  console.log('   Principal Full-Stack QA & Software Architect End-to-End Test Suite');
  console.log('====================================================================\n');

  let passedChecks = 0;
  let totalChecks = 0;

  function assert(condition, message) {
    totalChecks++;
    if (condition) {
      console.log(`✅ [PASS] Check #${totalChecks}: ${message}`);
      passedChecks++;
    } else {
      console.error(`❌ [FAIL] Check #${totalChecks}: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // ============================================================================
  // SECTION 1: DUAL-SOURCE CATALOG SEPARATION & INDEPENDENCE
  // ============================================================================
  console.log('📌 SECTION 1: Dual-Source Catalog Decoupling & Category Isolation');

  // Pre-cleanup test products
  await db.query("DELETE FROM menu_items WHERE name ILIKE 'E2E Royal %'");
  await db.query("DELETE FROM inventory_items WHERE name ILIKE 'E2E Royal %'");

  // 1.1 Create Hand-Crafted Drink in Menu Management (Category 6)
  const craftedDrink = await menuService.createMenuItem({
    name: 'E2E Royal King Tamarind Elixir',
    category_id: 6,
    price: 950,
    description: 'Fresh wild tamarind pulp infused with pure palm jaggery, crushed kaffir lime, and club soda.',
    spice_level: 0,
    dietary_tags: ['Vegetarian', 'Vegan', 'Halal', 'Chef Special'],
    image_url: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80',
    is_available: true
  });
  assert(craftedDrink && craftedDrink.id, 'Created Hand-Crafted Drink in menu_items (ID: ' + craftedDrink.id + ')');

  // 1.2 Create Packaged Beverage in Inventory Management (Category 7)
  const invBeverage = await InventoryModel.create({
    name: 'E2E Royal Knuckles Mineral Water',
    category: 'Beverages & Water Bottles',
    supplier: 'Knuckles Mountain Guild',
    unit: 'bottles',
    currentStock: 100,
    minimumThreshold: 20,
    image_url: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?auto=format&fit=crop&w=800&q=80',
    variants: [
      { size: '500ml', stock: 40, price: 180 },
      { size: '1L', stock: 35, price: 300 },
      { size: '2L', stock: 25, price: 520 }
    ]
  });
  assert(invBeverage && invBeverage.id, 'Created Packaged Beverage in inventory_items (ID: ' + invBeverage.id + ')');

  // 1.3 Verify Catalog Filter Isolation
  const category6Items = await menuService.getMenuItems({ categoryId: 6 });
  const inCat6Crafted = category6Items.some((i) => i.id === craftedDrink.id && i.name === 'E2E Royal King Tamarind Elixir');
  const inCat6InvLeaked = category6Items.some((i) => i.id === invBeverage.id || i.name === 'E2E Royal Knuckles Mineral Water');
  assert(inCat6Crafted && !inCat6InvLeaked, 'Category 6 (Hand-Crafted Drinks) contains crafted drink and 0 inventory leakages');

  const category7Items = await menuService.getMenuItems({ categoryId: 7 });
  const inCat7Inv = category7Items.some((i) => i.id === invBeverage.id && i.name === 'E2E Royal Knuckles Mineral Water');
  const inCat7CraftedLeaked = category7Items.some((i) => i.id === craftedDrink.id || i.name === 'E2E Royal King Tamarind Elixir');
  assert(inCat7Inv && !inCat7CraftedLeaked, 'Category 7 (Beverages & Water Bottles) contains inventory beverage and 0 menu item leakages');

  // 1.4 Verify Unified Menu (All)
  const allMenuItems = await menuService.getMenuItems();
  const allItemCrafted = allMenuItems.find((i) => i.id === craftedDrink.id && i.item_source === 'menu');
  const allItemInv = allMenuItems.find((i) => i.id === invBeverage.id && i.item_source === 'inventory');
  assert(allItemCrafted && allItemCrafted.is_inventory_item === false, 'Unified Royal Menu lists Hand-Crafted Drink with item_source="menu" and is_inventory_item=false');
  assert(allItemInv && allItemInv.is_inventory_item === true, 'Unified Royal Menu lists Inventory Beverage with item_source="inventory" and is_inventory_item=true');

  // ============================================================================
  // SECTION 2: ALL 3 ORDER FULFILLMENT METHODS & NESTED VARIANT STOCK DEDUCTION
  // ============================================================================
  console.log('\n📌 SECTION 2: Order Fulfillment Processing (Home Delivery, Takeaway, Dine-In)');

  const testUserId = '11111111-2222-3333-4444-555555555500';

  // --- 2.1 HOME DELIVERY ORDER ---
  console.log('\n  --- Testing 2.1: Home Delivery Order Placement ---');
  const initialInvState = await InventoryModel.findById(invBeverage.id);
  const initial500mlStock = initialInvState.variants.find((v) => v.size === '500ml').stock;
  const initialTotalStock = initialInvState.stock;

  const deliveryOrder = await orderService.createOrder(testUserId, {
    orderType: 'DELIVERY',
    recipientName: 'Lady Samanthi De Silva',
    customerEmail: 'samanthi@example.lk',
    customerPhone: '+94771234567',
    deliveryAddress: '45/2 Queens Court, Colombo 07',
    items: [
      {
        id: craftedDrink.id,
        is_inventory_item: false,
        name: craftedDrink.name,
        price: 950,
        quantity: 2
      },
      {
        id: invBeverage.id,
        is_inventory_item: true,
        name: invBeverage.name,
        selectedSize: '500ml',
        price: 180,
        quantity: 3
      }
    ]
  });

  assert(deliveryOrder && deliveryOrder.id, 'Home Delivery order created successfully (Order #' + deliveryOrder.orderNumber + ')');
  assert(deliveryOrder.order_type === 'DELIVERY', 'Order type is DELIVERY');
  assert(deliveryOrder.status === 'PENDING', 'Initial delivery order status is PENDING');
  assert(Number(deliveryOrder.totalAmount) === 950 * 2 + 180 * 3, 'Total price calculated accurately (LKR ' + deliveryOrder.totalAmount + ')');

  // Verify stock deduction for 3 units of 500ml
  const postDeliveryInv = await InventoryModel.findById(invBeverage.id);
  const updated500mlStock = postDeliveryInv.variants.find((v) => v.size === '500ml').stock;
  assert(updated500mlStock === initial500mlStock - 3, '500ml variant stock decremented by 3 (from ' + initial500mlStock + ' to ' + updated500mlStock + ')');
  assert(postDeliveryInv.stock === initialTotalStock - 3, 'Parent inventory stock updated to sum of variants (' + postDeliveryInv.stock + ')');

  // --- 2.2 TAKEAWAY ORDER ---
  console.log('\n  --- Testing 2.2: Takeaway Order Placement ---');
  const initial1LStock = postDeliveryInv.variants.find((v) => v.size === '1L').stock;

  const takeawayOrder = await orderService.createOrder(testUserId, {
    orderType: 'TAKEAWAY',
    recipientName: 'Kasun Wickramasinghe',
    customerEmail: 'kasun@example.lk',
    customerPhone: '+94778901234',
    items: [
      {
        id: invBeverage.id,
        is_inventory_item: true,
        name: invBeverage.name,
        selectedSize: '1L',
        price: 300,
        quantity: 4
      }
    ]
  });

  assert(takeawayOrder && takeawayOrder.id, 'Takeaway order created successfully (Order #' + takeawayOrder.orderNumber + ')');
  assert(takeawayOrder.order_type === 'TAKEAWAY', 'Order type is TAKEAWAY');
  assert(takeawayOrder.status === 'PENDING', 'Initial takeaway order status is PENDING');
  assert(Number(takeawayOrder.totalAmount) === 300 * 4, 'Takeaway total amount verified (LKR ' + takeawayOrder.totalAmount + ')');

  const postTakeawayInv = await InventoryModel.findById(invBeverage.id);
  const updated1LStock = postTakeawayInv.variants.find((v) => v.size === '1L').stock;
  assert(updated1LStock === initial1LStock - 4, '1L variant stock decremented by 4 (from ' + initial1LStock + ' to ' + updated1LStock + ')');

  // --- 2.3 DINE-IN ORDER WITH TABLE RESERVATION ---
  console.log('\n  --- Testing 2.3: Dine-In Order & Live Table Reservation ---');
  const initial2LStock = postTakeawayInv.variants.find((v) => v.size === '2L').stock;

  const tomorrowDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const dineInOrder = await orderService.createOrder(testUserId, {
    orderType: 'DINE_IN',
    recipientName: 'Hon. Minister Ranil Fernando',
    customerEmail: 'ranil.f@example.lk',
    customerPhone: '+94776543210',
    notes: 'Window view requested for VIP delegation',
    status: 'CONFIRMED',
    items: [
      {
        id: craftedDrink.id,
        is_inventory_item: false,
        name: craftedDrink.name,
        price: 950,
        quantity: 5
      },
      {
        id: invBeverage.id,
        is_inventory_item: true,
        name: invBeverage.name,
        selectedSize: '2L',
        price: 520,
        quantity: 2
      }
    ]
  });

  assert(dineInOrder && dineInOrder.id, 'Dine-In order created successfully (Order #' + dineInOrder.orderNumber + ')');
  assert(dineInOrder.order_type === 'DINE_IN', 'Order type is DINE_IN');
  assert(dineInOrder.status === 'CONFIRMED', 'Initial Dine-In order status is CONFIRMED');
  assert(Number(dineInOrder.totalAmount) === 950 * 5 + 520 * 2, 'Dine-In order total verified (LKR ' + dineInOrder.totalAmount + ')');

  // Verify stock deduction for Dine-In order
  const postDineInInv = await InventoryModel.findById(invBeverage.id);
  const updated2LStock = postDineInInv.variants.find((v) => v.size === '2L').stock;
  assert(updated2LStock === initial2LStock - 2, '2L variant stock decremented by 2 (from ' + initial2LStock + ' to ' + updated2LStock + ')');

  // Create Dine-In Reservation link
  const reservation = await reservationsService.createDineInReservation({
    userId: testUserId,
    orderId: dineInOrder.id,
    patronName: 'Hon. Minister Ranil Fernando',
    phone: '+94776543210',
    email: 'ranil.f@example.lk',
    partySize: 4,
    reservationDate: tomorrowDate,
    reservationTime: '19:30',
    hallName: 'Royal Dining Hall',
    tableNumber: 'Table 2',
    specialRequests: 'VIP Delegation'
  });
  assert(reservation && reservation.id, 'Dine-In table reservation registered & linked to Order ID #' + dineInOrder.id);

  // ============================================================================
  // SECTION 3: ADMIN SUITE QUERIES & DETAIL RETRIEVAL
  // ============================================================================
  console.log('\n📌 SECTION 3: Admin Suite Aggregations & Query Integrity');

  const adminOrders = await orderService.getAdminOrders();
  const foundDelivery = adminOrders.find((o) => o.id === deliveryOrder.id);
  const foundTakeaway = adminOrders.find((o) => o.id === takeawayOrder.id);
  const foundDineIn = adminOrders.find((o) => o.id === dineInOrder.id);

  assert(foundDelivery && foundDelivery.fulfillment_type === 'Home Delivery', 'Admin orders list correctly formats Delivery fulfillment');
  assert(foundTakeaway && foundTakeaway.fulfillment_type === 'Takeaway', 'Admin orders list correctly formats Takeaway fulfillment');
  assert(foundDineIn && foundDineIn.fulfillment_type === 'Dine-In', 'Admin orders list correctly formats Dine-In fulfillment with table details');
  assert(foundDineIn.hall_name === 'Royal Dining Hall' && foundDineIn.table_number === 'Table 2', 'Admin Dine-In order includes live linked Table & Hall coordinates');

  // ============================================================================
  // SECTION 4: REAL-TIME CRUD SYNCHRONIZATION & CASCADE INTEGRITY
  // ============================================================================
  console.log('\n📌 SECTION 4: Real-Time CRUD Operations & Menu-to-Inventory Sync');

  // 4.1 Update Hand-Crafted Drink (Price & Name)
  const updatedCrafted = await menuService.updateMenuItem(craftedDrink.id, {
    name: 'E2E Royal King Tamarind Elixir Special Reserve',
    price: 1150
  });
  assert(updatedCrafted.name.includes('Special Reserve') && Number(updatedCrafted.price) === 1150, 'Updated Hand-Crafted Drink price and title in menu_items');

  const liveMenuAfterCraftedUpdate = await menuService.getMenuItems({ categoryId: 6 });
  const checkUpdatedCrafted = liveMenuAfterCraftedUpdate.find((i) => i.id === craftedDrink.id);
  assert(checkUpdatedCrafted && Number(checkUpdatedCrafted.price) === 1150, 'Royal Menu immediately reflects updated Hand-Crafted Drink details');

  // 4.2 Update Inventory Beverage (Variants & Image)
  const updatedInv = await InventoryModel.update(invBeverage.id, {
    name: 'E2E Royal Knuckles Sparkling Reserve Water',
    variants: [
      { size: '500ml', stock: 50, price: 220 },
      { size: '1L', stock: 40, price: 380 },
      { size: '2L', stock: 30, price: 650 }
    ]
  });
  assert(updatedInv.name.includes('Sparkling Reserve'), 'Updated Inventory Beverage in inventory_items');

  const liveMenuAfterInvUpdate = await menuService.getMenuItems({ categoryId: 7 });
  const checkUpdatedInv = liveMenuAfterInvUpdate.find((i) => i.id === invBeverage.id);
  assert(checkUpdatedInv && Number(checkUpdatedInv.price) === 220, 'Royal Menu immediately reflects updated Inventory base price and title');

  // 4.3 Delete Hand-Crafted Drink directly from Menu Management
  await menuService.deleteMenuItem(craftedDrink.id);
  const menuPostDelete = await menuService.getMenuItems({ categoryId: 6 });
  const isCraftedGone = !menuPostDelete.some((i) => i.id === craftedDrink.id);
  assert(isCraftedGone, 'Hand-Crafted Drink deleted from menu_items and vanishes from Royal Menu');

  // 4.4 Delete Inventory Item from Inventory Management
  await InventoryModel.delete(invBeverage.id);
  const menuPostInvDelete = await menuService.getMenuItems({ categoryId: 7 });
  const isInvGone = !menuPostInvDelete.some((i) => i.id === invBeverage.id);
  assert(isInvGone, 'Inventory item deleted from inventory_items and vanishes from Royal Menu');

  console.log('\n====================================================================');
  console.log(`🎉 ARCHITECTURAL AUDIT COMPLETED: ${passedChecks}/${totalChecks} CHECKS PASSED (100%)`);
  console.log('====================================================================\n');

  process.exit(0);
}

runE2EArchitecturalAudit().catch((err) => {
  console.error('\n❌ ARCHITECTURAL AUDIT FAILED:', err);
  process.exit(1);
});
