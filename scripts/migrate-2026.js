const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const cp = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const migrationDir = path.join(rootDir, 'migration');
const workbookPath = path.join(migrationDir, '2026.xlsx');
const extractorPath = path.join(__dirname, 'extract-2026-workbook.ps1');

const clearSqlPath = path.join(migrationDir, '2026-clear-test-data.sql');
const importSqlPath = path.join(migrationDir, '2026-import-data.sql');
const reportPath = path.join(migrationDir, '2026-migration-report.json');

const args = new Set(process.argv.slice(2));
const mode = args.has('--sql') ? 'sql' : 'dry-run';

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
}

function runExtractor() {
  return cp.execFileSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    extractorPath,
    '-WorkbookPath',
    workbookPath,
  ], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 64,
  });
}

function toNumber(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(/,/g, '');
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

function toInteger(value) {
  const num = toNumber(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function excelSerialToIso(serial) {
  const epochUtc = Date.UTC(1899, 11, 30);
  const millis = epochUtc + Math.round(serial * 86400000);
  return new Date(millis).toISOString().slice(0, 10);
}

function quoteSql(value) {
  if (value == null) return 'NULL';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `'${String(text).replace(/'/g, "''")}'`;
}

function slugifySheetMonth(sheetName) {
  const match = String(sheetName || '').match(/^(\d{2})\.(\d{2})$/);
  if (!match) return null;
  return `20${match[1]}-${match[2]}`;
}

function normalizeCardKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/mg\+s/g, 'mg')
    .replace(/[^a-z0-9가-힣]+/g, '');
}

function buildCategoryMap(rows) {
  const map = new Map();
  const entries = [];

  for (const row of rows) {
    if (row.row < 2 || row.row > 16) continue;
    const name = String(row.cells.A || '').trim();
    const code = toInteger(row.cells.B);
    if (!name || !Number.isFinite(code)) continue;
    if (['총합', '고정비용 포함', '고정비용', '날짜'].includes(name)) continue;

    const entry = {
      row: row.row,
      code,
      name,
      budget: toNumber(row.cells.E) || 0,
    };
    map.set(code, entry);
    entries.push(entry);
  }

  return { map, entries };
}

function inferOwner(cardName, ownerWarnings) {
  const name = String(cardName || '').trim();
  if (!name) return 'me';
  if (/재욱|남편/i.test(name)) return 'spouse';
  if (/우리/i.test(name)) return 'common';
  if (/내\s*제이드/i.test(name)) return 'me';

  if (!/나|솔지|제욱|재욱|우리/i.test(name)) {
    ownerWarnings.push({
      cardName: name,
      assumedOwner: 'me',
      reason: 'Owner was not explicit in the card name.',
    });
  }
  return 'me';
}

function buildCardSettings(rows, ownerWarnings, sheetName, exceptions) {
  const entries = [];
  const byCode = new Map();
  const byKey = new Map();

  for (const row of rows) {
    if (row.row < 2 || row.row > 16) continue;
    const rawName = String(row.cells.I || '').trim();
    const rawCode = row.cells.J;
    const hasOtherValues = ['J', 'K', 'L', 'N', 'O', 'P', 'Q'].some(col => String(row.cells[col] || '').trim() !== '');

    if (!rawName) {
      if (hasOtherValues) {
        exceptions.cardRowsMissingName.push({
          sheet: sheetName,
          row: row.row,
          values: row.cells,
        });
      }
      continue;
    }

    const code = toInteger(rawCode);
    if (!Number.isFinite(code)) continue;

    const perf = toNumber(row.cells.O) || 0;
    const disc = toNumber(row.cells.L) || 0;
    const isDiscount = /할인/.test(rawName);

    const entry = {
      row: row.row,
      code,
      name: rawName,
      perf,
      disc,
      perfDefault: !isDiscount && perf > 0,
      discDefault: isDiscount || disc > 0,
      owner: inferOwner(rawName, ownerWarnings),
      inactive: false,
      memo: String(row.cells.Q || '').trim(),
      totalUsed: toNumber(row.cells.N),
      actualPerf: toNumber(row.cells.K),
      remaining: toNumber(row.cells.P),
    };

    entries.push(entry);
    byCode.set(code, entry);
    byKey.set(normalizeCardKey(rawName), entry);
  }

  return { entries, byCode, byKey };
}

function normalizeCardName(rawName, cardSettings, sheetName, exceptions) {
  const name = String(rawName || '').trim();
  if (!name) return '';

  const direct = cardSettings.byKey.get(normalizeCardKey(name));
  if (direct) return direct.name;

  exceptions.unmappedTransactionCards.push({
    sheet: sheetName,
    cardName: name,
  });
  return name;
}

function coerceStatus(rawStatus) {
  const code = toInteger(rawStatus);
  return [1, 2, 3].includes(code) ? String(code) : '';
}

function parseTransaction(row, month, categoryMap, cardSettings, sheetName, exceptions) {
  const item = String(row.cells.C || '').trim();
  const amount = toNumber(row.cells.D);
  const hasAnyTxnShape = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].some(col => String(row.cells[col] || '').trim() !== '');

  if (!item || amount == null) {
    if (hasAnyTxnShape) {
      exceptions.skippedRows.push({
        sheet: sheetName,
        row: row.row,
        reason: !item ? 'Missing item' : 'Missing or non-numeric amount',
        values: row.cells,
      });
    }
    return null;
  }

  let date = null;
  const rawDate = String(row.cells.A || '').trim();
  if (!rawDate) {
    exceptions.blankDateTransactions.push({
      sheet: sheetName,
      row: row.row,
      item,
      amount,
      values: row.cells,
    });
  } else {
    const serial = toNumber(rawDate);
    if (serial != null) {
      date = excelSerialToIso(serial);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      date = rawDate;
    } else {
      exceptions.invalidDateTransactions.push({
        sheet: sheetName,
        row: row.row,
        rawDate,
        item,
        amount,
        values: row.cells,
      });
      return null;
    }
  }

  const categoryCode = toInteger(row.cells.B);
  let category = '';
  if (categoryCode != null) {
    const mapped = categoryMap.map.get(categoryCode);
    if (!mapped) {
      exceptions.unknownCategoryCodes.push({
        sheet: sheetName,
        row: row.row,
        categoryCode,
        item,
        amount,
      });
    } else {
      category = mapped.name;
    }
  }

  const perfCode = toInteger(row.cells.F);
  let perf = false;
  let disc = false;
  if (perfCode != null) {
    const perfCard = cardSettings.byCode.get(perfCode);
    if (!perfCard) {
      exceptions.unresolvedPerfCodes.push({
        sheet: sheetName,
        row: row.row,
        perfCode,
        item,
        amount,
      });
    } else if (/할인/.test(perfCard.name)) {
      disc = true;
    } else {
      perf = true;
    }
  }

  const card = normalizeCardName(row.cells.G, cardSettings, sheetName, exceptions);
  if (!card) {
    exceptions.blankCardTransactions.push({
      sheet: sheetName,
      row: row.row,
      item,
      amount,
      values: row.cells,
    });
  }

  if (amount < 0) {
    exceptions.negativeAmountTransactions.push({
      sheet: sheetName,
      row: row.row,
      item,
      amount,
      values: row.cells,
    });
  }

  return {
    month,
    date,
    item,
    amount,
    shop: String(row.cells.E || '').trim(),
    card,
    category,
    perf,
    disc,
    status: coerceStatus(row.cells.H),
    memo: '',
    source: {
      sheet: sheetName,
      row: row.row,
      rawDate,
      categoryCode,
      perfCode,
    },
  };
}

