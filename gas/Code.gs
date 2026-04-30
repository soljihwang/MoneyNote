/**
 * Code.gs — MoneyNote GAS Backend
 *
 * 중요:
 * - SHEET_ID는 Apps Script 스크립트 속성에서 읽습니다.
 * - 거래내역 저장은 임시 시트에 먼저 저장한 뒤, 최종 커밋 시 월 시트를 교체합니다.
 * - 기존 월 시트는 바로 삭제하지 않고 월별 백업 시트로 1개만 보관합니다.
 * - _TMP_TX_ 시트는 정상 저장 후 월 시트로 이름이 바뀌므로 남지 않는 것이 정상입니다.
 * - 실패한 _TMP_TX_ 시트는 1시간 이상 지난 것만 자동 정리합니다.
 * - _BACKUP_TX_YYYYMM 시트는 월별 1개만 유지됩니다.
 */

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

      case 'beginTransactionsSave':
        result = beginTransactionsSave(payload.month, payload.token);
        break;

      case 'appendTransactionsDraft':
        result = appendTransactionsDraft(payload.month, payload.token, payload.rows);
        break;

      case 'commitTransactionsSave':
        result = commitTransactionsSave(payload.month, payload.token, payload.expectedCount);
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
  return jsonResponse({ error: 'POST는 사용하지 않습니다. GET action으로 호출해주세요.' });
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

function safeSheetNamePart(value) {
  return String(value || '')
    .replace(/[^0-9A-Za-z가-힣_-]/g, '')
    .slice(0, 40);
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

/**
 * 구버전 호환용.
 * 직접 월 시트를 먼저 비우지 않고 안전 저장 플로우를 내부에서 사용합니다.
 */
function saveTransactions(month, rows) {
  if (!month || !rows) throw new Error('파라미터 없음');

  var token = 'legacy_' + Date.now();

  beginTransactionsSave(month, token);
  appendTransactionsDraft(month, token, rows);

  return commitTransactionsSave(month, token, rows.length);
}

/**
 * 구버전 appendTransactions는 위험해서 비활성화합니다.
 */
function appendTransactions(month, rows) {
  throw new Error('appendTransactions 직접 호출은 비활성화되었습니다. beginTransactionsSave 플로우를 사용하세요.');
}

function beginTransactionsSave(month, token) {
  if (!month || !token) throw new Error('month/token 파라미터 없음');

  month = normalizeMonthValue(month) || month;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss = getSpreadsheet();
    var tempName = getTempTxSheetName(month, token);

    var oldTemp = ss.getSheetByName(tempName);
    if (oldTemp) {
      ss.deleteSheet(oldTemp);
    }

    var tempSheet = ss.insertSheet(tempName);
    ensureTransactionHeader(tempSheet);

    return {
      ok: true,
      tempSheet: tempName
    };
  } finally {
    lock.releaseLock();
  }
}

function appendTransactionsDraft(month, token, rows) {
  if (!month || !token || !rows) throw new Error('month/token/rows 파라미터 없음');

  month = normalizeMonthValue(month) || month;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss = getSpreadsheet();
    var tempName = getTempTxSheetName(month, token);
    var sheet = ss.getSheetByName(tempName);

    if (!sheet) {
      throw new Error('임시 저장 시트가 없습니다: ' + tempName);
    }

    ensureTransactionHeader(sheet);

    if (!rows.length) {
      return {
        ok: true,
        count: 0
      };
    }

    var values = rows.map(rowToTransactionValues);
    var startRow = Math.max(sheet.getLastRow() + 1, 2);

    sheet.getRange(startRow, 1, values.length, TX_HEADERS.length).setValues(values);

    return {
      ok: true,
      count: rows.length
    };
  } finally {
    lock.releaseLock();
  }
}

function commitTransactionsSave(month, token, expectedCount) {
  if (!month || !token) throw new Error('month/token 파라미터 없음');

  month = normalizeMonthValue(month) || month;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  var backupName = getBackupTxSheetName(month);
  var oldRenamedToBackup = false;

  try {
    var ss = getSpreadsheet();
    var tempName = getTempTxSheetName(month, token);
    var tempSheet = ss.getSheetByName(tempName);

    if (!tempSheet) {
      throw new Error('커밋할 임시 저장 시트가 없습니다: ' + tempName);
    }

    ensureTransactionHeader(tempSheet);

    var tempCount = Math.max(tempSheet.getLastRow() - 1, 0);
    expectedCount = Number(expectedCount || 0);

    if (tempCount !== expectedCount) {
      throw new Error('임시 저장 건수 불일치: expected=' + expectedCount + ', actual=' + tempCount);
    }

    var oldSheet = ss.getSheetByName(month);
    var oldBackup = ss.getSheetByName(backupName);

    // 백업은 월별 1개만 유지합니다.
    if (oldBackup) {
      ss.deleteSheet(oldBackup);
    }

    if (oldSheet) {
      oldSheet.setName(backupName);
      oldRenamedToBackup = true;
    }

    tempSheet.setName(month);
    ensureTransactionHeader(tempSheet);

    var monthsSheet = getOrCreateSheet('MONTHS', ss);
    var existing = monthsSheet.getDataRange().getValues().map(function(r) {
      return normalizeMonthValue(r[0]);
    });

    if (existing.indexOf(month) < 0) {
      monthsSheet.appendRow([month]);
    }

    // 중요:
    // 여기서 다른 _TMP_TX_ 시트를 삭제하면 안 됩니다.
    // 동시에 진행 중인 다른 저장 요청의 임시 시트를 지우면
    // "임시 저장 시트가 없습니다" 오류가 발생할 수 있습니다.
    cleanupStaleTempTransactionSheets(month, 60 * 60 * 1000);

    return {
      ok: true,
      count: tempCount,
      backupSheet: backupName
    };
  } catch (err) {
    try {
      var ss2 = getSpreadsheet();
      var monthSheet = ss2.getSheetByName(month);
      var backupSheet = ss2.getSheetByName(backupName);

      if (!monthSheet && backupSheet && oldRenamedToBackup) {
        backupSheet.setName(month);
      }
    } catch (restoreErr) {}

    throw err;
  } finally {
    lock.releaseLock();
  }
}

