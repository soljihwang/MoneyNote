/**
 * api.js — GAS 통신 레이어 (GET only — CORS 우회)
 * GAS 웹앱은 POST preflight CORS를 지원하지 않으므로
 * 모든 요청(읽기/쓰기)을 GET + URL 파라미터로 처리
 */

const API = (() => {
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbzRyS2tuBtUaTbhtu3-VtYzQiXCL8LlPuzEW_QxvwavVC-njEKlaYNTRnSqm1h4nRO3/exec';

  const CACHE_PREFIX = 'ledger_';
  const CACHE_TTL = 5 * 60 * 1000;

  // GET URL 안정성 기준
  // 한글/특수문자는 URL 인코딩 시 길이가 크게 늘어나므로 작게 잡습니다.
  const TX_CHUNK_SIZE = 5;
  const MAX_URL_LENGTH = 1800;

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

    // 캐시 방지
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

    // 거래내역 저장은 무조건 작은 단위로 쪼갭니다.
    // 기존 방식은 JSON 문자열 길이만 보고 판단해서 한글 URL 인코딩 후 400 오류가 날 수 있었습니다.
    if (action === 'saveTransactions' && Array.isArray(body.rows)) {
      return writeTransactionsInChunks(body.month, body.rows);
    }

    return writeOnce(action, body, month);
  }

  async function writeTransactionsInChunks(month, rows) {
    const safeRows = Array.isArray(rows) ? rows : [];

    // 첫 요청은 기존 시트 내용을 지우고 첫 chunk 저장
    // 이후 요청은 appendTransactions로 이어 붙임
    if (safeRows.length === 0) {
      return writeOnce('saveTransactions', { month, rows: [] }, month);
    }

    let last = null;

    for (let i = 0; i < safeRows.length; i += TX_CHUNK_SIZE) {
      const chunk = safeRows.slice(i, i + TX_CHUNK_SIZE);
      const chunkAction = i === 0 ? 'saveTransactions' : 'appendTransactions';
      const chunkBody = { month, rows: chunk };

      // 혹시 chunk 5개도 URL이 길면 1개씩 재분할
      const testUrl = buildUrl(chunkAction, { payload: chunkBody }).toString();
      if (testUrl.length > MAX_URL_LENGTH && chunk.length > 1) {
        for (let j = 0; j < chunk.length; j += 1) {
          const oneAction = i === 0 && j === 0 ? 'saveTransactions' : 'appendTransactions';
          last = await writeOnce(oneAction, { month, rows: [chunk[j]] }, month);
        }
      } else {
        last = await writeOnce(chunkAction, chunkBody, month);
      }
    }

    clearCacheForMonth(month);
    return last || { ok: true, count: safeRows.length };
  }

  async function writeOnce(action, body, month) {
    const url = buildUrl(action, {
      payload: body,
    });

    if (url.toString().length > MAX_URL_LENGTH && action !== 'saveTransactions' && action !== 'appendTransactions') {
      console.warn('[API] URL이 긴 요청입니다:', action, url.toString().length);
    }

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

  function sanitizeMemo(memo) {
    const m = JSON.parse(JSON.stringify(memo || {}));

    if (m.cards) {
      m.cards.forEach(card => {
        if (card.images) {
          card.images = card.images.map(img => ({ name: img.name || '' }));
        }
      });
    }

    if (m.images) {
      m.images = m.images.map(img => ({ name: img.name || '' }));
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
        perfDefault: !!card.perfDefault,
        discDefault: !!card.discDefault,
        owner: card.owner || 'me',
        inactive: !!card.inactive,
      }));
    }

    if (Array.isArray(s.categories)) {
      s.categories = s.categories.map(cat => ({
        name: cat.name || '',
        budget: Number(cat.budget || 0),
        inactive: !!cat.inactive,
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