function ensureTransactionCardsExist(transactions, cardSettings, ownerWarnings, sheetName, exceptions) {
  const known = new Set(cardSettings.entries.map(card => card.name));
  const additions = [];

  for (const txn of transactions) {
    if (!txn.card || known.has(txn.card)) continue;
    known.add(txn.card);
    additions.push({
      row: null,
      code: null,
      name: txn.card,
      perf: 0,
      disc: 0,
      perfDefault: false,
      discDefault: /할인/.test(txn.card),
      owner: inferOwner(txn.card, ownerWarnings),
      inactive: false,
      memo: '',
      totalUsed: null,
      actualPerf: null,
      remaining: null,
      inferredFromTransaction: true,
    });
    exceptions.cardsAddedFromTransactions.push({
      sheet: sheetName,
      cardName: txn.card,
    });
  }

  cardSettings.entries.push(...additions);
}

function totalBudgetFromRows(rows) {
  const totalRow = rows.find(row => String(row.cells.A || '').trim() === '총합');
  return totalRow ? (toNumber(totalRow.cells.E) || 0) : 0;
}

function defaultMemoSqlObject() {
  return {
    payments: [],
    checklist: [],
    benefits: [],
    freeText: '',
    images: [],
    cards: [],
  };
}

function createClearSql() {
  return `-- MoneyNote test data cleanup for 2026 Excel migration\n-- Run this manually in Supabase SQL Editor before the import SQL.\nTRUNCATE TABLE\n  public.transactions,\n  public.memos,\n  public.months,\n  public.month_settings,\n  public.card_month_settings,\n  public.category_month_settings\nRESTART IDENTITY CASCADE;\n`;
}

