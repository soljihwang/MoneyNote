/**
 * Code.gs — 가계부 GAS 백엔드
 *
 * 시트 구조:
 *   [META]         — 설정 데이터 (카드, 구분, 토글)
 *   [MONTHS]       — 월 목록
 *   [2025-04]      — 월별 거래 내역 시트 (시트명 = YYYY-MM)
 *   [MEMO_2025-04] — 월별 메모 시트
 *
 * ★ SHEET_ID를 실제 스프레드시트 ID로 교체하세요
 */

var SHEET_ID = 'YOUR_SPREADSHEET_ID';

// ── 진입점 ─────────────────────────────────────────────────
function doGet(e) {
  var action = e.parameter.action;
  var result;
  try {
    // payload 파라미터가 있으면 쓰기 액션
    var payload = {};
    if (e.parameter.payload) {
      try { payload = JSON.parse(e.parameter.payload); } catch (pe) {}
    }

    switch (action) {
      case 'getMonths':        result = getMonths();                                              break;
      case 'getTransactions':  result = getTransactions(e.parameter.month);                       break;
      case 'getMemo':          result = getMemo(e.parameter.month);                               break;
      case 'getSettings':      result = getSettings();                                            break;
      case 'getSummary':       result = getSummary(e.parameter.month);                            break;
      case 'createMonth':      result = createMonth(payload.month);                               break;
      case 'saveTransactions': result = saveTransactions(payload.month, payload.rows);            break;
      case 'saveMemo':         result = saveMemo(payload.month, payload.memo);                    break;
      case 'saveSettings':     result = saveSettings(payload.settings);                           break;
      default:                 result = { error: 'unknown action: ' + action };                   break;
    }
  } catch (err) {
    result = { error: err.message };
  }
  return jsonResponse({ data: result });
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
      case 'createMonth':      result = createMonth(body.month);              break;
      case 'saveTransactions': result = saveTransactions(body.month, body.rows); break;
      case 'saveMemo':         result = saveMemo(body.month, body.memo);      break;
      case 'saveSettings':     result = saveSettings(body.settings);          break;
      default:                 result = { error: 'unknown action: ' + action }; break;
    }
  } catch (err) {
    result = { error: err.message };
  }
  return jsonResponse({ data: result });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 스프레드시트 접근 ───────────────────────────────────────
function getSpreadsheet() {
  return SpreadsheetApp.openById(SHEET_ID);
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
  var months = data.map(function(r) { return r[0]; }).filter(function(v) { return v; });
  if (!months.length) {
    var now = new Date();
    var ym = now.getFullYear() + '-' + pad(now.getMonth() + 1);
    months = [ym];
    sheet.appendRow([ym]);
  }
  return months.reverse(); // 최신 월이 앞으로
}

// ── 월 생성 ────────────────────────────────────────────────
function createMonth(month) {
  if (!month) throw new Error('month 파라미터 없음');
  var ss = getSpreadsheet();

  // MONTHS 시트에 추가
  var monthsSheet = getOrCreateSheet('MONTHS', ss);
  var existing = monthsSheet.getDataRange().getValues().map(function(r) { return r[0]; });
  if (existing.indexOf(month) < 0) {
    monthsSheet.appendRow([month]);
  }

  // 거래 내역 시트 생성
  getOrCreateSheet(month, ss);

  // 전월 메모 복사
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
  var y = parseInt(parts[0]);
  var m = parseInt(parts[1]);
  if (m === 1) { y -= 1; m = 12; }
  else { m -= 1; }
  return y + '-' + pad(m);
}

// ── 거래 내역 ───────────────────────────────────────────────
var TX_HEADERS = ['date','item','amount','shop','card','category','perf','disc','status','memo'];

function getTransactions(month) {
  if (!month) return [];
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(month);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, TX_HEADERS.length).getValues();
  return data.map(function(row) {
    var obj = {};
    TX_HEADERS.forEach(function(h, i) { obj[h] = row[i]; });
    obj.perf = obj.perf === true || obj.perf === 'TRUE' || obj.perf === 1;
    obj.disc = obj.disc === true || obj.disc === 'TRUE' || obj.disc === 1;
    obj.amount = obj.amount ? Number(obj.amount) : 0;
    return obj;
  }).filter(function(r) { return r.item || r.amount; });
}

function saveTransactions(month, rows) {
  if (!month || !rows) throw new Error('파라미터 없음');
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet(month, ss);

  sheet.clearContents();
  // 헤더
  sheet.getRange(1, 1, 1, TX_HEADERS.length).setValues([TX_HEADERS]);

  if (!rows.length) return { ok: true };

  var values = rows.map(function(r) {
    return TX_HEADERS.map(function(h) { return r[h] !== undefined ? r[h] : ''; });
  });
  sheet.getRange(2, 1, values.length, TX_HEADERS.length).setValues(values);
  return { ok: true, count: rows.length };
}

// ── 메모 ───────────────────────────────────────────────────
// 메모 시트 구조: A열=섹션, B열=JSON
// 섹션: payments, checklist, benefits, freeText, images

function getMemo(month) {
  if (!month) return defaultMemo();
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('MEMO_' + month);
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
    } catch (e) {}
  });
  return memo;
}

function saveMemo(month, memo) {
  if (!month || !memo) throw new Error('파라미터 없음');
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet('MEMO_' + month, ss);
  sheet.clearContents();

  var rows = [
    ['payments',  JSON.stringify(memo.payments  || [])],
    ['checklist', JSON.stringify(memo.checklist || [])],
    ['benefits',  JSON.stringify(memo.benefits  || [])],
    ['freeText',  memo.freeText || ''],
    ['images',    JSON.stringify((memo.images || []).map(function(img) {
      // dataUrl은 용량이 크므로 이름만 저장 (이미지 자체는 Drive에 별도 저장 권장)
      return { name: img.name, dataUrl: img.dataUrl };
    }))],
  ];
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  return { ok: true };
}

function defaultMemo() {
  return { payments: [], checklist: [], benefits: [], freeText: '', images: [] };
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
    try { settings[key] = JSON.parse(val); }
    catch (e) { settings[key] = val; }
  });
  return settings;
}

function saveSettings(settings) {
  if (!settings) throw new Error('settings 없음');
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet('META', ss);
  sheet.clearContents();

  var rows = Object.keys(settings).map(function(k) {
    return [k, JSON.stringify(settings[k])];
  });
  if (rows.length) {
    sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  }
  return { ok: true };
}

// ── 대시보드 집계 (선택적 — 프론트에서 계산해도 됨) ─────────
function getSummary(month) {
  var rows = getTransactions(month);
  var settings = getSettings() || {};
  var cards = settings.cards || [];

  var total = 0;
  var cardMap = {};
  rows.forEach(function(r) {
    var amt = Number(r.amount) || 0;
    total += amt;
    if (!cardMap[r.card]) cardMap[r.card] = { perf: 0, disc: 0, total: 0 };
    cardMap[r.card].total += amt;
    if (r.perf) cardMap[r.card].perf += amt;
    if (r.disc) cardMap[r.card].disc += amt;
  });

  var catMap = {};
  rows.forEach(function(r) {
    var cat = r.category || '-';
    catMap[cat] = (catMap[cat] || 0) + (Number(r.amount) || 0);
  });

  return { total: total, cardMap: cardMap, catMap: catMap };
}

// ── 유틸 ───────────────────────────────────────────────────
function pad(n) {
  return n < 10 ? '0' + n : String(n);
}