#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { env } from '../src/config/env.js';
import { DataStore } from '../src/storage/dataStore.js';
import { InventoryEngine } from '../src/core/inventoryEngine.js';
import { AnalyticsService } from '../src/core/analyticsService.js';
import { COLLECTIONS, VALUATION_METHODS } from '../src/config/constants.js';

/**
 * StockPulse Companion CLI Utility.
 * Provides batch CSV import/export, low-stock diagnostics, and ledger reconciliation.
 */

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    process.exit(0);
  }

  const store = new DataStore(env.STORAGE_DIR);
  await store.init();
  const inventory = new InventoryEngine(store);
  const analytics = new AnalyticsService(store, inventory);

  try {
    switch (command) {
      case 'import-inventory':
        await handleImportInventory(inventory, args[1]);
        break;

      case 'export-inventory':
        await handleExportInventory(analytics, args[1]);
        break;

      case 'low-stock':
        handleLowStockAlerts(inventory);
        break;

      case 'reconcile':
        handleLedgerReconciliation(store, inventory);
        break;

      default:
        console.error(`Unknown command: "${command}". Run "stockpulse --help" for usage.`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`\x1b[31m[ERROR]\x1b[0m ${err.message}`);
    process.exit(1);
  } finally {
    await store.close();
  }
}

function printHelp() {
  console.log(`
\x1b[1m\x1b[36mStockPulse CLI — Inventory & Ledger Toolkit\x1b[0m

\x1b[1mUSAGE:\x1b[0m
  node bin/stockpulse-cli.js <command> [arguments]

\x1b[1mCOMMANDS:\x1b[0m
  \x1b[32mimport-inventory <file.csv>\x1b[0m   Batch import SKUs and initial stock from CSV
  \x1b[32mexport-inventory [output.csv]\x1b[0m Export stock catalogue and valuation to CSV
  \x1b[32mlow-stock\x1b[0m                     Identify items below dynamic Reorder Point (ROP)
  \x1b[32mreconcile\x1b[0m                     Verify consistency between batch lots and transactions
  \x1b[32m--help, -h\x1b[0m                    Show this help manual

\x1b[1mCSV IMPORT FORMAT:\x1b[0m
  skuCode,name,category,unit,sellingPrice,taxRate,quantity,unitCostPrice,reorderPoint
  BOLT-M8,M8 Titanium Bolt,Hardware,PCS,120,18,100,75,20
`);
}

/**
 * Handles batch CSV import.
 * @param {InventoryEngine} inventory
 * @param {string} filePath
 */
async function handleImportInventory(inventory, filePath) {
  if (!filePath) {
    console.error('\x1b[31mError:\x1b[0m Please provide a path to a valid CSV file.');
    console.error('Usage: stockpulse import-inventory <path-to-file.csv>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`\x1b[31mError:\x1b[0m File not found at "${resolvedPath}".`);
    process.exit(1);
  }

  console.log(`\x1b[36mImporting inventory from:\x1b[0m ${resolvedPath}`);
  const content = fs.readFileSync(resolvedPath, 'utf8');
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);

  if (lines.length < 2) {
    console.error('\x1b[31mError:\x1b[0m CSV file is empty or missing headers.');
    process.exit(1);
  }

  const headers = lines[0].split(',').map(h => h.trim());
  let successCount = 0;
  let failCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] || '';
    });

    if (!row.skuCode || !row.name) {
      console.warn(`Line ${i + 1}: Skipped (missing skuCode or name)`);
      failCount++;
      continue;
    }

    try {
      let sku;
      try {
        sku = await inventory.createSku({
          skuCode: row.skuCode,
          name: row.name,
          category: row.category || 'General',
          unit: row.unit || 'PCS',
          sellingPrice: Number(row.sellingPrice) || 0,
          taxRate: row.taxRate !== undefined ? Number(row.taxRate) : 18,
          reorderPoint: Number(row.reorderPoint) || 10
        });
      } catch (err) {
        if (err.code === 'CONFLICT') {
          sku = inventory.store.findByIndex(COLLECTIONS.SKUS, 'skuCode', row.skuCode.toUpperCase());
        } else {
          throw err;
        }
      }

      const initialQty = Number(row.quantity);
      const costPrice = Number(row.unitCostPrice);

      if (initialQty > 0 && sku) {
        await inventory.receiveStock({
          skuId: sku.id,
          quantity: initialQty,
          unitCostPrice: Number.isNaN(costPrice) ? 0 : costPrice,
          batchNumber: `IMPORT-${sku.skuCode}-${Date.now().toString().slice(-4)}`
        });
      }

      successCount++;
      console.log(`  ✓ Imported SKU: \x1b[32m${row.skuCode}\x1b[0m (${row.name}) - Qty: ${initialQty || 0}`);
    } catch (err) {
      failCount++;
      console.error(`  ✕ Line ${i + 1} (${row.skuCode}): ${err.message}`);
    }
  }

  console.log(`\n\x1b[1mSummary:\x1b[0m Successfully processed: \x1b[32m${successCount}\x1b[0m | Failed: \x1b[31m${failCount}\x1b[0m\n`);
}

