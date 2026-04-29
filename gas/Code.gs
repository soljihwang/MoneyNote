/**
 * Code.gs — 가계부 GAS 백엔드
 *
 * 시트 구조:
 *   [META]         — 설정 데이터 (카드, 구분, 토글)
 *   [MONTHS]       — 월 목록
 *   [2025-04]      — 월별 거래 내역 시트 (시트명 = YYYY-MM)
 *   [MEMO_2025-04] — 월별 메모 시트
 *   [MEMO_GLOBAL]  — 월 귀속 없는 기타/공통 메모 시트
 *
 * 중요:
 *   - 스프레드시트 ID는 코드에 직접 쓰지 않고 Apps Script 스크립트 속성 SHEET_ID에서 가져옵니다.
 *   - Code.gs 수정 후에는 Apps Script에서 반드시 새 버전으로 재배포해야 실제 웹앱에 반영됩니다.
 */

// ── 진입점 ─────────────────────────────────────────────────
function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : '';
  var result;

  try {
    var payload = {};
    if (e.parameter.payload) {
      try {
        payload = JSON.parse(e.parameter.payload);
      } catch (pe) {
        throw new Error('payload JSON 파싱 실패: ' + pe.message);
      }
    }

    switch (action) {
      case 'getMonths':
        result = getMonths();
        break;
      case 'getTransactions':
        result = getTransactions(e.parameter.month);
        break;
      case 'getMemo':
        result = getMemo(e.parameter.month);
        break;
      case 'getSettings':
        result = getSettings();
        break;
      case 'getSummary':
        result = getSummary(e.parameter.month);
        break;
      case 'createMonth':
        result = createMonth(payload.month);
        break;
      case 'saveTransactions':
        result = saveTransactions(payload.month, payload.rows);
        break;
      case 'appendTransactions':
        result = appendTransactions(payload.month, payload.rows);
        break;
      case 'saveMemo':
        result = saveMemo(payload.month, payload.memo);
        break;
      case 'saveSettings':
        result = saveSettings(payload.settings);
        break;
      default:
        throw new Error('unknown action: ' + action);
    }

    return jsonResponse({ data: result });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPost(e) {
  var body;

  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ error: 'JSON 파싱 실패: ' + err.message });
  }

  var action = body.action;
  var result;

  try {
    switch (action) {
      case 'createMonth':
        result = createMonth(body.month);
        break;
      case 'saveTransactions':
        result = saveTransactions(body.month, body.rows);
        break;
      case 'appendTransactions':
        result = appendTransactions(body.month, body.rows);
        break;
      case 'saveMemo':
        result = saveMemo(body.month, body.memo);
        break;
      case 'saveSettings':
        result = saveSettings(body.settings);
        break;
      default:
        throw new Error('unknown action: ' + action);
    }

    return jsonResponse({ data: result });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 스프레드시트 접근 ───────────────────────────────────────
function getSpreadsheet() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) {
    throw new Error('스크립트 속성 SHEET_ID가 설정되지 않았습니다.');
  }
  return SpreadsheetApp.openById(sheetId);
}

function getOrCreateSheet(name, ss) {
  var s = ss || getSpreadsheet();
  var sheet = s.getSheetByName(name);
  if (!sheet) {
    sheet = s.insertSheet(name);
  }
  return sheet;
}

// ── 월 목록 ────────────────────────────────────────────────
function getMonths() {
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet('MONTHS', ss);
  var data = sheet.getDataRange().getValues();

  var months = data.map(function(r) {
    return normalizeMonthValue(r[0]);
  }).filter(function(v) {
    return v;
  });

  if (!months.length) {
    var now = new Date();
    var ym = now.getFullYear() + '-' + pad(now.getMonth() + 1);
    months = [ym];
    sheet.appendRow([ym]);
  }

  return months.reverse();
}

// ── 월 생성 ────────────────────────────────────────────────
function createMonth(month) {
  if (!month) throw new Error('month 파라미터 없음');

  month = normalizeMonthValue(month);
  if (!month) throw new Error('month 형식 오류');

  var ss = getSpreadsheet();

  var monthsSheet = getOrCreateSheet('MONTHS', ss);
  var existing = monthsSheet.getDataRange().getValues().map(function(r) {
    return normalizeMonthValue(r[0]);
  });

  if (existing.indexOf(month) < 0) {
    monthsSheet.appendRow([month]);
  }

  var txSheet = getOrCreateSheet(month, ss);
  ensureTransactionHeader(txSheet);

  var prevMonth = calcPrevMonth(month);
  var prevMemoSheet = ss.getSheetByName('MEMO_' + prevMonth);
  var newMemoSheet = getOrCreateSheet('MEMO_' + month, ss);

  if (prevMemoSheet && newMemoSheet.getLastRow() === 0) {
    var prevData = prevMemoSheet.getDataRange().getValues();
    if (prevData.length) {
      newMemoSheet.getRange(1, 1, prevData.length, prevData[0].length).setValues(prevData);
    }
  }

  return { ok: true, month: month };
}

