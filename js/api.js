/**
 * api.js — GAS 통신 레이어
 *
 * 중요:
 * - 모든 요청은 GET으로 처리합니다.
 * - 거래내역 저장은 안전 저장 플로우를 사용합니다.
 *   beginTransactionsSave → appendTransactionsDraft 여러 번 → commitTransactionsSave
 * - 메모 이미지는 GAS URL 길이 제한 때문에 dataUrl은 서버로 보내지 않고,
 *   split.js에서 브라우저 localStorage에 보관합니다.
 */

const API = (() => {
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbzRyS2tuBtUaTbhtu3-VtYzQiXCL8LlPuzEW_QxvwavVC-njEKlaYNTRnSqm1h4nRO3/exec';

  const CACHE_PREFIX = 'ledger_';
  const CACHE_TTL = 5 * 60 * 1000;

  const TX_CHUNK_SIZE = 3;

  function cacheKey(action, month) {
    return CACHE_PREFIX + action + '_' + (month || 'global');
  }

  function getCache(key) {
    try {
      const item = localStorage.getItem(key);
      if (!item) return null;

      const { data, ts } = JSON.parse(item);
      if (Date.now() - ts > CACHE_TTL) {
        localStorage.removeItem(key);
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }

  function setCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
    } catch {}
  }

  function clearCacheForMonth(month) {
    try {
      Object.keys(localStorage)
        .filter(k => {
          if (!k.startsWith(CACHE_PREFIX)) return false;
          if (!month) return true;
          return k.includes(month);
        })
        .forEach(k => localStorage.removeItem(k));
    } catch {}
  }

  function buildUrl(action, params = {}) {
    const url = new URL(GAS_URL);
    url.searchParams.set('action', action);

    Object.entries(params).forEach(([k, v]) => {
      url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    });

    url.searchParams.set('_t', String(Date.now()));
    return url;
  }

  async function call(action, params = {}, useCache = false) {
    const month = params.month || (APP_STATE && APP_STATE.currentMonth) || '';
    const ck = cacheKey(action, month);

    if (useCache) {
      const cached = getCache(ck);
      if (cached !== null) return cached;
    }

    const url = buildUrl(action, params);

    const res = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error('API 오류: ' + res.status);
    }

    const json = await res.json();

    if (json.error) {
      throw new Error(json.error);
    }

    if (useCache) {
      setCache(ck, json.data);
    }

    return json.data;
  }

  async function write(action, body) {
    body = body || {};
    const month = body.month || (APP_STATE && APP_STATE.currentMonth) || '';

    if (action === 'saveTransactions' && Array.isArray(body.rows)) {
      return saveTransactionsSafely(body.month, body.rows);
    }

    return writeOnce(action, body, month);
  }

  async function writeOnce(action, body, month) {
    const url = buildUrl(action, {
      payload: body,
    });

    const res = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error('API 오류: ' + res.status);
    }

    const json = await res.json();

    if (json.error) {
      throw new Error(json.error);
    }

    clearCacheForMonth(month);
    return json.data;
  }

  async function saveTransactionsSafely(month, rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const token = makeSaveToken();

    await writeOnce('beginTransactionsSave', { month, token }, month);

    for (let i = 0; i < safeRows.length; i += TX_CHUNK_SIZE) {
      const chunk = safeRows.slice(i, i + TX_CHUNK_SIZE);

      await writeOnce('appendTransactionsDraft', {
        month,
        token,
        rows: chunk,
      }, month);
    }

    const result = await writeOnce('commitTransactionsSave', {
      month,
      token,
      expectedCount: safeRows.length,
    }, month);

    clearCacheForMonth(month);
    return result;
  }

  function makeSaveToken() {
    return String(Date.now()) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function sanitizeMemo(memo) {
    const m = JSON.parse(JSON.stringify(memo || {}));

    if (m.cards) {
      m.cards.forEach(card => {
        if (card.images) {
          card.images = card.images.map(img => ({
            name: img.name || '',
          }));
        }
      });
    }

    if (m.images) {
      m.images = m.images.map(img => ({
        name: img.name || '',
      }));
    }

    return m;
  }

  function normalizeSettings(settings) {
    const s = JSON.parse(JSON.stringify(settings || {}));

    if (Array.isArray(s.cards)) {
      s.cards = s.cards.map(card => ({
        name: card.name || '',
        perf: Number(card.perf || 0),
        disc: Number(card.disc || 0),
        perfDefault: card.perfDefault !== false,
        discDefault: card.discDefault === true,
        owner: card.owner || 'me',
        inactive: card.inactive === true,
      }));
    }

    if (Array.isArray(s.categories)) {
      s.categories = s.categories.map(cat => ({
        name: cat.name || '',
        budget: Number(cat.budget || 0),
        inactive: cat.inactive === true,
      }));
    }

    s.totalBudget = Number(s.totalBudget || 0);
    s.toggles = s.toggles || {};

    return s;
  }

  return {
    getMonths: () => call('getMonths', {}, true),

    createMonth: month => write('createMonth', { month }),

    getTransactions: month => call('getTransactions', { month }, true),

    saveTransactions: (month, rows) => write('saveTransactions', { month, rows }),

    getMemo: month => call('getMemo', { month }, true),

    saveMemo: (month, memo) => write('saveMemo', {
      month,
      memo: sanitizeMemo(memo),
    }),

    getSettings: () => call('getSettings', {}, true),

    saveSettings: settings => {
      const normalized = normalizeSettings(settings);
      return write('saveSettings', { settings: normalized }).then(r => {
        clearCacheForMonth('');
        return r;
      });
    },

    getSummary: month => call('getSummary', { month }, true),

    clearCacheForMonth,
  };
})();