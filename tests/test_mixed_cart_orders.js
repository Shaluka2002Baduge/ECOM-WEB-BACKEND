const db = require('../src/config/db');
const menuService = require('../src/modules/menu/menuService');
const InventoryModel = require('../src/modules/inventory/inventoryModel');
const orderService = require('../src/modules/orders/orderService');

async function testMixedCartOrderStockDeduction() {
  console.log('🧪 === STARTING MIXED CART ORDER PROCESSING & STOCK DECREMENT TEST ===\n');

  // 1. Ensure test data exists:
  // A. Hand-Crafted Food Dish in menu_items
  let craftedItem = await menuService.createMenuItem({
    name: 'E2E Mixed Feast Lamprais',
    category_id: 1,
    price: 1650,
    description: 'Traditional Dutch-Burgher inspired banana leaf parcel with spiced rice and curry.',
    spice_level: 2,
    dietary_tags: ['Halal', 'Chef Special'],
    image_url: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=800&q=80',
    is_available: true
  });
  console.log('✅ Prepared Hand-Crafted Dish:', craftedItem.name, '(ID:', craftedItem.id, ')');

  // B. Packaged Beverage in inventory_items with nested size variants (including 1L)
  let invItem = await InventoryModel.create({
    name: 'E2E Royal Ceylon Vintage Cola',
    category: 'Beverages & Water Bottles',
    supplier: 'Ceylon Beverage Guild',
    unit: 'bottles',
    minimumThreshold: 10,
    image_url: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=800&q=80',
    variants: [
      { size: '500ml', stock: 50, price: 350 },
      { size: '1L', stock: 40, price: 650 },
      { size: '2L', stock: 25, price: 1200 }
    ]
  });
  console.log('✅ Prepared Inventory Beverage:', invItem.name, '(ID:', invItem.id, ')');

  const initialInv = await InventoryModel.findById(invItem.id);
  const initial1LStock = initialInv.variants.find((v) => v.size === '1L').stock;
  const initialTotalStock = initialInv.stock;
  console.log(`📊 Initial State -> 1L Variant Stock: ${initial1LStock}, Total Parent Stock: ${initialTotalStock}\n`);

  // 2. Place a combined Mixed Cart Order (1x Hand-crafted dish + 2x 1L Coca-Cola bottles)
  console.log('🛒 Submitting Mixed Cart Order (1x Hand-Crafted Dish + 2x 1L Bottles)...');
  const testUserId = '11111111-2222-3333-4444-555555555500';

  const order = await orderService.createOrder(testUserId, {
    orderType: 'DELIVERY',
    recipientName: 'High Commissioner Silva',
    customerEmail: 'silva@diplomacy.gov.lk',
    customerPhone: '+94771122334',
    deliveryAddress: '100 Galle Road, Colombo 03',
    items: [
      {
        id: craftedItem.id,
        menuItemId: craftedItem.id,
        is_inventory_item: false,
        name: craftedItem.name,
        price: 1650,
        quantity: 1
      },
      {
        id: invItem.id,
        inventoryItemId: invItem.id,
        is_inventory_item: true,
        name: invItem.name,
        selectedSize: '1L',
        size: '1L',
        price: 650,
        quantity: 2
      }
    ]
  });

  console.log('✅ Mixed Cart Order placed successfully:', {
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderType: order.order_type,
    totalAmount: order.totalAmount,
    itemCount: order.items.length
  });

  // Verify calculation: 1 * 1650 + 2 * 650 = 1650 + 1300 = 2950
  const expectedTotal = 1650 * 1 + 650 * 2;
  if (Number(order.totalAmount) !== expectedTotal) {
    throw new Error(`❌ Price mismatch! Expected ${expectedTotal}, got ${order.totalAmount}`);
  }
  console.log(`✅ Order total verified: LKR ${order.totalAmount}`);

  // 3. Inspect updated database state for the inventory item
  const updatedInv = await InventoryModel.findById(invItem.id);
  const updated1LStock = updatedInv.variants.find((v) => v.size === '1L').stock;
  const updatedTotalStock = updatedInv.stock;

  console.log(`\n📊 Updated State -> 1L Variant Stock: ${updated1LStock} (Expected: ${initial1LStock - 2}), Total Parent Stock: ${updatedTotalStock} (Expected: ${initialTotalStock - 2})`);

  if (updated1LStock !== initial1LStock - 2) {
    throw new Error(`❌ Stock mismatch: 1L variant was not decremented accurately! Expected ${initial1LStock - 2}, got ${updated1LStock}`);
  }
  if (updatedTotalStock !== initialTotalStock - 2) {
    throw new Error(`❌ Parent stock mismatch: Total stock was not recalculated accurately! Expected ${initialTotalStock - 2}, got ${updatedTotalStock}`);
  }

  console.log('🎉 SUCCESS: 1L Variant stock and parent stock accurately decremented by ordered quantity (2 units)!');

  // 4. Verify Admin orders retrieval displays mixed line items properly
  const adminOrders = await orderService.getAdminOrders();
  const foundOrder = adminOrders.find((o) => o.id === order.id);
  if (!foundOrder || foundOrder.items.length !== 2) {
    throw new Error('❌ Order not found or line items missing in Admin Orders view!');
  }
  console.log('✅ Admin Orders view accurately includes all mixed line items:', foundOrder.items.map((i) => i.name));

  // 5. Cleanup test artifacts
  await menuService.deleteMenuItem(craftedItem.id);
  await InventoryModel.delete(invItem.id);
  console.log('\n🧹 Test cleanup completed.');

  console.log('\n🏆 === ALL MIXED CART STOCK DEDUCTION CHECKS PASSED PERFECTLY ===\n');
  process.exit(0);
}

testMixedCartOrderStockDeduction().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
