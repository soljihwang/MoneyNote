/**
 * api.js — Supabase API layer
 *
 * 1차 이전 범위:
 * - 월 목록 / 월 생성
 * - 거래내역 조회 / 저장
 * - 월별 설정 조회 / 저장
 * - 텍스트 메모 조회 / 저장
 *
 * 이미지 저장은 2차 작업으로 보류합니다.
 */

const API = (() => {
  const sb = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);

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

  function check(res) {
    if (res && res.error) {
      throw new Error(res.error.message || 'Supabase API error');
    }
  }

  function currentYearMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  async function settingsMonth() {
    if (typeof APP_STATE !== 'undefined' && APP_STATE.currentMonth) {
      return APP_STATE.currentMonth;
    }

    const months = await getMonths();
    const thisMonth = currentYearMonth();

    return months.includes(thisMonth) ? thisMonth : months[0] || thisMonth;
  }

  function defaultMemo() {
    return {
      payments: [],
      checklist: [],
      benefits: [],
      freeText: '',
      images: [],
      cards: [],
    };
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
    } else {
      s.cards = [];
    }

    if (Array.isArray(s.categories)) {
      s.categories = s.categories.map(cat => ({
        name: cat.name || '',
        budget: Number(cat.budget || 0),
        inactive: cat.inactive === true,
      }));
    } else {
      s.categories = [];
    }

    s.totalBudget = Number(s.totalBudget || 0);
    s.toggles = s.toggles || {};

    return s;
  }

  function fallbackSettings() {
    if (typeof defaultSettings === 'function') {
      return normalizeSettings(defaultSettings());
    }

    return normalizeSettings({});
  }

  function cardFromDb(row) {
    return {
      name: row.name || '',
      perf: Number(row.perf || 0),
      disc: Number(row.disc || 0),
      perfDefault: row.perf_default !== false,
      discDefault: row.disc_default === true,
      owner: row.owner || 'me',
      inactive: row.inactive === true,
    };
  }

  function cardToDb(month, card, sortOrder) {
    return {
      month,
      name: card.name || '',
      perf: Number(card.perf || 0),
      disc: Number(card.disc || 0),
      perf_default: card.perfDefault !== false,
      disc_default: card.discDefault === true,
      owner: card.owner || 'me',
      inactive: card.inactive === true,
      sort_order: sortOrder,
    };
  }

  function categoryFromDb(row) {
    return {
      name: row.name || '',
      budget: Number(row.budget || 0),
      inactive: row.inactive === true,
    };
  }

  function categoryToDb(month, cat, sortOrder) {
    return {
      month,
      name: cat.name || '',
      budget: Number(cat.budget || 0),
      inactive: cat.inactive === true,
      sort_order: sortOrder,
    };
  }

  async function getMonths() {
    const ck = cacheKey('getMonths', 'global');
    const cached = getCache(ck);
    if (cached !== null) return cached;

    const res = await sb
      .from('months')
      .select('month')
      .order('month', { ascending: false });

    check(res);

    let months = (res.data || []).map(r => r.month).filter(Boolean);

    if (!months.length) {
      const month = currentYearMonth();
      await createMonth(month);
      months = [month];
    }

    setCache(ck, months);
    return months;
  }

  async function createMonth(month) {
    const prevMonth = typeof APP_STATE !== 'undefined' && APP_STATE.currentMonth
      ? APP_STATE.currentMonth
      : null;

    check(await sb
      .from('months')
      .upsert({ month }, { onConflict: 'month' }));

    if (prevMonth && prevMonth !== month) {
      const prevSettings = await getSettings(prevMonth);
      await saveSettingsForMonth(month, prevSettings);

      const prevMemo = await getMemo(prevMonth);
      await saveMemo(month, prevMemo);
    } else {
      await saveSettingsForMonth(month, fallbackSettings());
      await saveMemo(month, defaultMemo());
    }

    clearCacheForMonth('');
    return { ok: true, month };
  }

  async function getTransactions(month) {
    const ck = cacheKey('getTransactions', month);
    const cached = getCache(ck);
    if (cached !== null) return cached;

    const res = await sb
      .from('transactions')
      .select('date,item,amount,shop,card,category,perf,disc,status,memo,sort_order')
      .eq('month', month)
      .order('sort_order', { ascending: true });

    check(res);

    const rows = (res.data || []).map(r => ({
      date: r.date || '',
      item: r.item || '',
      amount: Number(r.amount || 0),
      shop: r.shop || '',
      card: r.card || '',
      category: r.category || '',
      perf: r.perf === true,
      disc: r.disc === true,
      status: r.status || '',
      memo: r.memo || '',
    }));

    setCache(ck, rows);
    return rows;
  }

  async function saveTransactions(month, rows) {
    const safeRows = Array.isArray(rows) ? rows : [];

    check(await sb
      .from('transactions')
      .delete()
      .eq('month', month));

    if (safeRows.length) {
      const payload = safeRows.map((r, i) => ({
        month,
        sort_order: i,
        date: r.date || null,
        item: r.item || '',
        amount: Number(r.amount || 0),
        shop: r.shop || '',
        card: r.card || '',
        category: r.category || '',
        perf: r.perf === true,
        disc: r.disc === true,
        status: r.status || '',
        memo: r.memo || '',
      }));

      check(await sb
        .from('transactions')
        .insert(payload));
    }

    check(await sb
      .from('months')
      .upsert({ month }, { onConflict: 'month' }));

    clearCacheForMonth(month);
    return { ok: true, count: safeRows.length };
  }

  async function getMemo(month) {
    const ck = cacheKey('getMemo', month);
    const cached = getCache(ck);
    if (cached !== null) return cached;

    const res = await sb
      .from('memos')
      .select('memo')
      .eq('month', month)
      .maybeSingle();

    check(res);

    const memo = res.data && res.data.memo ? res.data.memo : defaultMemo();

    setCache(ck, memo);
    return memo;
  }

  async function saveMemo(month, memo) {
    const safeMemo = sanitizeMemo(memo);

    check(await sb
      .from('memos')
      .upsert({ month, memo: safeMemo }, { onConflict: 'month' }));

    clearCacheForMonth(month);
    return { ok: true };
  }

  async function getSettings(monthArg) {
    const month = monthArg || await settingsMonth();
    const ck = cacheKey('getSettings', month);
    const cached = getCache(ck);
    if (cached !== null) return cached;

    const [monthRes, cardRes, catRes] = await Promise.all([
      sb
        .from('month_settings')
        .select('total_budget,toggles')
        .eq('month', month)
        .maybeSingle(),
      sb
        .from('card_month_settings')
        .select('name,perf,disc,perf_default,disc_default,owner,inactive,sort_order')
        .eq('month', month)
        .order('sort_order', { ascending: true }),
      sb
        .from('category_month_settings')
        .select('name,budget,inactive,sort_order')
        .eq('month', month)
        .order('sort_order', { ascending: true }),
    ]);

    check(monthRes);
    check(cardRes);
    check(catRes);

    const hasMonthSettings = !!monthRes.data;
    const hasCards = Array.isArray(cardRes.data) && cardRes.data.length > 0;
    const hasCategories = Array.isArray(catRes.data) && catRes.data.length > 0;

    const settings = !hasMonthSettings && !hasCards && !hasCategories
      ? fallbackSettings()
      : {
          totalBudget: Number(monthRes.data?.total_budget || 0),
          toggles: monthRes.data?.toggles || {},
          cards: (cardRes.data || []).map(cardFromDb),
          categories: (catRes.data || []).map(categoryFromDb),
        };

    setCache(ck, settings);
    return settings;
  }

  async function saveSettingsForMonth(month, settings) {
    const normalized = normalizeSettings(settings);
    const cards = normalized.cards.filter(card => card.name);
    const categories = normalized.categories.filter(cat => cat.name);

    check(await sb
      .from('month_settings')
      .upsert({
        month,
        total_budget: normalized.totalBudget,
        toggles: normalized.toggles,
      }, { onConflict: 'month' }));

    check(await sb
      .from('card_month_settings')
      .delete()
      .eq('month', month));

    check(await sb
      .from('category_month_settings')
      .delete()
      .eq('month', month));

    if (cards.length) {
      check(await sb
        .from('card_month_settings')
        .insert(cards.map((card, i) => cardToDb(month, card, i))));
    }

    if (categories.length) {
      check(await sb
        .from('category_month_settings')
        .insert(categories.map((cat, i) => categoryToDb(month, cat, i))));
    }

    clearCacheForMonth(month);
    return { ok: true };
  }

  async function saveSettings(settings) {
    const month = await settingsMonth();
    const result = await saveSettingsForMonth(month, settings);

    clearCacheForMonth('');
    return result;
  }

  async function getSummary(month) {
    const [rows, settings] = await Promise.all([
      getTransactions(month),
      getSettings(month),
    ]);

    const cardMap = {};
    const catMap = {};
    let total = 0;

    rows.forEach(r => {
      const amount = Number(r.amount || 0);
      total += amount;

      if (!cardMap[r.card]) {
        cardMap[r.card] = {
          perf: 0,
          disc: 0,
          total: 0,
        };
      }

      cardMap[r.card].total += amount;

      if (r.perf) {
        cardMap[r.card].perf += amount;
      }

      if (r.disc) {
        cardMap[r.card].disc += amount;
      }

      const cat = r.category || '-';
      catMap[cat] = (catMap[cat] || 0) + amount;
    });

    return {
      total,
      cardMap,
      catMap,
      cards: settings.cards || [],
    };
  }

  return {
    getMonths,
    createMonth,
    getTransactions,
    saveTransactions,
    getMemo,
    saveMemo,
    getSettings,
    saveSettings,
    getSummary,
    clearCacheForMonth,
  };
})();
