/**
 * ====================================================================
 * RALAHAMI RESTAURANT - ENTERPRISE FINANCIAL & HISTORICAL SEED SCRIPT
 * University of Bedfordshire (CIS007-3 / CIS045-3)
 * ====================================================================
 * Populates realistic, multi-horizon historical financial records spanning:
 *  - Today (Daily scope)
 *  - Last 7 Days (Weekly scope)
 *  - Last 30 Days (Monthly scope)
 *  - Past Quarter & Year (Annual / All-time scope)
 *
 * Entities Populated:
 *  1. Orders & Line Items (DINE_IN, TAKEAWAY, DELIVERY)
 *  2. Payments & Gateway Transaction References (PAID via CASH, CREDIT_CARD, ONLINE)
 *  3. Operating Expenses & Staff Payroll (STAFF_PAYROLL, INVENTORY_PURCHASE, UTILITIES, OPERATIONAL_OVERHEAD, MARKETING)
 *  4. Dining Reservations & Seated Covers
 * ====================================================================
 */

const { pool } = require('../config/db');
const financialService = require('../modules/financials/financialService');

// Helper to compute ISO timestamp string relative to now
const getDateOffset = (daysAgo, hours = 12, minutes = 0) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};

const getDateString = (daysAgo) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
};

async function seedFinancials() {
  const client = await pool.connect();

  console.log('====================================================================');
  console.log('🏛️  [RALAHAMI FINANCIAL SEED]: Initiating Enterprise Historical Seeding...');
  console.log('====================================================================');

  try {
    await client.query('BEGIN');

    // 1. Fetch available users, menu items, and tables for referential integrity
    const usersRes = await client.query(`
      SELECT id, display_name, email, phone 
      FROM users 
      WHERE role = 'CUSTOMER' OR email IN ('user@ralahami.lk', 'patron@ralahami.lk', 'customer@ralahami.com', 'sarah.j@example.com')
      ORDER BY created_at ASC
    `);
    const customers = usersRes.rows.length > 0 ? usersRes.rows : [
      { id: '11111111-2222-3333-4444-555555555500', display_name: 'User Customer', email: 'user@ralahami.lk', phone: '+94775678901' },
      { id: '11111111-2222-3333-4444-555555555503', display_name: 'Patron Customer', email: 'patron@ralahami.lk', phone: '+94775678901' },
      { id: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', display_name: 'Nimal Fernando', email: 'customer@ralahami.com', phone: '+94775678901' },
      { id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', display_name: 'Sarah Jenkins', email: 'sarah.j@example.com', phone: '+447911123456' }
    ];

    const menuItemsRes = await client.query('SELECT id, name, price, category_id FROM menu_items ORDER BY id ASC');
    const menuItems = menuItemsRes.rows;

    // 2. Clean previous historical dummy seeds to ensure pristine baseline
    console.log('🧹 Cleaning previous synthetic test financial records & expenses...');
    await client.query("DELETE FROM payments WHERE transaction_reference LIKE 'TXN-HIST-%'");
    await client.query("DELETE FROM orders WHERE order_number LIKE 'ORD-HIST-%'");
    await client.query("DELETE FROM expenses");
    await client.query("DELETE FROM reservations WHERE patron_name LIKE '[TEST]%'");

    // 3. Define Master Culinary Menu Templates
    const culinaryCatalog = [
      { name: 'Jaffna Fiery Lagoon Crab Curry', price: 3800.00 },
      { name: 'Ceylon Black Pepper Chicken Curry', price: 1650.00 },
      { name: 'Signature Cheese Chicken Kottu', price: 1550.00 },
      { name: 'Creamy Dhal Tadka with Coconut Cream', price: 850.00 },
      { name: 'Ceylon Spiced Fish Cutlets (4 pcs)', price: 650.00 },
      { name: 'Crispy Vegetable Samosas (3 pcs)', price: 550.00 },
      { name: 'Traditional Spiced Watalappam', price: 600.00 },
      { name: 'Chilled King Coconut with Lime & Mint', price: 450.00 },
      { name: 'Natural Mountain Spring Water Bottle (1L)', price: 250.00 },
      { name: 'Cocacola (1.5L)', price: 950.00 }
    ];

    // 4. Generate Comprehensive Realistic Orders across 30 Days
    const historicalOrderBlueprints = [];
    let orderSeq = 1000;

    // Days 0 (Today) to Day 29 (Past Month)
    for (let day = 0; day < 30; day++) {
      const isToday = day === 0;
      const isWeekend = (day % 7 === 1 || day % 7 === 2);
      const ordersForDay = isToday ? 8 : (isWeekend ? 6 : 4);

      for (let oIdx = 0; oIdx < ordersForDay; oIdx++) {
        orderSeq++;
        const customer = customers[(day + oIdx) % customers.length];
        const orderType = oIdx % 3 === 0 ? 'DINE_IN' : (oIdx % 3 === 1 ? 'TAKEAWAY' : 'DELIVERY');
        const paymentMethod = oIdx % 3 === 0 ? 'CREDIT_CARD' : (oIdx % 3 === 1 ? 'ONLINE' : 'CASH');
        const hour = 11 + ((oIdx * 2) % 12);
        const minute = (oIdx * 13) % 60;

        // Select 3 to 5 diverse items from catalog
        const item1 = culinaryCatalog[(day + oIdx) % culinaryCatalog.length];
        const item2 = culinaryCatalog[(day + oIdx + 2) % culinaryCatalog.length];
        const item3 = culinaryCatalog[(day + oIdx + 4) % culinaryCatalog.length];
        const item4 = culinaryCatalog[(day + oIdx + 6) % culinaryCatalog.length];

        const orderItems = [
          { name: item1.name, price: item1.price, qty: 1 + (oIdx % 3) },
          { name: item2.name, price: item2.price, qty: 1 + ((oIdx + 1) % 3) },
          { name: item3.name, price: item3.price, qty: 2 + (oIdx % 2) },
          { name: item4.name, price: item4.price, qty: 1 + (oIdx % 2) }
        ];

        // Rare cancellation (1 order every 20 days) for realistic analytics
        const isCancelled = (day === 12 && oIdx === 1) || (day === 26 && oIdx === 2);

        historicalOrderBlueprints.push({
          daysAgo: day,
          hour,
          minute,
          orderNumber: `ORD-HIST-${day < 10 ? '0' + day : day}-${orderSeq}`,
          orderType,
          status: isCancelled ? 'CANCELLED' : 'COMPLETED',
          customer,
          deliveryAddress: orderType === 'DELIVERY' ? `${10 + (oIdx * 15)} Riverside Way, Ratnapura` : null,
          notes: orderType === 'DINE_IN' ? `Table ${(oIdx % 4) + 1} - Royal Dining Room` : 'Luxury insulated packaging',
          paymentMethod,
          items: orderItems
        });
      }
    }

    console.log(`📦 Inserting ${historicalOrderBlueprints.length} synthetic historical orders & line items across 30 days...`);

    let totalRevenueSeeded = 0;
    let seededOrderCount = 0;

    for (const blueprint of historicalOrderBlueprints) {
      const orderTotal = blueprint.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
      const createdAt = getDateOffset(blueprint.daysAgo, blueprint.hour, blueprint.minute);

      const orderInsertRes = await client.query(`
        INSERT INTO orders (
          order_number, recipient_name, user_id, status, total_amount, order_type, 
          delivery_address, customer_email, customer_phone, notes, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
        RETURNING id;
      `, [
        blueprint.orderNumber,
        blueprint.customer.display_name,
        blueprint.customer.id,
        blueprint.status,
        orderTotal,
        blueprint.orderType,
        blueprint.deliveryAddress || null,
        blueprint.customer.email,
        blueprint.customer.phone,
        blueprint.notes,
        createdAt
      ]);

      const orderId = orderInsertRes.rows[0].id;

      // Insert line items
      for (const item of blueprint.items) {
        let menuItemId = null;
        if (menuItems.length > 0) {
          const matched = menuItems.find(m => m.name.toLowerCase().includes(item.name.split(' ')[0].toLowerCase())) || menuItems[0];
          menuItemId = matched?.id || null;
        }

        await client.query(`
          INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, unit_price, special_instructions, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          orderId,
          menuItemId,
          item.name,
          item.qty,
          item.price,
          'Heritage recipe standard',
          createdAt
        ]);
      }

      // Insert payment record if completed
      if (blueprint.status === 'COMPLETED') {
        await client.query(`
          INSERT INTO payments (order_id, amount, status, payment_method, transaction_reference, created_at)
          VALUES ($1, $2, 'PAID', $3, $4, $5)
        `, [
          orderId,
          orderTotal,
          blueprint.paymentMethod,
          `TXN-HIST-${blueprint.orderNumber}`,
          createdAt
        ]);
        totalRevenueSeeded += orderTotal;
      }

      seededOrderCount++;
    }

    // 5. Seed Calibrated Operating Expenses across Horizons
    console.log('💵 Inserting calibrated operating expenses across Daily, Weekly, and Monthly scopes...');

    const expenseBlueprints = [
      // TODAY (Day 0) - Routine Daily Supplies
      {
        daysAgo: 0,
        title: 'Daily Organic Market Produce & Fresh Herbs',
        category: 'INVENTORY_PURCHASE',
        amount: 28500.00,
        description: 'Morning procurement of fresh coriander, lime, shallots, and organic king coconuts',
        paymentMethod: 'CASH',
        recordedBy: 'Kasun Bandara (Manager)'
      },
      {
        daysAgo: 0,
        title: 'Daily Purified Ice Blocks & Bar Garnishes',
        category: 'OPERATIONAL_OVERHEAD',
        amount: 6500.00,
        description: 'Chilled ice blocks and fresh cocktail herbs for royal beverage station',
        paymentMethod: 'CASH',
        recordedBy: 'Kasun Bandara (Manager)'
      },

      // WEEKLY (Last 7 Days)
      {
        daysAgo: 2,
        title: 'Central Highlands Poultry & Farm Meat Delivery',
        category: 'INVENTORY_PURCHASE',
        amount: 85000.00,
        description: 'Weekly bulk order of Grade-A pasture-raised boneless chicken cuts',
        paymentMethod: 'BANK_TRANSFER',
        recordedBy: 'Kasun Bandara (Manager)'
      },
      {
        daysAgo: 4,
        title: 'Litro Commercial Manifold Gas Refills (2x 45kg)',
        category: 'UTILITIES',
        amount: 28000.00,
        description: 'Industrial cooking gas tanks for high-heat clay ovens & wok stations',
        paymentMethod: 'DIRECT_DEBIT',
        recordedBy: 'Duminda Alwis (Admin)'
      },
      {
        daysAgo: 6,
        title: 'Weekly Kitchen & Floor Brigade Overtime Allowances',
        category: 'STAFF_PAYROLL',
        amount: 65000.00,
        description: 'Service team weekend incentive & overtime bonus disbursement',
        paymentMethod: 'BANK_TRANSFER',
        recordedBy: 'Duminda Alwis (Admin)'
      },

      // MONTHLY (Days 8 to 30)
      {
        daysAgo: 10,
        title: 'Negombo Coastal Fisheries Fresh Mud Crab Procurement',
        category: 'INVENTORY_PURCHASE',
        amount: 120000.00,
        description: '35kg Lagoon Mud Crabs and Jumbo Tiger Prawns delivered in cold storage',
        paymentMethod: 'BANK_TRANSFER',
        recordedBy: 'Kasun Bandara (Manager)'
      },
      {
        daysAgo: 15,
        title: 'Monthly Executive Chef & Culinary Brigade Core Payroll',
        category: 'STAFF_PAYROLL',
        amount: 520000.00,
        description: 'Executive Chef, Sous Chefs, Floor Captains, and Prep staff monthly salaries',
        paymentMethod: 'BANK_TRANSFER',
        recordedBy: 'Duminda Alwis (Admin)'
      },
      {
        daysAgo: 18,
        title: 'Ceylon Electricity Board (CEB) Industrial Utility Bill',
        category: 'UTILITIES',
        amount: 98000.00,
        description: 'Commercial 3-phase electricity consumption for deep chillers & dining lighting',
        paymentMethod: 'DIRECT_DEBIT',
        recordedBy: 'Duminda Alwis (Admin)'
      },
      {
        daysAgo: 22,
        title: 'Heritage Dining Hall Wood Preservation & Artisan Maintenance',
        category: 'OPERATIONAL_OVERHEAD',
        amount: 45000.00,
        description: 'Teak dining table polishing, brass lamp burnishing, and botanical floral decor',
        paymentMethod: 'CASH',
        recordedBy: 'Kasun Bandara (Manager)'
      },
      {
        daysAgo: 26,
        title: 'Eco-Friendly Banana-Leaf Packaging & Takeaway Supplies',
        category: 'OPERATIONAL_OVERHEAD',
        amount: 32000.00,
        description: 'Branded bio-degradable meal cartons, cutlery pouches, and delivery tote bags',
        paymentMethod: 'ONLINE',
        recordedBy: 'Kasun Bandara (Manager)'
      },
      {
        daysAgo: 28,
        title: 'Digital Heritage Social Media Culinary Campaign',
        category: 'MARKETING',
        amount: 35000.00,
        description: 'Digital promotional campaign highlighting seasonal mud crab specialties',
        paymentMethod: 'ONLINE',
        recordedBy: 'Duminda Alwis (Admin)'
      }
    ];

    let totalExpensesSeeded = 0;
    for (const exp of expenseBlueprints) {
      const expenseDate = getDateString(exp.daysAgo);
      const createdAt = getDateOffset(exp.daysAgo, 10, 0);

      await client.query(`
        INSERT INTO expenses (title, category, amount, description, payment_method, recorded_by, expense_date, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      `, [
        exp.title,
        exp.category,
        exp.amount,
        exp.description,
        exp.paymentMethod,
        exp.recordedBy,
        expenseDate,
        createdAt
      ]);
      totalExpensesSeeded += exp.amount;
    }

    // 6. Seed Historical Reservations across Scopes
    console.log('🪑 Inserting historical dining reservations & seated covers...');
    const reservationBlueprints = [
      { daysAgo: 0, partySize: 6, hall: 'Royal Dining Hall', table: 'Table 4', status: 'COMPLETED', patron: '[TEST] Minister Perera' },
      { daysAgo: 0, partySize: 4, hall: 'Balcony Court', table: 'Table 3', status: 'SEATED', patron: '[TEST] Dr. Wickramasinghe' },
      { daysAgo: 1, partySize: 8, hall: 'Private Suite', table: 'Table 2', status: 'COMPLETED', patron: '[TEST] Jayawardena Family' },
      { daysAgo: 2, partySize: 4, hall: 'Royal Dining Hall', table: 'Table 2', status: 'COMPLETED', patron: '[TEST] Ambassador Alwis' },
      { daysAgo: 3, partySize: 4, hall: 'Royal Dining Hall', table: 'Table 1', status: 'COMPLETED', patron: '[TEST] Sarah Jenkins Group' },
      { daysAgo: 5, partySize: 12, hall: 'Private Suite', table: 'Table 4', status: 'COMPLETED', patron: '[TEST] Colombo Corporate Dinner' },
      { daysAgo: 7, partySize: 6, hall: 'Balcony Court', table: 'Table 1', status: 'COMPLETED', patron: '[TEST] Gem Merchant Guild' },
      { daysAgo: 12, partySize: 6, hall: 'Balcony Court', table: 'Table 4', status: 'COMPLETED', patron: '[TEST] Fernando Anniversary' },
      { daysAgo: 18, partySize: 8, hall: 'Private Suite', table: 'Table 1', status: 'COMPLETED', patron: '[TEST] Heritage Arts Foundation' },
      { daysAgo: 25, partySize: 4, hall: 'Royal Dining Hall', table: 'Table 3', status: 'COMPLETED', patron: '[TEST] Senanayake Reunion' }
    ];

    for (const resv of reservationBlueprints) {
      const resvTime = getDateOffset(resv.daysAgo, 19, 30);
      const resvDate = getDateString(resv.daysAgo);

      await client.query(`
        INSERT INTO reservations (
          hall_name, table_number, party_size, reservation_date, reservation_time,
          status, patron_name, phone, email, booking_source, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, '+94771234567', 'patron@ralahami.lk', 'Online / App', $5, $5)
      `, [
        resv.hall,
        resv.table,
        resv.partySize,
        resvDate,
        resvTime,
        resv.status,
        resv.patron
      ]);
    }

    await client.query('COMMIT');
    console.log('✅ [RALAHAMI FINANCIAL SEED]: Transaction committed successfully!');

    // 7. Execute Live Verification Queries for Scopes (Daily, Weekly, Monthly, All)
    console.log('\n====================================================================');
    console.log('📊 LIVE VERIFICATION ACROSS DASHBOARD SCOPES:');
    console.log('====================================================================');

    const scopes = ['today', 'week', 'month', 'all'];
    for (const scope of scopes) {
      const summary = await financialService.getFinancialSummary({ range: scope });
      console.log(`\n📌 Scope: [${summary.period.label}]`);
      console.log(`   - Total Orders Received : ${summary.kpis.totalOrders} (${summary.kpis.completedOrders} Completed, ${summary.kpis.cancelledOrders} Cancelled)`);
      console.log(`   - Gross Sales (Earnings): ${summary.kpis.grossRevenueFormatted}`);
      console.log(`   - Total Operating Costs : ${summary.expensesBreakdown.totalOperationalCostFormatted}`);
      console.log(`   - Net Profit (Take Home): ${summary.kpis.netProfitFormatted} (Margin: ${summary.kpis.netProfitMargin})`);
      console.log(`   - Average Order Value   : ${summary.kpis.averageOrderValueFormatted}`);
      console.log(`   - Seated Dining Covers  : ${summary.kpis.seatedCovers} covers (${summary.kpis.totalReservations} reservations)`);
      console.log(`   - Channel Breakdown     : Dine-In: ${summary.channels.dineIn.formatted} (${summary.channels.dineIn.count} orders) | Takeaway: ${summary.channels.takeaway.formatted} (${summary.channels.takeaway.count} orders) | Delivery: ${summary.channels.delivery.formatted} (${summary.channels.delivery.count} orders)`);
      if (summary.topDishes && summary.topDishes.length > 0) {
        console.log(`   - Top Specialty Dish    : #${summary.topDishes[0].rank} ${summary.topDishes[0].name} (${summary.topDishes[0].count} sold, ${summary.topDishes[0].rev})`);
      }
    }

    console.log('\n====================================================================');
    console.log('🎉 Seed Execution Completed: Historical financial datasets ready for Admin Dashboard & PDF export.');
    console.log('====================================================================');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [RALAHAMI FINANCIAL SEED ERROR]:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Allow standalone CLI execution: `node src/database/seedFinancials.js`
if (require.main === module) {
  seedFinancials()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seeding failed:', err.message);
      process.exit(1);
    });
}

module.exports = { seedFinancials };