/**
 * Handles CSV export.
 * @param {AnalyticsService} analytics
 * @param {string} [outputPath]
 */
async function handleExportInventory(analytics, outputPath) {
  const csv = analytics.exportInventoryCsv();

  if (outputPath) {
    const dest = path.resolve(process.cwd(), outputPath);
    fs.writeFileSync(dest, csv, 'utf8');
    console.log(`\x1b[32m✓ Inventory exported successfully to:\x1b[0m ${dest}`);
  } else {
    process.stdout.write(csv + '\n');
  }
}

/**
 * Evaluates low-stock alerts and outputs table.
 * @param {InventoryEngine} inventory
 */
function handleLowStockAlerts(inventory) {
  const alerts = inventory.computeReorderThresholds().filter(a => a.isLowStock);

  if (alerts.length === 0) {
    console.log('\n\x1b[32m✓ All SKU stocks are healthy and above their Reorder Point (ROP).\x1b[0m\n');
    return;
  }

  console.log(`\n\x1b[1m\x1b[33m⚠️  LOW-STOCK REORDER ALERTS (${alerts.length} ITEMS NEED REORDERING):\x1b[0m\n`);
  console.log('-----------------------------------------------------------------------------------------');
  console.log('| SKU Code       | Item Name                      | Stock | ROP | Suggested Order Qty     |');
  console.log('-----------------------------------------------------------------------------------------');

  for (const a of alerts) {
    const code = a.sku.skuCode.padEnd(14);
    const name = a.sku.name.slice(0, 30).padEnd(30);
    const stock = String(a.currentStock).padStart(5);
    const rop = String(a.reorderPoint).padStart(3);
    const orderQty = String(`+${a.suggestedOrderQuantity} ${a.sku.unit}`).padStart(23);

    console.log(`| \x1b[36m${code}\x1b[0m | ${name} | \x1b[31m${stock}\x1b[0m | ${rop} | \x1b[32m${orderQty}\x1b[0m |`);
  }

  console.log('-----------------------------------------------------------------------------------------\n');
}

/**
 * Reconciles inventory batch balances against stock transaction logs.
 * @param {DataStore} store
 * @param {InventoryEngine} inventory
 */
function handleLedgerReconciliation(store, inventory) {
  console.log('\n\x1b[36mRunning Comprehensive Stock Ledger Reconciliation...\x1b[0m\n');

  const skus = store.find(COLLECTIONS.SKUS);
  const batches = store.find(COLLECTIONS.BATCHES);
  const txs = store.find(COLLECTIONS.TRANSACTIONS);

  let totalDiscrepancies = 0;

  for (const sku of skus) {
    const skuBatches = batches.filter(b => b.skuId === sku.id);
    const currentStock = skuBatches.reduce((sum, b) => sum + b.availableQuantity, 0);

    const skuTxs = txs.filter(t => t.skuId === sku.id);
    let netTxFlow = 0;
    for (const t of skuTxs) {
      if (t.type === 'IN') netTxFlow += t.quantity;
      if (t.type === 'OUT') netTxFlow -= t.quantity;
    }

    if (currentStock !== netTxFlow) {
      totalDiscrepancies++;
      console.error(
        `\x1b[31m[DISCREPANCY]\x1b[0m SKU: ${sku.skuCode} | Active Lots Balance: ${currentStock} != Transaction Net Flow: ${netTxFlow}`
      );
    }
  }

  if (totalDiscrepancies === 0) {
    console.log(`\x1b[32m✓ 100% Ledger Consistency Verified across ${skus.length} SKUs, ${batches.length} batches, and ${txs.length} transactions.\x1b[0m\n`);
  } else {
    console.warn(`\x1b[33mFound ${totalDiscrepancies} variance(s) during ledger audit.\x1b[0m\n`);
  }
}

main();