function createImportSql(dataset) {
  const lines = [];

  lines.push('-- MoneyNote 2026 workbook import');
  lines.push('-- Generated from migration/2026.xlsx');
  lines.push('');

  lines.push('BEGIN;');
  lines.push('');

  lines.push('-- Months');
  lines.push('INSERT INTO public.months (month) VALUES');
  lines.push(dataset.months.map(month => `  (${quoteSql(month)})`).join(',\n') + ';');
  lines.push('');

  lines.push('-- Month settings');
  lines.push('INSERT INTO public.month_settings (month, total_budget, toggles) VALUES');
  lines.push(dataset.monthSettings.map(row => `  (${quoteSql(row.month)}, ${row.total_budget}, '${JSON.stringify(row.toggles).replace(/'/g, "''")}'::jsonb)`).join(',\n') + ';');
  lines.push('');

  lines.push('-- Category month settings');
  lines.push('INSERT INTO public.category_month_settings (month, name, budget, inactive, sort_order) VALUES');
  lines.push(dataset.categorySettings.map(row => `  (${quoteSql(row.month)}, ${quoteSql(row.name)}, ${row.budget}, ${row.inactive ? 'true' : 'false'}, ${row.sort_order})`).join(',\n') + ';');
  lines.push('');

  lines.push('-- Card month settings');
  lines.push('INSERT INTO public.card_month_settings (month, name, perf, disc, perf_default, disc_default, owner, inactive, sort_order) VALUES');
  lines.push(dataset.cardSettings.map(row => `  (${quoteSql(row.month)}, ${quoteSql(row.name)}, ${row.perf}, ${row.disc}, ${row.perf_default ? 'true' : 'false'}, ${row.disc_default ? 'true' : 'false'}, ${quoteSql(row.owner)}, ${row.inactive ? 'true' : 'false'}, ${row.sort_order})`).join(',\n') + ';');
  lines.push('');

  lines.push('-- Transactions');
  lines.push('INSERT INTO public.transactions (month, sort_order, date, item, amount, shop, card, category, perf, disc, status, memo) VALUES');
  lines.push(dataset.transactions.map(row => `  (${quoteSql(row.month)}, ${row.sort_order}, ${quoteSql(row.date)}, ${quoteSql(row.item)}, ${row.amount}, ${quoteSql(row.shop)}, ${quoteSql(row.card)}, ${quoteSql(row.category)}, ${row.perf ? 'true' : 'false'}, ${row.disc ? 'true' : 'false'}, ${quoteSql(row.status)}, ${quoteSql(row.memo)})`).join(',\n') + ';');
  lines.push('');

  lines.push('-- Empty memos for migrated months');
  lines.push('INSERT INTO public.memos (month, memo) VALUES');
  lines.push(dataset.memos.map(row => `  (${quoteSql(row.month)}, '${JSON.stringify(row.memo).replace(/'/g, "''")}'::jsonb)`).join(',\n') + ';');
  lines.push('');

  if (dataset.manualRows.length) {
    lines.push('-- Manual review required before importing these rows');
    for (const row of dataset.manualRows) {
      lines.push(`-- ${row.sheet} row ${row.row}: raw date "${row.rawDate}" / item "${row.item}" / amount ${row.amount}`);
    }
    lines.push('');
  }

  lines.push('COMMIT;');
  lines.push('');

  return lines.join('\n');
}