function cleanupStaleTempTransactionSheets(month, maxAgeMs) {
  var ss = getSpreadsheet();
  var safeMonth = safeSheetNamePart(normalizeMonthValue(month) || month);
  var prefix = '_TMP_TX_' + safeMonth + '_';
  var now = Date.now();

  ss.getSheets().forEach(function(sheet) {
    var name = sheet.getName();

    if (name.indexOf(prefix) !== 0) return;

    var tokenPart = name.substring(prefix.length);
    var tsMatch = tokenPart.match(/^(\d{10,})_/);

    // token에서 생성 시간을 읽을 수 없는 TMP는 건드리지 않습니다.
    if (!tsMatch) return;

    var createdAt = Number(tsMatch[1]);

    // 1시간 이상 지난 실패 TMP만 삭제합니다.
    if (createdAt && now - createdAt > maxAgeMs) {
      ss.deleteSheet(sheet);
    }
  });
}

function getTempTxSheetName(month, token) {
  return '_TMP_TX_' + safeSheetNamePart(month) + '_' + safeSheetNamePart(token);
}

function getBackupTxSheetName(month) {
  return '_BACKUP_TX_' + safeSheetNamePart(month);
}

function ensureTransactionHeader(sheet) {
  sheet.getRange(1, 1, 1, TX_HEADERS.length).setValues([TX_HEADERS]);
}

function rowToTransactionValues(r) {
  r = r || {};

  return TX_HEADERS.map(function(h) {
    if (h === 'date') return normalizeDateValue(r[h]);

    if (h === 'amount') {
      return r[h] !== undefined && r[h] !== '' ? Number(r[h]) : '';
    }

    if (h === 'perf' || h === 'disc') {
      return r[h] === true || r[h] === 'TRUE' || r[h] === 'true' || r[h] === 1;
    }

    return r[h] !== undefined && r[h] !== null ? String(r[h]) : '';
  });
}

// ── 메모 ───────────────────────────────────────────────────

function getMemoSheetName(month) {
  return month === 'GLOBAL' ? 'MEMO_GLOBAL' : 'MEMO_' + month;
}

function getMemo(month) {
  if (!month) return defaultMemo();

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(getMemoSheetName(month));

  if (!sheet || sheet.getLastRow() === 0) {
    return defaultMemo();
  }

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
      if (key === 'freeText') {
        memo.freeText = String(val || '');
      }
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
  lock.waitLock(30000);

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

    return {
      ok: true
    };
  } finally {
    lock.releaseLock();
  }
}

function sanitizeMemoForSheet(memo) {
  var copied = JSON.parse(JSON.stringify(memo || {}));

  // dataUrl은 URL 길이 문제 때문에 서버에 저장하지 않습니다.
  if (copied.cards) {
    copied.cards = copied.cards.map(function(card) {
      if (card.images) {
        card.images = card.images.map(function(img) {
          return {
            name: img.name || ''
          };
        });
      }

      return card;
    });
  }

  if (copied.images) {
    copied.images = copied.images.map(function(img) {
      return {
        name: img.name || ''
      };
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

  if (!sheet || sheet.getLastRow() === 0) {
    return null;
  }

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
  lock.waitLock(30000);

  try {
    var ss = getSpreadsheet();
    var sheet = getOrCreateSheet('META', ss);

    settings = normalizeSettingsForSave(settings);

    var rows = Object.keys(settings).map(function(k) {
      return [k, JSON.stringify(settings[k])];
    });

    sheet.clearContents();

    if (rows.length) {
      sheet.getRange(1, 1, rows.length, 2).setValues(rows);
    }

    return {
      ok: true
    };
  } finally {
    lock.releaseLock();
  }
}

function normalizeSettingsForSave(settings) {
  settings = settings || {};

  if (settings.cards) {
    settings.cards = settings.cards.map(function(card) {
      return {
        name: card.name || '',
        perf: Number(card.perf || 0),
        disc: Number(card.disc || 0),
        perfDefault: card.perfDefault !== false,
        discDefault: card.discDefault === true,
        owner: card.owner || 'me',
        inactive: card.inactive === true
      };
    });
  }

  if (settings.categories) {
    settings.categories = settings.categories.map(function(cat) {
      return {
        name: cat.name || '',
        budget: Number(cat.budget || 0),
        inactive: cat.inactive === true
      };
    });
  }

  settings.totalBudget = Number(settings.totalBudget || 0);
  settings.toggles = settings.toggles || {};

  return settings;
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
      cardMap[r.card] = {
        perf: 0,
        disc: 0,
        total: 0
      };
    }

    cardMap[r.card].total += amt;

    if (r.perf) {
      cardMap[r.card].perf += amt;
    }

    if (r.disc) {
      cardMap[r.card].disc += amt;
    }
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
  n = Number(n);
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

  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (iso) {
    return iso[1] + '-' + iso[2] + '-' + iso[3];
  }

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