/**
 * api.js — GAS 통신 레이어
 * 모든 데이터 요청은 이 파일을 통해 처리
 * GAS_URL 을 실제 배포 URL로 교체하면 바로 연동됨
 */

const API = (() => {
  // ★ 배포 후 실제 GAS 웹앱 URL로 교체
  const GAS_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';

  // 로컬 캐시 (localStorage)
  const CACHE_PREFIX = 'ledger_';
  const CACHE_TTL = 5 * 60 * 1000; // 5분

  function cacheKey(action, month) {
    return CACHE_PREFIX + action + '_' + month;
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
    try {
      localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
    } catch {}
  }

  function clearCacheForMonth(month) {
    Object.keys(localStorage)
      .filter(k => k.startsWith(CACHE_PREFIX) && k.includes(month))
      .forEach(k => localStorage.removeItem(k));
  }

  /**
   * GAS 호출 공통 함수
   * @param {string} action
   * @param {object} params
   * @param {boolean} useCache
   */
  async function call(action, params = {}, useCache = false) {
    const month = params.month || APP_STATE.currentMonth;
    const ck = cacheKey(action, month);

    if (useCache) {
      const cached = getCache(ck);
      if (cached) return cached;
    }

    const url = new URL(GAS_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => {
      url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
    });

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('API 오류: ' + res.status);
    const json = await res.json();
    if (json.error) throw new Error(json.error);

    if (useCache) setCache(ck, json.data);
    return json.data;
  }

  async function post(action, body = {}) {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    if (!res.ok) throw new Error('API 오류: ' + res.status);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    clearCacheForMonth(body.month || APP_STATE.currentMonth);
    return json.data;
  }

  return {
    // 월 목록 조회
    getMonths: () => call('getMonths', {}, true),

    // 새 월 생성 (전월 메모/설정 복사)
    createMonth: (month) => post('createMonth', { month }),

    // 거래 내역 조회
    getTransactions: (month) => call('getTransactions', { month }, true),

    // 거래 내역 저장 (월 전체 덮어쓰기)
    saveTransactions: (month, rows) => post('saveTransactions', { month, rows }),

    // 메모 조회
    getMemo: (month) => call('getMemo', { month }, true),

    // 메모 저장
    saveMemo: (month, memo) => post('saveMemo', { month, memo }),

    // 설정 조회 (카드, 구분, 토글)
    getSettings: () => call('getSettings', {}, true),

    // 설정 저장
    saveSettings: (settings) => post('saveSettings', { settings }),

    // 대시보드 집계 (GAS에서 계산)
    getSummary: (month) => call('getSummary', { month }, true),

    clearCacheForMonth,
  };
})();