function buildDataset(workbook) {
  const report = {
    workbookPath,
    generatedAt: new Date().toISOString(),
    totals: {
      importedTransactions: 0,
      transactionsInReport: 0,
    },
    months: [],
    exceptions: {
      invalidDateTransactions: [],
      blankDateTransactions: [],
      skippedRows: [],
      negativeAmountTransactions: [],
      unknownCategoryCodes: [],
      blankCardTransactions: [],
      unresolvedPerfCodes: [],
      cardRowsMissingName: [],
      cardsAddedFromTransactions: [],
      unmappedTransactionCards: [],
      ownerAssumptions: [],
    },
  };

  const dataset = {
    months: [],
    monthSettings: [],
    categorySettings: [],
    cardSettings: [],
    transactions: [],
    memos: [],
    manualRows: [],
  };

  for (const sheet of workbook.sheets) {
    const month = slugifySheetMonth(sheet.name);
    if (!month) continue;

    const exceptions = {
      invalidDateTransactions: [],
      blankDateTransactions: [],
      skippedRows: [],
      negativeAmountTransactions: [],
      unknownCategoryCodes: [],
      blankCardTransactions: [],
      unresolvedPerfCodes: [],
      cardRowsMissingName: [],
      cardsAddedFromTransactions: [],
      unmappedTransactionCards: [],
    };
    const ownerWarnings = [];

    const categoryMap = buildCategoryMap(sheet.rows);
    const cardSettings = buildCardSettings(sheet.rows, ownerWarnings, sheet.name, exceptions);

    const transactions = [];
    for (const row of sheet.rows) {
      if (row.row < 18) continue;
      const txn = parseTransaction(row, month, categoryMap, cardSettings, sheet.name, exceptions);
      if (txn) transactions.push(txn);
    }

    ensureTransactionCardsExist(transactions, cardSettings, ownerWarnings, sheet.name, exceptions);

    const monthSummary = {
      month,
      sheet: sheet.name,
      transactionCount: transactions.length,
      categoryCount: categoryMap.entries.length,
      cardCount: cardSettings.entries.length,
      totalBudget: totalBudgetFromRows(sheet.rows),
      importedAmountTotal: transactions.reduce((sum, row) => sum + row.amount, 0),
    };

    report.months.push(monthSummary);
    report.exceptions.invalidDateTransactions.push(...exceptions.invalidDateTransactions);
    report.exceptions.blankDateTransactions.push(...exceptions.blankDateTransactions);
    report.exceptions.skippedRows.push(...exceptions.skippedRows);
    report.exceptions.negativeAmountTransactions.push(...exceptions.negativeAmountTransactions);
    report.exceptions.unknownCategoryCodes.push(...exceptions.unknownCategoryCodes);
    report.exceptions.blankCardTransactions.push(...exceptions.blankCardTransactions);
    report.exceptions.unresolvedPerfCodes.push(...exceptions.unresolvedPerfCodes);
    report.exceptions.cardRowsMissingName.push(...exceptions.cardRowsMissingName);
    report.exceptions.cardsAddedFromTransactions.push(...exceptions.cardsAddedFromTransactions);
    report.exceptions.unmappedTransactionCards.push(...exceptions.unmappedTransactionCards);
    report.exceptions.ownerAssumptions.push(...ownerWarnings.map(item => ({ ...item, sheet: sheet.name })));

    dataset.months.push(month);
    dataset.monthSettings.push({
      month,
      total_budget: monthSummary.totalBudget,
      toggles: {},
    });
    dataset.memos.push({
      month,
      memo: defaultMemoSqlObject(),
    });

    categoryMap.entries
      .sort((a, b) => a.code - b.code)
      .forEach((entry, index) => {
        dataset.categorySettings.push({
          month,
          name: entry.name,
          budget: entry.budget || 0,
          inactive: false,
          sort_order: index,
        });
      });

    cardSettings.entries.forEach((entry, index) => {
      dataset.cardSettings.push({
        month,
        name: entry.name,
        perf: entry.perf || 0,
        disc: entry.disc || 0,
        perf_default: entry.perfDefault === true,
        disc_default: entry.discDefault === true,
        owner: entry.owner || 'me',
        inactive: false,
        sort_order: index,
        sourceMemo: entry.memo || '',
      });
    });

    transactions.forEach((txn, index) => {
      dataset.transactions.push({
        month,
        sort_order: index,
        date: txn.date,
        item: txn.item,
        amount: txn.amount,
        shop: txn.shop,
        card: txn.card,
        category: txn.category,
        perf: txn.perf,
        disc: txn.disc,
        status: txn.status,
        memo: '',
        source: txn.source,
      });
    });
  }

  report.totals.importedTransactions = dataset.transactions.length;
  report.totals.transactionsInReport = dataset.transactions.length + report.exceptions.invalidDateTransactions.length;
  dataset.manualRows = report.exceptions.invalidDateTransactions.map(row => ({
    sheet: row.sheet,
    row: row.row,
    rawDate: row.rawDate,
    item: row.item,
    amount: row.amount,
  }));

  dataset.months.sort();
  return { dataset, report };
}

async function main() {
  ensureFileExists(workbookPath);
  ensureFileExists(extractorPath);
  await fsp.mkdir(migrationDir, { recursive: true });

  const workbookJson = runExtractor();
  const workbook = JSON.parse(workbookJson);
  const { dataset, report } = buildDataset(workbook);

  const clearSql = createClearSql();
  const importSql = createImportSql(dataset);

  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2));
  await fsp.writeFile(clearSqlPath, clearSql);
  await fsp.writeFile(importSqlPath, importSql);

  const summary = {
    mode,
    workbook: workbookPath,
    months: dataset.months,
    importedTransactions: dataset.transactions.length,
    monthTransactionCounts: Object.fromEntries(report.months.map(month => [month.month, month.transactionCount])),
    invalidDateRows: report.exceptions.invalidDateTransactions.length,
    blankDateRows: report.exceptions.blankDateTransactions.length,
    negativeAmountRows: report.exceptions.negativeAmountTransactions.length,
    unknownCategoryRows: report.exceptions.unknownCategoryCodes.length,
    unresolvedPerfRows: report.exceptions.unresolvedPerfCodes.length,
    outputFiles: {
      reportPath,
      clearSqlPath,
      importSqlPath,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error('[migrate-2026]', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
