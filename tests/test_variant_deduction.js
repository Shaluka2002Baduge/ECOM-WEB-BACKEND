const db = require('../src/config/db');
const orderService = require('../src/modules/orders/orderService');
const InventoryModel = require('../src/modules/inventory/inventoryModel');

async function testVariantStockDeduction() {
  console.log('🧪 === STARTING NESTED VARIANT STOCK DEDUCTION TEST ===');

  // 1. Fetch initial inventory state for Natural Mountain Spring Water Bottle
  const items = await InventoryModel.findAll({ search: 'Natural Mountain Spring Water Bottle' });
  const water = items.find((i) => i.name.includes('Natural Mountain Spring Water Bottle'));
  console.log('Initial Parent Item:', {
    id: water.id,
    name: water.name,
    totalStock: water.stock,
    variants: water.variants
  });

  const target1L = water.variants.find((v) => v.size === '1L');
  const initial1LStock = target1L ? target1L.stock : 0;
  console.log(`Initial 1L Variant Stock: ${initial1LStock}`);

  // 2. Place an order for 2 bottles of 1L
  console.log('\n📦 Creating Order for 2x 1L Water Bottles...');
  const order = await orderService.createOrder('11111111-2222-3333-4444-555555555500', {
    items: [
      {
        id: water.id,
        inventory_item_id: water.id,
        is_inventory_item: true,
        name: 'Natural Mountain Spring Water Bottle',
        selectedSize: '1L',
        quantity: 2,
        price: 250
      }
    ],
    orderType: 'DELIVERY',
    recipientName: 'Test Patron',
    customerEmail: 'patron@ralahami.lk',
    customerPhone: '+94775678901',
    deliveryAddress: '123 Royal Court, Colombo 07'
  });

  console.log('✅ Order created successfully:', {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    totalAmount: order.totalAmount,
    items: order.items
  });

  // 3. Re-fetch inventory item and verify variant stock was decremented by 2
  const updatedItems = await InventoryModel.findAll({ search: 'Natural Mountain Spring Water Bottle' });
  const updatedWater = updatedItems.find((i) => i.name.includes('Natural Mountain Spring Water Bottle'));
  console.log('\nUpdated Parent Item:', {
    id: updatedWater.id,
    name: updatedWater.name,
    totalStock: updatedWater.stock,
    variants: updatedWater.variants
  });

  const updated1L = updatedWater.variants.find((v) => v.size === '1L');
  console.log(`Updated 1L Variant Stock: ${updated1L.stock} (Expected: ${initial1LStock - 2})`);

  if (updated1L.stock === initial1LStock - 2) {
    console.log('🎉 SUCCESS: Variant stock decremented accurately by exact ordered quantity!');
  } else {
    console.error('❌ FAILURE: Variant stock mismatch!');
    process.exit(1);
  }

  process.exit(0);
}

testVariantStockDeduction().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