function calcPrevMonth(ym) {
  var parts = ym.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);

  if (m === 1) {
    y -= 1;
    m = 12;
  } else {
    m -= 1;
  }

  return y + '-' + pad(m);
}

// ── 거래 내역 ───────────────────────────────────────────────
var TX_HEADERS = ['date', 'item', 'amount', 'shop', 'card', 'category', 'perf', 'disc', 'status', 'memo'];

function getTransactions(month) {
  if (!month) return [];

  month = normalizeMonthValue(month) || month;

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(month);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, TX_HEADERS.length).getValues();

  return data.map(function(row) {
    var obj = {};
    TX_HEADERS.forEach(function(h, i) {
      obj[h] = row[i];
    });
    obj.date = normalizeDateValue(obj.date);
    obj.perf = obj.perf === true || obj.perf === 'TRUE' || obj.perf === 1 || obj.perf === 'true';
    obj.disc = obj.disc === true || obj.disc === 'TRUE' || obj.disc === 1 || obj.disc === 'true';
    obj.amount = obj.amount ? Number(obj.amount) : 0;
    return obj;
  }).filter(function(r) {
    return r.item || r.amount;
  });
}

function saveTransactions(month, rows) {
  if (!month || !rows) throw new Error('파라미터 없음');

  month = normalizeMonthValue(month) || month;

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var ss = getSpreadsheet();
    var sheet = getOrCreateSheet(month, ss);

    ensureTransactionHeader(sheet);

    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, TX_HEADERS.length).clearContent();
    }

    if (!rows.length) {
      return { ok: true, count: 0 };
    }

    var values = rows.map(rowToTransactionValues);
    sheet.getRange(2, 1, values.length, TX_HEADERS.length).setValues(values);

    return { ok: true, count: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function appendTransactions(month, rows) {
  if (!month || !rows) throw new Error('파라미터 없음');

  month = normalizeMonthValue(month) || month;

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var ss = getSpreadsheet();
    var sheet = getOrCreateSheet(month, ss);

    ensureTransactionHeader(sheet);

    if (!rows.length) {
      return { ok: true, count: 0 };
    }

    var values = rows.map(rowToTransactionValues);
    var startRow = Math.max(sheet.getLastRow() + 1, 2);
    sheet.getRange(startRow, 1, values.length, TX_HEADERS.length).setValues(values);

    return { ok: true, count: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function ensureTransactionHeader(sheet) {
  sheet.getRange(1, 1, 1, TX_HEADERS.length).setValues([TX_HEADERS]);
}

function rowToTransactionValues(r) {
  return TX_HEADERS.map(function(h) {
    if (h === 'date') return normalizeDateValue(r[h]);
    if (h === 'amount') return r[h] !== undefined && r[h] !== '' ? Number(r[h]) : '';
    if (h === 'perf' || h === 'disc') return r[h] === true || r[h] === 'TRUE' || r[h] === 'true' || r[h] === 1;
    return r[h] !== undefined && r[h] !== null ? r[h] : '';
  });
}

// ── 메모 ───────────────────────────────────────────────────
// 메모 시트 구조: A열=섹션, B열=JSON 또는 텍스트
// 섹션: cards, payments, checklist, benefits, freeText, images

function getMemoSheetName(month) {
  return month === 'GLOBAL' ? 'MEMO_GLOBAL' : 'MEMO_' + month;
}

function getMemo(month) {
  if (!month) return defaultMemo();

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(getMemoSheetName(month));
  if (!sheet || sheet.getLastRow() === 0) return defaultMemo();

  var data = sheet.getDataRange().getValues();
  var memo = defaultMemo();

  data.forEach(function(row) {
    var key = row[0];
    var val = row[1];
    if (!key) return;

    try {
      if (key === 'freeText') {
        memo.freeText = String(val || '');
      } else {
        memo[key] = JSON.parse(val || '[]');
      }
    } catch (e) {
      if (key === 'freeText') memo.freeText = String(val || '');
    }
  });

  if (!memo.cards) memo.cards = [];
  if (!memo.payments) memo.payments = [];
  if (!memo.checklist) memo.checklist = [];
  if (!memo.benefits) memo.benefits = [];
  if (!memo.images) memo.images = [];

  return memo;
}

function saveMemo(month, memo) {
  if (!month || !memo) throw new Error('파라미터 없음');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var ss = getSpreadsheet();
    var sheet = getOrCreateSheet(getMemoSheetName(month), ss);

    var safeMemo = sanitizeMemoForSheet(memo);

    var rows = [
      ['cards', JSON.stringify(safeMemo.cards || [])],
      ['payments', JSON.stringify(safeMemo.payments || [])],
      ['checklist', JSON.stringify(safeMemo.checklist || [])],
      ['benefits', JSON.stringify(safeMemo.benefits || [])],
      ['freeText', safeMemo.freeText || ''],
      ['images', JSON.stringify(safeMemo.images || [])]
    ];

    sheet.clearContents();
    sheet.getRange(1, 1, rows.length, 2).setValues(rows);

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function sanitizeMemoForSheet(memo) {
  var copied = JSON.parse(JSON.stringify(memo || {}));

  if (copied.cards) {
    copied.cards = copied.cards.map(function(card) {
      if (card.images) {
        card.images = card.images.map(function(img) {
          return { name: img.name || '' };
        });
      }
      return card;
    });
  }

  if (copied.images) {
    copied.images = copied.images.map(function(img) {
      return { name: img.name || '' };
    });
  }

  return copied;
}

function defaultMemo() {
  return {
    payments: [],
    checklist: [],
    benefits: [],
    freeText: '',
    images: [],
    cards: []
  };
}

// ── 설정 ───────────────────────────────────────────────────
function getSettings() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('META');
  if (!sheet || sheet.getLastRow() === 0) return null;

  var data = sheet.getDataRange().getValues();
  var settings = {};

  data.forEach(function(row) {
    var key = row[0];
    var val = row[1];
    if (!key) return;

    try {
      settings[key] = JSON.parse(val);
    } catch (e) {
      settings[key] = val;
    }
  });

  if (settings.cards) {
    settings.cards = settings.cards.map(function(card) {
      if (!card.owner) card.owner = 'me';
      return card;
    });
  }

  return settings;
}

function saveSettings(settings) {
  if (!settings) throw new Error('settings 없음');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var ss = getSpreadsheet();
    var sheet = getOrCreateSheet('META', ss);

    if (settings.cards) {
      settings.cards = settings.cards.map(function(card) {
        if (!card.owner) card.owner = 'me';
        return card;
      });
    }

    var rows = Object.keys(settings).map(function(k) {
      return [k, JSON.stringify(settings[k])];
    });

    sheet.clearContents();

    if (rows.length) {
      sheet.getRange(1, 1, rows.length, 2).setValues(rows);
    }

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ── 대시보드 집계 ───────────────────────────────────────────
function getSummary(month) {
  var rows = getTransactions(month);
  var settings = getSettings() || {};
  var cards = settings.cards || [];

  var total = 0;
  var cardMap = {};

  rows.forEach(function(r) {
    var amt = Number(r.amount) || 0;
    total += amt;

    if (!cardMap[r.card]) {
      cardMap[r.card] = { perf: 0, disc: 0, total: 0 };
    }

    cardMap[r.card].total += amt;
    if (r.perf) cardMap[r.card].perf += amt;
    if (r.disc) cardMap[r.card].disc += amt;
  });

  var catMap = {};

  rows.forEach(function(r) {
    var cat = r.category || '-';
    catMap[cat] = (catMap[cat] || 0) + (Number(r.amount) || 0);
  });

  return {
    total: total,
    cardMap: cardMap,
    catMap: catMap,
    cards: cards
  };
}

// ── 유틸 ───────────────────────────────────────────────────
function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function normalizeMonthValue(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value.getFullYear() + '-' + pad(value.getMonth() + 1);
  }

  var s = String(value).trim();
  var match = s.match(/^(\d{4})[-/.](\d{1,2})/);
  if (match) {
    return match[1] + '-' + pad(Number(match[2]));
  }

  return s;
}

function normalizeDateValue(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate());
  }

  var s = String(value).trim();

  var full = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (full) {
    return full[1] + '-' + pad(Number(full[2])) + '-' + pad(Number(full[3]));
  }

  var short = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (short) {
    var now = new Date();
    return now.getFullYear() + '-' + pad(Number(short[1])) + '-' + pad(Number(short[2]));
  }

  return s;
}