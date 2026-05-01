/**
 * split.js — 분할 뷰 v5
 *
 * 수정 내용:
 * - 항목 메모 저장 시 즉시 doSave 실행
 * - 메모 이미지 dataUrl은 localStorage에 보관하고, 서버에는 파일명만 저장
 * - 이미지 썸네일 및 크게 보기 복구
 */

const SplitPage = (() => {
  let _rows = [];
  let _saveTimer = null;
  let _memoSaveTimer = null;
  let _filters = { card: '', category: '', status: '', dateFrom: '', dateTo: '' };
  let _memo = null;
  let _contextMenuIdx = null;
  let _saveInProgress = false;
  let _savePending = false;
  let _dirty = false;
  let _lastSavePromise = Promise.resolve();
  let _flushEventsBound = false;
  const DEBOUNCE = 250;

  async function init() {
    const content = Utils.el('content');
    content.style.cssText = 'padding:0;overflow:hidden;display:flex;flex-direction:column;';
    await ensureTransactions();
    await ensureMemo();

    _rows = APP_STATE.transactions.length
      ? APP_STATE.transactions.map(r => ({ ...r }))
      : [emptyRow()];
    _dirty = false;

    _memo = hydrateMemoImages(JSON.parse(JSON.stringify(APP_STATE.memo || defaultMemo())));
    if (!_memo.cards) _memo.cards = [];

    renderShell();
    renderDash();
    renderFilter();
    renderTable();
    renderMemoArea();
    bindContextMenu();
    bindLightbox();
    bindFlushEvents();
  }

  function renderShell() {
    Utils.el('content').innerHTML = `
      <div id="sp-dash" style="flex-shrink:0;padding:10px 14px;border-bottom:0.5px solid var(--border);min-height:170px;max-height:240px;overflow:hidden"></div>
      <div id="sp-filter" style="flex-shrink:0;display:flex;gap:5px;align-items:center;padding:4px 14px;border-bottom:0.5px solid var(--border);flex-wrap:wrap"></div>
      <div id="sp-body" style="display:grid;grid-template-columns:628px minmax(240px,1fr);flex:1;overflow:hidden;min-height:0">
        <div style="display:flex;flex-direction:column;overflow:hidden;border-right:0.5px solid var(--border);width:628px;min-width:628px;max-width:628px">
          <div style="overflow:auto;flex:1;width:628px;max-width:628px" id="sp-table-wrap"></div>
          <div style="padding:6px 14px;border-top:0.5px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
            <span style="font-size:10px;color:var(--text3)" id="sp-save-status"></span>
            <span style="font-size:10px;color:var(--text2)" id="sp-count"></span>
          </div>
        </div>
        <div style="overflow-y:auto;background:var(--bg2)" id="sp-memo-wrap"></div>
      </div>
      <div id="sp-ctx-menu" style="display:none;position:fixed;background:var(--bg1);border:0.5px solid var(--border2);border-radius:6px;padding:4px 0;z-index:200;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:140px">
        <div id="sp-ctx-memo" style="padding:7px 14px;font-size:12px;cursor:pointer" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">✎ 항목 메모 편집</div>
      </div>
      <div id="sp-lightbox" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:300;align-items:center;justify-content:center;cursor:zoom-out">
        <img id="sp-lightbox-img" style="max-width:90vw;max-height:90vh;border-radius:6px;object-fit:contain" />
      </div>`;

    new ResizeObserver(() => adjustLayout()).observe(Utils.el('content'));

    const twrap = Utils.el('sp-table-wrap');
    twrap.addEventListener('input', onInput);
    twrap.addEventListener('change', onChange);
    twrap.addEventListener('click', onClick);
    twrap.addEventListener('keydown', onKeydown);
    twrap.addEventListener('contextmenu', onContextMenu);
  }

  function adjustLayout() {
    const body = Utils.el('sp-body');
    if (!body) return;
    body.style.gridTemplateColumns = '628px minmax(240px,1fr)';
  }

  function renderDash() {
    const settings = APP_STATE.settings || defaultSettings();
    const rows = _rows.filter(r => r.item || r.amount);
    const total = rows.reduce((s, r) => s + safeAmount(r.amount), 0);

    const cardMap = {};
    rows.forEach(r => {
      if (!r.card) return;
      if (!cardMap[r.card]) cardMap[r.card] = { perf: 0, disc: 0, total: 0 };
      const amt = safeAmount(r.amount);
      cardMap[r.card].total += amt;
      if (r.perf) cardMap[r.card].perf += amt;
      if (r.disc) cardMap[r.card].disc += amt;
    });

    const catMap = {};
    rows.forEach(r => {
      const cat = r.category || '-';
      catMap[cat] = (catMap[cat] || 0) + safeAmount(r.amount);
    });
    const topCats = (settings.categories || [])
      .filter(c => c && typeof c === 'object' && c.name && !c.inactive)
      .map(c => [c.name, catMap[c.name] || 0])
      .sort((a, b) => b[1] - a[1]);

    const validCards = (settings.cards || []).filter(c => c && typeof c === 'object' && c.name && !c.inactive);
    const myCards = validCards.filter(c => (c.owner || 'me') === 'me' || (c.owner || 'me') === 'common');
    const spouseCards = validCards.filter(c => c.owner === 'spouse');
    const maxDashRows = Math.max(myCards.length, spouseCards.length, topCats.length, 1);
    const cardHeight = Math.min(218, Math.max(148, 46 + maxDashRows * 22));
    const dash = Utils.el('sp-dash');
    if (!dash) return;
    dash.style.height = `${cardHeight + 22}px`;
    dash.style.setProperty('--sp-dash-card-h', `${cardHeight}px`);
    dash.style.setProperty('--sp-dash-card-body-h', `${Math.max(112, cardHeight - 32)}px`);

    const thS = 'padding:2px 8px 2px 0;font-size:9px;color:var(--text2);font-weight:500;text-align:left;border-bottom:0.5px solid var(--border)';

    function cardTableHtml(cards, label) {
      if (!cards.length) return '';
      return `
        <div class="sp-dash-card">
          <div style="font-size:9px;color:var(--text2);margin-bottom:4px">${label}</div>
          <div class="sp-dash-card-body">
          <table style="border-collapse:collapse;font-size:11px">
            <thead><tr>
              <th style="${thS}">카드</th>
              <th style="${thS};text-align:right">총사용</th>
              <th style="${thS};text-align:right">실적</th>
              <th style="${thS};text-align:right">허들</th>
              <th style="${thS};text-align:right;font-weight:600">남은금액</th>
            </tr></thead>
            <tbody>
              ${cards.map(c => {
                const cd = cardMap[c.name] || { perf: 0, disc: 0, total: 0 };
                const remaining = (c.perf || 0) - cd.perf;
                const isNegative = remaining < 0;
                const rc = isNegative ? 'var(--text2)' : remaining === 0 ? 'var(--green-text)' : remaining < 50000 ? 'var(--amber-text)' : 'var(--text1)';
                return `<tr style="border-bottom:0.5px solid var(--border);${isNegative ? 'opacity:.72' : ''}">
                  <td style="padding:3px 10px 3px 0;color:var(--text1);font-weight:500">${esc(c.name)}</td>
                  <td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums">${Utils.fmt(cd.total)}</td>
                  <td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums">${Utils.fmt(cd.perf)}</td>
                  <td style="padding:3px 8px;text-align:right;color:var(--text3);font-variant-numeric:tabular-nums">${c.perf ? Utils.fmt(c.perf) : '-'}</td>
                  <td style="padding:3px 0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;color:${rc}">${c.perf ? Utils.fmt(remaining) : '-'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
          </div>
        </div>`;
    }

    Utils.el('sp-dash').innerHTML = `
      <div class="sp-dash-inner">
        <div class="sp-dash-card sp-dash-total">
          <div style="font-size:9px;color:var(--text2);margin-bottom:2px">총 지출</div>
          <div style="font-size:20px;font-weight:500;font-variant-numeric:tabular-nums">${Utils.fmt(total)}</div>
        </div>
        ${cardTableHtml(myCards, '내 카드')}
        ${cardTableHtml(spouseCards, '남편 카드')}
        ${topCats.length ? `
        <div class="sp-dash-card">
          <div style="font-size:9px;color:var(--text2);margin-bottom:4px">구분별</div>
          <table style="border-collapse:collapse;font-size:11px">
            <tbody>
              ${topCats.map(([cat, amt]) => `
                <tr style="border-bottom:0.5px solid var(--border)">
                  <td style="padding:3px 10px 3px 0;color:var(--text1);font-weight:500">${esc(cat)}</td>
                  <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">${Utils.fmt(amt)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}
      </div>`;
  }

  function renderFilter() {
    const settings = APP_STATE.settings || defaultSettings();
    const cards = (settings.cards || []).filter(c => c && typeof c === 'object' && c.name && !c.inactive).map(c => c.name);
    const cats = (settings.categories || []).filter(c => c && typeof c === 'object' && c.name && !c.inactive).map(c => c.name);

    Utils.el('sp-filter').innerHTML = `
      <span style="font-size:10px;color:var(--text2)">필터</span>
      ${fsel('f-card', '카드', cards)}
      ${fsel('f-cat', '구분', cats)}
      ${fsel('f-status', '상태', ['배송', '확인', '예정'], ['1', '2', '3'])}
      <span style="font-size:10px;color:var(--text2)">날짜</span>
      <input id="f-date-from" type="text" placeholder="시작(4/1)" style="${finpStyle}" />
      <span style="font-size:10px;color:var(--text3)">~</span>
      <input id="f-date-to" type="text" placeholder="끝(4/30)" style="${finpStyle}" />
      <button id="f-reset" style="height:24px;padding:0 8px;font-size:10px;border:0.5px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--text2);cursor:pointer">초기화</button>`;

    ['f-card', 'f-cat', 'f-status'].forEach(id => Utils.el(id)?.addEventListener('change', applyFilter));
    ['f-date-from', 'f-date-to'].forEach(id => Utils.el(id)?.addEventListener('input', applyFilter));
    Utils.el('f-reset')?.addEventListener('click', () => {
      _filters = { card: '', category: '', status: '', dateFrom: '', dateTo: '' };
      Utils.el('f-card').value = '';
      Utils.el('f-cat').value = '';
      Utils.el('f-status').value = '';
      Utils.el('f-date-from').value = '';
      Utils.el('f-date-to').value = '';
      renderTable();
    });
  }

  const finpStyle = 'height:24px;width:60px;font-size:11px;padding:0 5px;border:0.5px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--text1)';

  function applyFilter() {
    _filters.card = Utils.el('f-card')?.value || '';
    _filters.category = Utils.el('f-cat')?.value || '';
    _filters.status = Utils.el('f-status')?.value || '';
    _filters.dateFrom = Utils.el('f-date-from')?.value || '';
    _filters.dateTo = Utils.el('f-date-to')?.value || '';
    renderTable();
  }

  function fsel(id, placeholder, labels, values) {
    const opts = labels.map((l, i) => `<option value="${values ? values[i] : esc(l)}">${esc(l)}</option>`).join('');
    return `<select id="${id}" style="height:24px;font-size:11px;padding:0 5px;border:0.5px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--text1)">
      <option value="">${placeholder} 전체</option>${opts}
    </select>`;
  }

  function renderTable() {
    const settings = APP_STATE.settings || defaultSettings();
    const cards = (settings.cards || []).filter(c => c && typeof c === 'object' && c.name && !c.inactive).map(c => c.name);
    const cats = (settings.categories || []).filter(c => c && typeof c === 'object' && c.name && !c.inactive).map(c => c.name);

    function filterDateNum(s) {
      if (!s) return null;
      s = s.trim();
      if (/^\d{1,2}$/.test(s)) {
        const ym = APP_STATE.currentMonth || '';
        const m = ym.split('-')[1];
        return m ? Number(m) * 100 + Number(s) : null;
      }
      return parseDateStr(s);
    }

    const fromNum = filterDateNum(_filters.dateFrom) ?? 0;
    const toNum = filterDateNum(_filters.dateTo) ?? 99999;

    const filtered = _rows.map((r, i) => ({ ...r, _idx: i })).filter(r => {
      if (_filters.card && r.card !== _filters.card) return false;
      if (_filters.category && r.category !== _filters.category) return false;
      if (_filters.status && r.status !== _filters.status) return false;
      if (_filters.dateFrom || _filters.dateTo) {
        const d = parseDateStr(r.date);
        if (d < fromNum || d > toNum) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));
    const wrap = Utils.el('sp-table-wrap');
    const prevScrollTop = wrap ? wrap.scrollTop : 0;
    const wasAtBottom = wrap ? (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 40) : true;

    wrap.innerHTML = `
      <table class="sp-table">
        <colgroup>
          <col style="width:48px"><col style="width:112px"><col style="width:70px"><col style="width:64px">
          <col style="width:120px"><col style="width:72px"><col style="width:30px">
          <col style="width:30px"><col style="width:58px"><col style="width:24px">
        </colgroup>
        <thead><tr style="position:sticky;top:0;background:var(--bg1);z-index:1;border-bottom:0.5px solid var(--border)">
          <th style="${thStyle}">날짜</th>
          <th style="${thStyle}">항목</th>
          <th style="${thStyle}">쇼핑몰</th>
          <th style="${thStyle};text-align:right">금액</th>
          <th style="${thStyle}">카드</th>
          <th style="${thStyle}">구분</th>
          <th style="${thStyle};text-align:center">실적</th>
          <th style="${thStyle};text-align:center">할인</th>
          <th style="${thStyle}">상태</th>
          <th></th>
        </tr></thead>
        <tbody id="sp-tbody">
          ${sorted.map(row => rowHtml(row, row._idx, cards, cats)).join('')}
          ${newRowHtml(cards, cats)}
        </tbody>
      </table>`;

    if (wrap) wrap.scrollTop = wasAtBottom ? wrap.scrollHeight : prevScrollTop;
    updateCount(filtered.length);
    adjustLayout();
  }

  const thStyle = 'padding:4px 3px;font-size:9px;color:var(--text2);font-weight:500;text-align:left';
  const inpStyle = 'width:100%;height:22px;padding:0 3px;font-size:11px;border:none;background:transparent;color:var(--text1);';
  const selStyle = 'width:100%;height:22px;padding:0 2px;font-size:10px;border:none;background:transparent;color:var(--text1);';

  function rowBg(status) {
    if (status === '1') return 'rgba(230,241,251,.72)';
    if (status === '2') return 'rgba(234,243,222,.72)';
    if (status === '3') return 'rgba(255,239,204,.82)';
    return '';
  }

  function fmtDate(d) {
    if (!d) return '';
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${Number(m[2])}/${Number(m[3])}`;
    return d;
  }

  function safeAmount(v) {
    const n = Utils.parseNum(v);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  function formatAmount(v) {
    const n = safeAmount(v);
    return n ? Utils.fmt(n) : '';
  }

  function rowHtml(row, idx, cards, cats) {
    const isMg = Utils.isMgCard(row.card);
    const cardOpts = cards.map(c => `<option value="${esc(c)}"${c === row.card ? ' selected' : ''}>${esc(c)}</option>`).join('');
    const catOpts = '<option value="">-</option>' + cats.map(c => `<option value="${esc(c)}"${c === row.category ? ' selected' : ''}>${esc(c)}</option>`).join('');
    const stOpts = [['','-'],['1','배송'],['2','확인'],['3','예정']].map(([v,l]) => `<option value="${v}"${row.status === v ? ' selected' : ''}>${l}</option>`).join('');
    const amtVal = formatAmount(row.amount);
    const bg = rowBg(row.status);
    const hasMemo = !!row.memo;
    const memoTip = hasMemo ? ` title="${esc(row.memo)}"` : '';

    return `<tr data-row-idx="${idx}" style="border-bottom:0.5px solid var(--border);background:${bg}" ${memoTip}>
      <td style="padding:0 2px">${inp(idx, 'date', fmtDate(row.date), '날짜')}</td>
      <td style="padding:0 2px;position:relative">${inp(idx, 'item', row.item || '', '항목명')}${hasMemo ? `<span style="position:absolute;right:2px;top:50%;transform:translateY(-50%);color:var(--blue-text);font-size:9px;pointer-events:none">✎</span>` : ''}</td>
      <td style="padding:0 2px">${inp(idx, 'shop', row.shop || '', '쇼핑몰')}</td>
      <td style="padding:0 2px">${inp(idx, 'amount', amtVal, '0', 'text-align:right')}</td>
      <td style="padding:0 1px">${sel(idx, 'card', cardOpts)}</td>
      <td style="padding:0 1px">${sel(idx, 'category', catOpts)}</td>
      <td style="text-align:center;padding:0"><input type="checkbox" data-idx="${idx}" data-field="perf" ${row.perf ? 'checked' : ''} style="accent-color:var(--blue);width:12px;height:12px" /></td>
      <td style="text-align:center;padding:0"><input type="checkbox" data-idx="${idx}" data-field="disc" ${row.disc ? 'checked' : ''} ${!isMg ? 'disabled' : ''} style="accent-color:var(--blue);width:12px;height:12px" /></td>
      <td style="padding:0 1px">${sel(idx, 'status', stOpts, 'font-size:10px')}</td>
      <td style="padding:0 1px;text-align:center"><button class="sp-rm" data-idx="${idx}" style="width:18px;height:18px;border:none;background:none;cursor:pointer;font-size:11px;padding:0;line-height:1;color:var(--text3);display:flex;align-items:center;justify-content:center;border-radius:3px" title="삭제" onmouseover="this.style.background='var(--red-bg)';this.style.color='var(--red-text)'" onmouseout="this.style.background='';this.style.color='var(--text3)'">✕</button></td>
    </tr>`;
  }

  function newRowHtml(cards, cats) {
    const cardOpts = cards.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const catOpts = '<option value="">-</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const stOpts = [['','-'],['1','배송'],['2','확인'],['3','예정']].map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
    return `<tr id="sp-new-row" style="border-bottom:0.5px solid var(--border);background:var(--bg2)">
      <td style="padding:0 2px">${ninp('date', '', '날짜')}</td>
      <td style="padding:0 2px">${ninp('item', '', '항목명')}</td>
      <td style="padding:0 2px">${ninp('shop', '', '쇼핑몰')}</td>
      <td style="padding:0 2px">${ninp('amount', '', '0', 'text-align:right')}</td>
      <td style="padding:0 1px">${nsel('card', cardOpts)}</td>
      <td style="padding:0 1px">${nsel('category', catOpts)}</td>
      <td style="text-align:center;padding:0"><input type="checkbox" class="new-chk" data-field="perf" checked style="accent-color:var(--blue);width:12px;height:12px" /></td>
      <td style="text-align:center;padding:0"><input type="checkbox" class="new-chk" data-field="disc" style="accent-color:var(--blue);width:12px;height:12px" /></td>
      <td style="padding:0 1px">${nsel('status', stOpts, 'font-size:10px')}</td>
      <td></td>
    </tr>`;
  }

  function inp(idx, field, val, ph, extra = '') {
    return `<input class="tbl-inp" data-idx="${idx}" data-field="${field}" value="${esc(val)}" placeholder="${ph}" style="${inpStyle}${extra}" />`;
  }

  function sel(idx, field, opts, extra = '') {
    return `<select class="tbl-sel" data-idx="${idx}" data-field="${field}" style="${selStyle}${extra}">${opts}</select>`;
  }

  function ninp(field, val, ph, extra = '') {
    return `<input class="new-inp" data-field="${field}" value="${esc(val)}" placeholder="${ph}" style="${inpStyle}${extra}" />`;
  }

  function nsel(field, opts, extra = '') {
    return `<select class="new-sel" data-field="${field}" style="${selStyle}${extra}">${opts}</select>`;
  }

  function parseDateStr(s) {
    if (!s) return 99999;
    s = String(s).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return Number(iso[2]) * 100 + Number(iso[3]);
    const slash = s.match(/^(\d{1,2})\/(\d{1,2})/);
    if (slash) return Number(slash[1]) * 100 + Number(slash[2]);
    if (/^\d{1,2}$/.test(s)) return 9999;
    return 99999;
  }

  function normalizeDate(raw) {
    if (!raw) return '';
    raw = String(raw).trim();
    const ym = APP_STATE.currentMonth || '';
    const [y, m] = ym.split('-');
    if (!y || !m) return raw;
    if (/^\d{1,2}$/.test(raw)) return `${y}-${m}-${raw.padStart(2, '0')}`;
    if (/^\d{1,2}\/\d{1,2}$/.test(raw)) {
      const [mm, dd] = raw.split('/');
      return `${y}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return raw;
  }

  function onInput(e) {
    const el = e.target;
    if (el.classList.contains('new-inp')) return;

    const idx = Number(el.dataset.idx);
    const field = el.dataset.field;
    if (Number.isNaN(idx) || !field) return;

    if (field === 'amount') {
      const raw = el.value.replace(/[^0-9]/g, '');
      const amount = raw ? Number(raw) : 0;
      _rows[idx].amount = Number.isFinite(amount) && amount > 0 ? amount : '';
      el.value = _rows[idx].amount ? Utils.fmt(_rows[idx].amount) : '';
    } else {
      _rows[idx][field] = el.value;
    }

    scheduleSave();
    renderDash();
  }

  function onChange(e) {
    const el = e.target;
    if (el.classList.contains('new-sel') || el.classList.contains('new-chk')) return;

    const idx = Number(el.dataset.idx);
    const field = el.dataset.field;
    if (Number.isNaN(idx) || !field) return;

    if (el.type === 'checkbox') {
      _rows[idx][field] = el.checked;
    } else {
      _rows[idx][field] = el.value;
      if (field === 'card') onCardChange(idx, el.value);
      if (field === 'status') {
        const tr = Utils.qs(`tr[data-row-idx="${idx}"]`, Utils.el('sp-tbody'));
        if (tr) tr.style.background = rowBg(el.value);
      }
    }

    scheduleSave(true);
  }

  function onClick(e) {
    hideCtxMenu();
    const btn = e.target.closest('.sp-rm');
    if (!btn) return;

    const idx = Number(btn.dataset.idx);
    _rows.splice(idx, 1);
    if (!_rows.length) _rows.push(emptyRow());
    renderTable();
    scheduleSave(true);
  }

  function onKeydown(e) {
    const el = e.target;

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) &&
      (el.classList.contains('tbl-inp') || el.classList.contains('new-inp'))) {
      const tbody = Utils.el('sp-tbody');
      if (!tbody) return;
      const allRows = [...tbody.querySelectorAll('tr')];
      const tr = el.closest('tr');
      const trIdx = allRows.indexOf(tr);
      const cells = [...tr.querySelectorAll('input.tbl-inp,input.new-inp,select.tbl-sel,select.new-sel')];
      const cellIdx = cells.indexOf(el);

      if (e.key === 'ArrowLeft' && cellIdx > 0) { e.preventDefault(); cells[cellIdx - 1].focus(); return; }
      if (e.key === 'ArrowRight' && cellIdx < cells.length - 1) { e.preventDefault(); cells[cellIdx + 1].focus(); return; }
      if (e.key === 'ArrowUp' && trIdx > 0) {
        e.preventDefault();
        const prev = [...allRows[trIdx - 1].querySelectorAll('input.tbl-inp,input.new-inp,select.tbl-sel,select.new-sel')];
        if (prev[cellIdx]) prev[cellIdx].focus();
        return;
      }
      if (e.key === 'ArrowDown' && trIdx < allRows.length - 1) {
        e.preventDefault();
        const next = [...allRows[trIdx + 1].querySelectorAll('input.tbl-inp,input.new-inp,select.tbl-sel,select.new-sel')];
        if (next[cellIdx]) next[cellIdx].focus();
        return;
      }
    }

    if (el.classList.contains('new-inp') && e.key === 'Enter') {
      e.preventDefault();
      commitNewRow();
      return;
    }

    if (el.classList.contains('tbl-inp') && el.dataset.field === 'date' && e.key === 'Enter') {
      const normalized = normalizeDate(el.value);
      el.value = fmtDate(normalized);
      _rows[Number(el.dataset.idx)].date = normalized;
      scheduleSave();
    }
  }

  function commitNewRow() {
    const nr = Utils.el('sp-new-row');
    if (!nr) return;

    const row = emptyRow();

    nr.querySelectorAll('.new-inp').forEach(input => {
      if (input.dataset.field === 'amount') {
        const raw = input.value.replace(/[^0-9]/g, '');
        const amount = raw ? Number(raw) : 0;
        row.amount = Number.isFinite(amount) && amount > 0 ? amount : '';
      } else if (input.dataset.field === 'date') {
        row.date = normalizeDate(input.value) || row.date;
      } else {
        row[input.dataset.field] = input.value;
      }
    });

    nr.querySelectorAll('.new-sel').forEach(s => { row[s.dataset.field] = s.value; });
    nr.querySelectorAll('.new-chk').forEach(c => { row[c.dataset.field] = c.checked; });

    if (!row.item && !row.amount) return;

    _rows.push(row);
    renderTable();
    scheduleSave(true);

    setTimeout(() => {
      const newNr = Utils.el('sp-new-row');
      const itemInp = newNr?.querySelector('[data-field=item]');
      if (itemInp) itemInp.focus({ preventScroll: true });
    }, 30);
  }

  function onContextMenu(e) {
    e.preventDefault();
    const tr = e.target.closest('tr[data-row-idx]');
    if (!tr) return;
    _contextMenuIdx = Number(tr.dataset.rowIdx);
    const menu = Utils.el('sp-ctx-menu');
    menu.style.display = 'block';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
  }

  function bindContextMenu() {
    Utils.el('sp-ctx-memo')?.addEventListener('click', () => {
      hideCtxMenu();
      if (_contextMenuIdx === null) return;
      openItemMemo(_contextMenuIdx);
    });
    document.addEventListener('click', hideCtxMenu, true);
  }

  function hideCtxMenu() {
    const m = Utils.el('sp-ctx-menu');
    if (m) m.style.display = 'none';
  }

  function openItemMemo(idx) {
    const row = _rows[idx];
    if (!row) return;

    Utils.el('item-memo-ta').value = row.memo || '';
    Utils.el('item-memo-overlay').classList.add('show');
    setTimeout(() => Utils.el('item-memo-ta').focus(), 100);

    Utils.el('item-memo-save').onclick = async () => {
      const text = Utils.el('item-memo-ta').value.trim();
      _rows[idx].memo = text;
      Utils.el('item-memo-overlay').classList.remove('show');
      renderTable();
      renderItemMemoSection();

      clearTimeout(_saveTimer);
      await doSave();
    };

    Utils.el('item-memo-cancel').onclick = () => {
      Utils.el('item-memo-overlay').classList.remove('show');
    };
  }

  function onCardChange(idx, cardName) {
    const cs = (APP_STATE.settings?.cards || []).find(c => c && c.name === cardName);
    if (!cs) return;

    const isMg = Utils.isMgCard(cardName);
    _rows[idx].perf = cs.perfDefault;
    _rows[idx].disc = isMg ? cs.discDefault : false;

    const tr = Utils.qs(`tr[data-row-idx="${idx}"]`, Utils.el('sp-tbody'));
    if (!tr) return;
    const p = tr.querySelector('[data-field=perf]');
    const d = tr.querySelector('[data-field=disc]');
    if (p) p.checked = _rows[idx].perf;
    if (d) { d.checked = _rows[idx].disc; d.disabled = !isMg; }
  }

  function scheduleSave(immediate = false) {
    _dirty = true;
    setSaveStatus('저장 대기 중...');
    clearTimeout(_saveTimer);

    if (immediate) {
      _lastSavePromise = doSaveQueued();
      return _lastSavePromise;
    }

    _saveTimer = setTimeout(() => {
      _lastSavePromise = doSaveQueued();
    }, DEBOUNCE);

    return _lastSavePromise;
  }

  async function doSaveQueued() {
    clearTimeout(_saveTimer);

    if (_saveInProgress) {
      _savePending = true;
      setSaveStatus('저장 중...');
      return _lastSavePromise;
    }

    _saveInProgress = true;
    setSaveStatus('저장 중...');

    try {
      await doSave();
    } finally {
      _saveInProgress = false;

      if (_savePending) {
        _savePending = false;
        _lastSavePromise = doSaveQueued();
        return _lastSavePromise;
      }
    }
  }

  async function doSave() {
    const validRows = _rows
      .map(r => ({ ...r, amount: safeAmount(r.amount) || '' }))
      .filter(r => r.item || r.amount);
    try {
      await API.saveTransactions(APP_STATE.currentMonth, validRows);
      APP_STATE.transactions = validRows.map(r => ({ ...r }));
      _dirty = false;
      setSaveStatus('저장됨');
      setTimeout(() => setSaveStatus(''), 1200);
      renderDash();
    } catch (err) {
      console.error('[SplitPage.doSave]', err);
      setSaveStatus('저장 실패');
      showToast('저장 실패: ' + err.message, 3500);
    }
  }

  function setSaveStatus(msg) {
    const el = Utils.el('sp-save-status');
    if (el) el.textContent = msg;
  }

  function bindFlushEvents() {
    if (_flushEventsBound) return;
    _flushEventsBound = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushSave();
      }
    });

    window.addEventListener('beforeunload', () => {
      flushSave();
    });

    document.addEventListener('click', e => {
      const navTarget = e.target.closest('[data-page], [data-route], .nav-item, .tab-btn, .gnb-item, .menu-item');
      if (!navTarget) return;
      flushSave();
    }, true);
  }

  function flushSave() {
    if (!_dirty) return Promise.resolve();
    clearTimeout(_saveTimer);
    _lastSavePromise = doSaveQueued();
    return _lastSavePromise;
  }

  function save() {
    return flushSave();
  }

  function renderMemoArea() {
    const wrap = Utils.el('sp-memo-wrap');
    if (!wrap) return;

    wrap.innerHTML = `
      <div style="padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:10px;font-weight:500;color:var(--text2)">메모</div>
          <div style="position:relative">
            <button id="sp-add-memo-btn" style="font-size:10px;padding:2px 8px;height:22px;border:0.5px solid var(--border2);border-radius:4px;background:var(--bg1);color:var(--text2);cursor:pointer">+ 추가</button>
            <div id="sp-add-memo-menu" style="display:none;position:absolute;right:0;top:26px;background:var(--bg1);border:0.5px solid var(--border2);border-radius:6px;padding:4px 0;z-index:50;min-width:110px;box-shadow:0 4px 12px rgba(0,0,0,.1)">
              ${['checklist:체크리스트', 'free:자유 메모', 'info:정보', 'image:이미지'].map(s => {
                const [type, label] = s.split(':');
                return `<div data-type="${type}" style="padding:6px 12px;font-size:11px;cursor:pointer" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">${label}</div>`;
              }).join('')}
            </div>
          </div>
        </div>
        <div id="sp-memo-cards"></div>
        <div id="sp-item-memos"></div>
      </div>`;

    Utils.el('sp-add-memo-btn').addEventListener('click', e => {
      e.stopPropagation();
      const m = Utils.el('sp-add-memo-menu');
      m.style.display = m.style.display === 'none' ? 'block' : 'none';
    });

    Utils.el('sp-add-memo-menu').querySelectorAll('[data-type]').forEach(opt => {
      opt.addEventListener('click', () => {
        addMemoCard(opt.dataset.type);
        Utils.el('sp-add-memo-menu').style.display = 'none';
      });
    });

    renderMemoCards();
    renderItemMemoSection();
  }

  function renderMemoCards() {
    const container = Utils.el('sp-memo-cards');
    if (!container) return;
    container.innerHTML = (_memo.cards || []).map((card, ci) => memoCardHtml(card, ci)).join('');
    bindMemoCardEvents();
  }

  function memoCardHtml(card, ci) {
    const typeLabel = { checklist: '체크리스트', free: '자유 메모', info: '정보', image: '이미지' }[card.type] || card.type;
    let body = '';

    if (card.type === 'checklist') {
      const items = card.items || [];
      body = items.map((item, ii) => `
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
          <input type="checkbox" class="mc-chk" data-ci="${ci}" data-ii="${ii}" ${item.done ? 'checked' : ''} style="accent-color:var(--blue);width:12px;height:12px;flex-shrink:0" />
          <input class="mc-inp" data-ci="${ci}" data-ii="${ii}" value="${esc(item.text || '')}" placeholder="항목..." style="flex:1;border:none;background:transparent;font-size:11px;color:var(--text1);${item.done ? 'text-decoration:line-through;color:var(--text3)' : ''}" />
          <button class="mc-item-del" data-ci="${ci}" data-ii="${ii}" style="border:none;background:none;color:var(--text3);cursor:pointer;font-size:12px;padding:0;line-height:1">×</button>
        </div>`).join('') +
        `<button class="mc-add-item" data-ci="${ci}" style="font-size:10px;color:var(--text3);border:none;background:none;cursor:pointer;padding:2px 0">+ 추가</button>`;
    } else if (card.type === 'free') {
      body = `<textarea class="mc-inp" data-ci="${ci}" style="width:100%;min-height:56px;font-size:11px;padding:5px;border:0.5px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--text1);resize:vertical;font-family:inherit;line-height:1.5" placeholder="자유롭게 입력...">${esc(card.text || '')}</textarea>`;
    } else if (card.type === 'info') {
      const items = card.items || [];
      body = `<table style="width:100%;border-collapse:collapse;font-size:11px">
        ${items.map((item, ii) => `<tr style="border-bottom:0.5px solid var(--border)">
          <td style="padding:2px 0;width:58px"><input class="mc-inp" data-ci="${ci}" data-ii="${ii}" data-field="label" value="${esc(item.label || '')}" placeholder="항목" style="width:100%;border:none;background:transparent;font-size:10px;color:var(--text2)" /></td>
          <td style="padding:2px 4px"><input class="mc-inp" data-ci="${ci}" data-ii="${ii}" data-field="value" value="${esc(item.value || '')}" placeholder="내용" style="width:100%;border:none;background:transparent;font-size:11px;color:var(--text1)" /></td>
          <td style="width:14px"><button class="mc-item-del" data-ci="${ci}" data-ii="${ii}" style="border:none;background:none;color:var(--text3);cursor:pointer;font-size:12px;padding:0">×</button></td>
        </tr>`).join('')}
      </table>
      <button class="mc-add-item" data-ci="${ci}" style="font-size:10px;color:var(--text3);border:none;background:none;cursor:pointer;padding:3px 0">+ 행 추가</button>`;
    } else if (card.type === 'image') {
      const imgs = card.images || [];
      body = `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px">
        ${imgs.map((img, ii) => {
          const dataUrl = img.dataUrl || getStoredMemoImage(ci, ii, img.name);
          if (dataUrl) {
            return `<div style="position:relative;width:54px;height:40px;border-radius:4px;overflow:hidden;border:0.5px solid var(--border);cursor:zoom-in" onclick="SplitPage.openLightboxByIndex(${ci}, ${ii})">
              <img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover" />
              <button class="mc-img-del" data-ci="${ci}" data-ii="${ii}" style="position:absolute;top:1px;right:1px;width:13px;height:13px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;border:none;cursor:pointer;font-size:9px;padding:0;line-height:1" onclick="event.stopPropagation()">×</button>
            </div>`;
          }

          return `<div style="position:relative;width:74px;min-height:40px;border-radius:4px;border:0.5px solid var(--border);padding:4px 16px 4px 5px;font-size:9px;color:var(--text3);line-height:1.25;word-break:break-all;background:var(--bg2)">
            ${esc(img.name || '이미지')}
            <button class="mc-img-del" data-ci="${ci}" data-ii="${ii}" style="position:absolute;top:1px;right:1px;width:13px;height:13px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;border:none;cursor:pointer;font-size:9px;padding:0;line-height:1">×</button>
          </div>`;
        }).join('')}
      </div>
      <label style="font-size:10px;color:var(--text3);cursor:pointer;border:0.5px dashed var(--border2);border-radius:4px;padding:4px 8px;display:inline-block">
        + 이미지 추가
        <input type="file" class="mc-img-input" data-ci="${ci}" accept="image/*" multiple style="display:none" />
      </label>`;
    }

    return `<div style="background:var(--bg1);border-radius:6px;padding:8px 10px;margin-bottom:7px;border:0.5px solid var(--border)">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px">
        <input class="mc-title-inp" data-ci="${ci}" value="${esc(card.title || typeLabel)}" style="flex:1;border:none;background:transparent;font-size:10px;font-weight:500;color:var(--text2)" />
        <button class="mc-del" data-ci="${ci}" style="border:none;background:none;color:var(--text3);cursor:pointer;font-size:13px;padding:0;line-height:1" title="카드 삭제">×</button>
      </div>
      ${body}
    </div>`;
  }

  function bindMemoCardEvents() {
    const c = Utils.el('sp-memo-cards');
    if (!c) return;

    c.querySelectorAll('.mc-title-inp').forEach(input => {
      input.oninput = e => {
        _memo.cards[Number(e.target.dataset.ci)].title = e.target.value;
        scheduleMemoSave();
      };
    });

    c.querySelectorAll('.mc-del').forEach(btn => {
      btn.onclick = () => {
        _memo.cards.splice(Number(btn.dataset.ci), 1);
        renderMemoCards();
        scheduleMemoSave();
      };
    });

    c.querySelectorAll('.mc-add-item').forEach(btn => {
      btn.onclick = () => {
        const ci = Number(btn.dataset.ci);
        const card = _memo.cards[ci];
        card.items = card.items || [];
        card.items.push(card.type === 'checklist' ? { text: '', done: false } : { label: '', value: '' });
        renderMemoCards();
        scheduleMemoSave();
      };
    });

    c.querySelectorAll('.mc-item-del').forEach(btn => {
      btn.onclick = () => {
        _memo.cards[Number(btn.dataset.ci)].items.splice(Number(btn.dataset.ii), 1);
        renderMemoCards();
        scheduleMemoSave();
      };
    });

    c.querySelectorAll('.mc-inp').forEach(input => {
      input.oninput = e => {
        const { ci, ii, field } = e.target.dataset;
        const card = _memo.cards[Number(ci)];
        if (card.type === 'free') card.text = e.target.value;
        else if (card.type === 'checklist') card.items[Number(ii)].text = e.target.value;
        else if (card.type === 'info') card.items[Number(ii)][field] = e.target.value;
        scheduleMemoSave();
      };
    });

    c.querySelectorAll('.mc-chk').forEach(chk => {
      chk.onchange = e => {
        const { ci, ii } = e.target.dataset;
        _memo.cards[Number(ci)].items[Number(ii)].done = e.target.checked;
        renderMemoCards();
        scheduleMemoSave();
      };
    });

    c.querySelectorAll('.mc-img-input').forEach(input => {
      input.onchange = async e => {
        const ci = Number(input.dataset.ci);
        for (const file of Array.from(e.target.files)) {
          try {
            const dataUrl = await Utils.resizeImageFile(file);
            _memo.cards[ci].images = _memo.cards[ci].images || [];
            const image = { name: file.name, dataUrl };
            _memo.cards[ci].images.push(image);
            storeMemoImage(ci, _memo.cards[ci].images.length - 1, image);
            renderMemoCards();
            scheduleMemoSave();
          } catch (err) {
            console.warn('[SplitPage.imageResize]', err);
            showToast(err.message || '이미지를 줄이는 중 문제가 발생했습니다', 3000);
          }
        }
        e.target.value = '';
      };
    });

    c.querySelectorAll('.mc-img-del').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        removeStoredMemoImage(Number(btn.dataset.ci), Number(btn.dataset.ii));
        _memo.cards[Number(btn.dataset.ci)].images.splice(Number(btn.dataset.ii), 1);
        renderMemoCards();
        scheduleMemoSave();
      };
    });
  }

  function addMemoCard(type) {
    _memo.cards = _memo.cards || [];
    const typeLabel = { checklist: '체크리스트', free: '자유 메모', info: '정보', image: '이미지' }[type];
    const card = { type, title: typeLabel };
    if (type === 'checklist') card.items = [];
    if (type === 'info') card.items = [];
    if (type === 'image') card.images = [];
    if (type === 'free') card.text = '';
    _memo.cards.push(card);
    renderMemoCards();
    scheduleMemoSave();
  }

  function renderItemMemoSection() {
    const container = Utils.el('sp-item-memos');
    if (!container) return;

    const withMemo = _rows
      .map((r, idx) => ({ ...r, _idx: idx }))
      .filter(r => r.memo && r.item);

    if (!withMemo.length) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div style="font-size:9px;color:var(--text3);margin:8px 0 5px;letter-spacing:.04em">항목 메모</div>
      ${withMemo.map(r => `
        <div style="background:var(--bg1);border-radius:5px;padding:6px 8px;margin-bottom:5px;border:0.5px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="font-size:10px;font-weight:500;color:var(--text2);margin-bottom:2px">${esc(r.item)}</div>
            <button onclick="SplitPage.deleteItemMemo(${r._idx})" style="border:none;background:none;color:var(--text3);cursor:pointer;font-size:12px;padding:0;line-height:1;flex-shrink:0;margin-left:4px">×</button>
          </div>
          <div style="font-size:10px;color:var(--text1);line-height:1.5;white-space:pre-wrap">${esc(r.memo)}</div>
        </div>`).join('')}`;
  }

  function deleteItemMemo(idx) {
    if (!_rows[idx]) return;
    _rows[idx].memo = '';
    renderTable();
    renderItemMemoSection();
    scheduleSave(true);
  }

  function scheduleMemoSave() {
    clearTimeout(_memoSaveTimer);
    _memoSaveTimer = setTimeout(async () => {
      try {
        persistMemoImagesLocal(_memo);
        const toSave = JSON.parse(JSON.stringify(_memo));
        if (toSave.cards) toSave.cards.forEach(card => {
          if (card.images) card.images = card.images.map(img => ({ name: img.name }));
        });
        await API.saveMemo(APP_STATE.currentMonth, toSave);
        APP_STATE.memo = hydrateMemoImages(JSON.parse(JSON.stringify(_memo)));
      } catch (err) {
        console.error('[SplitPage.scheduleMemoSave]', err);
        showToast('메모 저장 실패: ' + err.message, 3000);
      }
    }, DEBOUNCE);
  }

  function bindLightbox() {
    const lb = Utils.el('sp-lightbox');
    if (lb) lb.addEventListener('click', () => { lb.style.display = 'none'; });
  }

  function openLightbox(src) {
    if (!src) {
      showToast('이 이미지는 원본 미리보기 데이터가 없습니다');
      return;
    }

    const lb = Utils.el('sp-lightbox');
    const img = Utils.el('sp-lightbox-img');
    if (!lb || !img) return;

    img.src = src;
    lb.style.display = 'flex';
  }

  function openLightboxByIndex(ci, ii) {
    const image = _memo?.cards?.[ci]?.images?.[ii];
    const src = image?.dataUrl || getStoredMemoImage(ci, ii, image?.name);
    openLightbox(src);
  }

  function memoImageStorageKey(ci, ii, name) {
    return `ledger_memo_img_${APP_STATE.currentMonth}_${ci}_${ii}_${name || ''}`;
  }

  function storeMemoImage(ci, ii, image) {
    if (!image || !image.dataUrl) return;

    try {
      localStorage.setItem(memoImageStorageKey(ci, ii, image.name), image.dataUrl);
    } catch (err) {
      console.warn('[SplitPage.storeMemoImage]', err);
      showToast('이미지가 커서 브라우저 저장소에 저장하지 못했습니다', 3000);
    }
  }

  function getStoredMemoImage(ci, ii, name) {
    try {
      return localStorage.getItem(memoImageStorageKey(ci, ii, name)) || '';
    } catch {
      return '';
    }
  }

  function removeStoredMemoImage(ci, ii) {
    try {
      const prefix = `ledger_memo_img_${APP_STATE.currentMonth}_${ci}_${ii}_`;
      Object.keys(localStorage)
        .filter(k => k.startsWith(prefix))
        .forEach(k => localStorage.removeItem(k));
    } catch {}
  }

  function persistMemoImagesLocal(memo) {
    (memo.cards || []).forEach((card, ci) => {
      (card.images || []).forEach((image, ii) => {
        storeMemoImage(ci, ii, image);
      });
    });
  }

  function hydrateMemoImages(memo) {
    memo = memo || defaultMemo();
    memo.cards = memo.cards || [];

    memo.cards.forEach((card, ci) => {
      if (!card.images) return;

      card.images = card.images.map((image, ii) => {
        if (image.dataUrl) return image;
        const dataUrl = getStoredMemoImage(ci, ii, image.name);
        return dataUrl ? { ...image, dataUrl } : image;
      });
    });

    return memo;
  }

  function emptyRow() {
    const settings = APP_STATE.settings || defaultSettings();
    const today = new Date();
    const ym = APP_STATE.currentMonth || '';
    const [y, m] = ym.split('-');
    const dateStr = y && m ? `${y}-${m}-${String(today.getDate()).padStart(2, '0')}` : `${today.getMonth() + 1}/${today.getDate()}`;

    return {
      date: dateStr,
      item: '',
      amount: '',
      shop: '',
      card: settings.cards?.find(c => c && !c.inactive && c.name)?.name || '',
      category: '',
      perf: true,
      disc: false,
      status: '',
      memo: '',
    };
  }

  function updateCount(n) {
    const el = Utils.el('sp-count');
    if (el) el.textContent = `${n}건`;
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    init,
    openLightbox,
    openLightboxByIndex,
    deleteItemMemo,
    save,
    flushSave,
  };
})();
