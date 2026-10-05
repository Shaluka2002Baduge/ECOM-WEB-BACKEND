const http = require('http');
const jwt = require('jsonwebtoken');
const db = require('../src/config/db');
const orderService = require('../src/modules/orders/orderService');
const inventoryService = require('../src/modules/inventory/inventoryService');
const reservationService = require('../src/modules/reservations/reservationService');
const InventoryModel = require('../src/modules/inventory/inventoryModel');

const secret = process.env.JWT_SECRET || 'ralahami_super_secret_jwt_key_2026_change_in_production';
const adminToken = jwt.sign({ id: 1, email: 'admin@ralahami.lk', role: 'ADMIN' }, secret, { expiresIn: '1h' });

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runCancellationAndRestockTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING ORDER CANCELLATION & STOCK REVERSAL TEST SUITE');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function assert(cond, label) {
    if (cond) {
      console.log(`  ✅ [PASS] ${label}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${label}`);
      failed++;
    }
  }

  try {
    // 1. Setup: Ensure an inventory item exists with nested variants
    const invRes = await db.query(
      `SELECT * FROM inventory_items WHERE LOWER(name) LIKE '%natural mountain spring%' LIMIT 1`
    );

    let waterItem;
    if (invRes.rows.length === 0) {
      waterItem = await InventoryModel.create({
        name: 'Natural Mountain Spring Water Bottle',
        category: 'Beverages & Water Bottles',
        supplier: 'Highland Springs',
        unit: 'Bottles',
        variants: [
          { size: '500ml', price: 150, stock: 25 },
          { size: '1L', price: 250, stock: 40 },
          { size: '1.5L', price: 350, stock: 20 },
        ]
      });
    } else {
      waterItem = invRes.rows[0];
      // Reset stock of 1L variant to 40 for clean test
      const variants = [
        { size: '500ml', price: 150, stock: 25 },
        { size: '1L', price: 250, stock: 40 },
        { size: '1.5L', price: 350, stock: 20 },
      ];
      await db.query(
        `UPDATE inventory_items SET variants = $1, current_stock = $2 WHERE id = $3`,
        [JSON.stringify(variants), 85, waterItem.id]
      );
    }

    // Check starting stock of 1L variant
    const initialItem = await InventoryModel.findById(waterItem.id);
    const initial1L = initialItem.variants.find((v) => v.size === '1L')?.stock;
    const initialTotal = initialItem.stock;
    console.log(`ℹ️ [INITIAL STATE] Water Item ID: ${waterItem.id}, 1L Stock: ${initial1L}, Total: ${initialTotal}`);
    assert(initial1L === 40, `Initial 1L stock is 40`);

    // 2. Place a Dine-In Order with 2x 1L water bottles
    const uniqueEmail = `patron.test.${Date.now()}@example.com`;
    const orderPayload = {
      orderType: 'DINE_IN',
      fulfillmentType: 'Dine-In',
      recipientName: 'Lord Test Patron',
      email: uniqueEmail,
      phone: '+94 77 123 4567',
      diningDate: '2026-10-10',
      diningTime: '18:30',
      hallName: 'Royal Dining Hall',
      tableNumber: 'Table 2',
      partySize: 4,
      items: [
        {
          id: waterItem.id,
          inventoryItemId: waterItem.id,
          name: 'Natural Mountain Spring Water Bottle (1L)',
          selectedSize: '1L',
          price: 250,
          quantity: 2,
          is_inventory_item: true
        }
      ],
      totalAmount: 500
    };

    const placeRes = await makeRequest(
      {
        hostname: 'localhost',
        port: 5000,
        path: '/api/orders',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      orderPayload
    );

    assert(placeRes.status === 201 && placeRes.data.success, `Order placed successfully (Status: ${placeRes.status})`);
    const createdOrder = placeRes.data.data;
    const orderId = createdOrder.id;
    console.log(`ℹ️ Created Order ID: ${orderId}, Order Number: ${createdOrder.order_number || createdOrder.orderNumber}`);

    // 3. Verify stock was deducted by 2 units
    const afterOrder = await InventoryModel.findById(waterItem.id);
    const after1L = afterOrder.variants.find((v) => v.size === '1L')?.stock;
    const afterTotal = afterOrder.stock;
    console.log(`ℹ️ [AFTER ORDER] 1L Stock: ${after1L} (Expected 38), Total: ${afterTotal} (Expected 83)`);
    assert(after1L === 38, `1L variant stock decremented to 38`);
    assert(afterTotal === 83, `Total stock decremented to 83`);

    // 4. Verify reservation was created and table is not available
    const resCheck = await db.query(
      `SELECT * FROM reservations WHERE order_id = $1`,
      [orderId]
    );
    assert(resCheck.rows.length > 0, `Linked reservation was auto-created in DB`);
    assert(resCheck.rows[0].status === 'CONFIRMED', `Linked reservation status is CONFIRMED`);

    // 5. Cancel the order via Admin Status Update API
    console.log(`ℹ️ Cancelling order #${orderId} via Admin Status Update API...`);
    const cancelRes = await makeRequest(
      {
        hostname: 'localhost',
        port: 5000,
        path: `/api/orders/${orderId}/status`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      },
      { status: 'CANCELLED' }
    );

    assert(cancelRes.status === 200 && cancelRes.data.success, `Order status updated to CANCELLED (Status: ${cancelRes.status})`);
    assert(cancelRes.data.order?.status === 'CANCELLED', `Response confirmed order status is CANCELLED`);

    // 6. Verify stock reversal: 1L variant stock should be restored back to 40!
    const afterCancel = await InventoryModel.findById(waterItem.id);
    const afterCancel1L = afterCancel.variants.find((v) => v.size === '1L')?.stock;
    const afterCancelTotal = afterCancel.stock;
    console.log(`ℹ️ [AFTER CANCEL] 1L Stock: ${afterCancel1L} (Expected 40), Total: ${afterCancelTotal} (Expected 85)`);
    assert(afterCancel1L === 40, `1L variant stock restored back to 40 after order cancellation`);
    assert(afterCancelTotal === 85, `Total parent stock restored back to 85 after order cancellation`);

    // 7. Verify Idempotence: Cancelling again should NOT double-restock
    console.log(`ℹ️ Attempting redundant cancellation to test idempotence...`);
    await makeRequest(
      {
        hostname: 'localhost',
        port: 5000,
        path: `/api/orders/${orderId}/status`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      },
      { status: 'CANCELLED' }
    );

    const afterSecondCancel = await InventoryModel.findById(waterItem.id);
    const second1L = afterSecondCancel.variants.find((v) => v.size === '1L')?.stock;
    assert(second1L === 40, `Stock remains exactly 40 (Idempotent - no double restock)`);

    // 8. Verify linked reservation status is CANCELLED and table freed
    const afterResCheck = await db.query(
      `SELECT * FROM reservations WHERE order_id = $1`,
      [orderId]
    );
    assert(afterResCheck.rows[0]?.status === 'CANCELLED', `Linked reservation status is CANCELLED`);

    // 9. Clean up test records
    await db.query(`DELETE FROM order_items WHERE order_id = $1`, [orderId]);
    await db.query(`DELETE FROM reservations WHERE order_id = $1`, [orderId]);
    await db.query(`DELETE FROM orders WHERE id = $1`, [orderId]);

  } catch (err) {
    console.error('❌ [TEST CRASH]:', err);
    failed++;
  }

  console.log('================================================================');
  console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runCancellationAndRestockTests();
