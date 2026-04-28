/**
 * api.js — GAS 통신 레이어 (GET only — CORS 우회)
 * GAS 웹앱은 POST preflight CORS를 지원하지 않으므로
 * 모든 요청(읽기/쓰기)을 GET + URL 파라미터로 처리
 */

const API = (() => {
  // ★ 배포 후 실제 GAS 웹앱 URL로 교체
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbzRyS2tuBtUaTbhtu3-VtYzQiXCL8LlPuzEW_QxvwavVC-njEKlaYNTRnSqm1h4nRO3/exec';

  const CACHE_PREFIX = 'ledger_';
  const CACHE_TTL = 5 * 60 * 1000;

  function cacheKey(action, month) {
    return CACHE_PREFIX + action + '_' + (month || 'global');
  }

  function getCache(key) {
    try {
      const item = localStorage.getItem(key);
      if (!item) return null;
      const { data, ts } = JSON.parse(item);
      if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(key); return null; }
      return data;
    } catch { return null; }
  }

  function setCache(key, data) {
    try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
  }

  function clearCacheForMonth(month) {
    Object.keys(localStorage)
      .filter(k => k.startsWith(CACHE_PREFIX) && (!month || k.includes(month)))
      .forEach(k => localStorage.removeItem(k));
  }

  // 모든 요청을 GET으로 — GAS doGet에서 action으로 분기
  async function call(action, params = {}, useCache = false) {
    const month = params.month || (APP_STATE && APP_STATE.currentMonth) || '';
    const ck = cacheKey(action, month);

    if (useCache) {
      const cached = getCache(ck);
      if (cached !== null) return cached;
    }

    const url = new URL(GAS_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => {
      url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    });

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('API 오류: ' + res.status);
    const json = await res.json();
    if (json.error) throw new Error(json.error);

    if (useCache) setCache(ck, json.data);
    return json.data;
  }

  // 쓰기 요청도 GET으로 — body를 JSON 문자열로 파라미터에 담아서 전송
  async function write(action, body = {}) {
    const month = body.month || (APP_STATE && APP_STATE.currentMonth) || '';
    const url = new URL(GAS_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('payload', JSON.stringify(body));

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('API 오류: ' + res.status);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    clearCacheForMonth(month);
    return json.data;
  }

  return {
    getMonths:        ()             => call('getMonths', {}, true),
    createMonth:      (month)        => write('createMonth', { month }),
    getTransactions:  (month)        => call('getTransactions', { month }, true),
    saveTransactions: (month, rows)  => write('saveTransactions', { month, rows }),
    getMemo:          (month)        => call('getMemo', { month }, true),
    saveMemo:         (month, memo)  => write('saveMemo', { month, memo }),
    getSettings:      ()             => call('getSettings', {}, true),
    saveSettings:     (settings)     => write('saveSettings', { settings }),
    getSummary:       (month)        => call('getSummary', { month }, true),
    clearCacheForMonth,
  };
})();