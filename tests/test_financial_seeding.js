const db = require('../src/config/db');
const { seedFinancials } = require('../src/database/seedFinancials');
const financialService = require('../src/modules/financials/financialService');

async function testFinancialSeedingAndAggregations() {
  console.log('🏛️ ====================================================================');
  console.log('   RALAHAMI RESTAURANT - FINANCIAL SEEDING & REPORTING TEST SUITE');
  console.log('   Verification for Daily, Weekly, Monthly Scopes and PDF Aggregation');
  console.log('====================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] Check #${total}: ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] Check #${total}: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // 1. Run seedFinancials
  console.log('📌 STEP 1: Running seedFinancials()...');
  await seedFinancials();
  assert(true, 'seedFinancials executed without unhandled errors');

  // 2. Test Today (Daily Scope)
  console.log('\n📌 STEP 2: Verifying Today (Daily) Scope...');
  const dailySummary = await financialService.getFinancialSummary({ range: 'today' });
  assert(dailySummary && dailySummary.period && dailySummary.period.range === 'today', 'Daily scope period metadata defined');
  assert(dailySummary.kpis.totalOrders > 0, `Daily total orders > 0 (found: ${dailySummary.kpis.totalOrders})`);
  assert(dailySummary.kpis.grossRevenue > 0, `Daily gross revenue > 0 (found: ${dailySummary.kpis.grossRevenueFormatted})`);
  assert(dailySummary.expensesBreakdown.totalOperationalCost > 0, `Daily expenses > 0 (found: ${dailySummary.expensesBreakdown.totalOperationalCostFormatted})`);
  assert(dailySummary.channels.dineIn.count >= 0 && dailySummary.channels.takeaway.count >= 0 && dailySummary.channels.delivery.count >= 0, 'Daily channel breakdowns populated');

  // 3. Test Last 7 Days (Weekly Scope)
  console.log('\n📌 STEP 3: Verifying Last 7 Days (Weekly) Scope...');
  const weeklySummary = await financialService.getFinancialSummary({ range: 'week' });
  assert(weeklySummary.kpis.totalOrders >= dailySummary.kpis.totalOrders, `Weekly total orders (${weeklySummary.kpis.totalOrders}) >= Daily total orders (${dailySummary.kpis.totalOrders})`);
  assert(weeklySummary.kpis.grossRevenue >= dailySummary.kpis.grossRevenue, `Weekly revenue (${weeklySummary.kpis.grossRevenue}) >= Daily revenue (${dailySummary.kpis.grossRevenue})`);
  assert(weeklySummary.expensesBreakdown.staffSalaries >= 0, 'Weekly staff payroll tracked');
  assert(weeklySummary.expensesBreakdown.inventoryPurchases >= 0, 'Weekly inventory purchases tracked');
  assert(weeklySummary.expensesBreakdown.utilities >= 0, 'Weekly utilities tracked');

  // 4. Test Last 30 Days (Monthly Scope)
  console.log('\n📌 STEP 4: Verifying Last 30 Days (Monthly) Scope...');
  const monthlySummary = await financialService.getFinancialSummary({ range: 'month' });
  assert(monthlySummary.kpis.totalOrders >= weeklySummary.kpis.totalOrders, `Monthly total orders (${monthlySummary.kpis.totalOrders}) >= Weekly total orders (${weeklySummary.kpis.totalOrders})`);
  assert(monthlySummary.kpis.grossRevenue >= weeklySummary.kpis.grossRevenue, `Monthly revenue (${monthlySummary.kpis.grossRevenue}) >= Weekly revenue (${weeklySummary.kpis.grossRevenue})`);
  assert(monthlySummary.kpis.seatedCovers > 0, `Monthly seated covers > 0 (found: ${monthlySummary.kpis.seatedCovers})`);
  assert(monthlySummary.topDishes.length > 0, `Top grossing dishes identified (count: ${monthlySummary.topDishes.length})`);
  assert(monthlySummary.recentExpenses.length > 0, `Recent expenses ledger records found (count: ${monthlySummary.recentExpenses.length})`);

  // 5. Test PDF Report Data Structure Compatibility
  console.log('\n📌 STEP 5: Verifying PDF Report Data Structure Compatibility...');
  assert(typeof monthlySummary.kpis.grossRevenueFormatted === 'string' && monthlySummary.kpis.grossRevenueFormatted.includes('LKR'), 'Gross revenue formatted as LKR string for PDF table');
  assert(typeof monthlySummary.kpis.netProfitFormatted === 'string' && monthlySummary.kpis.netProfitFormatted.includes('LKR'), 'Net profit formatted as LKR string for PDF table');
  assert(typeof monthlySummary.expensesBreakdown.staffSalariesFormatted === 'string', 'Staff salaries formatted for PDF table');
  assert(typeof monthlySummary.expensesBreakdown.inventoryPurchasesFormatted === 'string', 'Inventory purchases formatted for PDF table');
  assert(Array.isArray(monthlySummary.topDishes), 'Top dishes structured as array for PDF autotable');
  assert(Array.isArray(monthlySummary.recentExpenses), 'Recent expenses structured as array for PDF autotable');

  console.log('\n====================================================================');
  console.log(`🎉 ALL ${passed}/${total} FINANCIAL TESTS & VERIFICATIONS PASSED (100%)`);
  console.log('====================================================================\n');

  process.exit(0);
}

testFinancialSeedingAndAggregations().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
