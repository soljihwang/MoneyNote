/**
 * split.js — 분할 뷰 v4
 * 상단: 대시보드 (총지출 + 카드실적 내/남편 구분)
 * 하단좌: 내역+입력 통합 (인라인편집, 자동저장)
 * 하단우: 메모 (편집 가능, 카드 추가/타이틀 수정)
 */

const SplitPage = (() => {
  let _rows = [];
  let _saveTimer = null;
  let _filters = { card: '', category: '', perf: '', status: '' };
  let _memo = null;
  let _contextMenuIdx = null;
  const DEBOUNCE = 800;

  // ── 초기화 ──────────────────────────────────────────────
  async function init() {
    const content = Utils.el('content');
    content.style.cssText = 'padding:0;overflow:hidden;display:flex;flex-direction:column;';

    await ensureTransactions();
    await ensureMemo();
    _rows = APP_STATE.transactions.length
      ? APP_STATE.transactions.map(r => ({...r}))
      : [emptyRow()];
    _memo = JSON.parse(JSON.stringify(APP_STATE.memo || defaultMemo()));

    renderShell();
    renderDash();
    renderFilter();
    renderTable();
    renderMemo();
    scrollToBottom();
    bindContextMenu();
  }

  // ── 레이아웃 ────────────────────────────────────────────
  function renderShell() {
    Utils.el('content').innerHTML = `
      <div id="sp-dash" style="flex-shrink:0;padding:8px 14px;border-bottom:0.5px solid var(--border);overflow-x:auto;white-space:nowrap"></div>
      <div id="sp-filter" style="flex-shrink:0;display:flex;gap:5px;align-items:center;padding:4px 14px;border-bottom:0.5px solid var(--border);flex-wrap:wrap"></div>
      <div id="sp-body" style="display:grid;grid-template-columns:1fr 280px;flex:1;overflow:hidden;min-height:0">
        <div style="display:flex;flex-direction:column;overflow:hidden;border-right:0.5px solid var(--border)">
          <div style="overflow:auto;flex:1;padding-bottom:60px" id="sp-table-wrap"></div>
        </div>
        <div style="overflow-y:auto;background:var(--bg2)" id="sp-memo-wrap"></div>
      </div>
      <div id="sp-ctx-menu" style="display:none;position:fixed;background:var(--bg1);border:0.5px solid var(--border2);border-radius:6px;padding:4px 0;z-index:200;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:140px">
        <div id="sp-ctx-memo" style="padding:6px 14px;font-size:12px;cursor:pointer;color:var(--text1)" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">✎ 항목 메모</div>
      </div>`;

    // 창 크기 변경 시 메모 영역 조정
    const observer = new ResizeObserver(() => adjustLayout());
    observer.observe(Utils.el('content'));
  }

  function adjustLayout() {
    const body = Utils.el('sp-body');
    if (!body) return;
    const w = body.offsetWidth;
    // 테이블 최소 너비 460px, 나머지는 메모
    const memoW = Math.max(240, Math.min(400, w - 460));
    body.style.gridTemplateColumns = `1fr ${memoW}px`;
  }

  // ── 대시보드 ────────────────────────────────────────────
  function renderDash() {
    const settings = APP_STATE.settings || defaultSettings();
    const rows = _rows.filter(r => r.item || r.amount);
    const total = rows.reduce((s, r) => s + Utils.parseNum(r.amount), 0);

    // 카드별 집계
    const cardMap = {};
    rows.forEach(r => {
      if (!r.card) return;
      if (!cardMap[r.card]) cardMap[r.card] = { perf: 0, disc: 0, total: 0 };
      const amt = Utils.parseNum(r.amount);
      cardMap[r.card].total += amt;
      if (r.perf) cardMap[r.card].perf += amt;
      if (r.disc) cardMap[r.card].disc += amt;
    });

    // 내 카드 / 남편 카드 분리
    const myCards    = settings.cards.filter(c => !c.inactive && !c.name.includes('재욱'));
    const spouseCards= settings.cards.filter(c => !c.inactive &&  c.name.includes('재욱'));

    function cardTableHtml(cards, label) {
      if (!cards.length) return '';
      return `
        <div style="display:inline-block;vertical-align:top;margin-right:14px">
          <div style="font-size:9px;color:var(--text3);margin-bottom:4px;letter-spacing:.04em">${label}</div>
          <table style="border-collapse:collapse;font-size:11px;white-space:nowrap">
            <thead><tr>
              <th style="padding:2px 8px 2px 0;font-size:9px;color:var(--text2);font-weight:400;text-align:left;border-bottom:0.5px solid var(--border)">카드</th>
              <th style="padding:2px 8px;font-size:9px;color:var(--text2);font-weight:400;text-align:right;border-bottom:0.5px solid var(--border)">총사용</th>
              <th style="padding:2px 8px;font-size:9px;color:var(--text2);font-weight:400;text-align:right;border-bottom:0.5px solid var(--border)">실적</th>
              <th style="padding:2px 8px;font-size:9px;color:var(--text2);font-weight:400;text-align:right;border-bottom:0.5px solid var(--border)">허들</th>
              <th style="padding:2px 8px 2px 0;font-size:9px;font-weight:500;text-align:right;border-bottom:0.5px solid var(--border)">남은금액</th>
            </tr></thead>
            <tbody>
              ${cards.map(c => {
                const cd = cardMap[c.name] || { perf: 0, disc: 0, total: 0 };
                const remaining = (c.perf || 0) - cd.perf;
                const remColor = remaining <= 0 ? 'var(--green-text)' : remaining < 50000 ? 'var(--amber-text)' : 'var(--text1)';
                return `<tr style="border-bottom:0.5px solid var(--border)">
                  <td style="padding:3px 8px 3px 0;color:var(--text2)">${c.name}</td>
                  <td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums">${Utils.fmt(cd.total)}</td>
                  <td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums">${Utils.fmt(cd.perf)}</td>
                  <td style="padding:3px 8px;text-align:right;color:var(--text3);font-variant-numeric:tabular-nums">${c.perf ? Utils.fmt(c.perf) : '-'}</td>
                  <td style="padding:3px 0;text-align:right;font-weight:500;font-variant-numeric:tabular-nums;color:${remColor}">${c.perf ? Utils.fmt(remaining) : '-'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    }

    Utils.el('sp-dash').innerHTML = `
      <div style="display:inline-flex;align-items:flex-start;gap:16px">
        <div style="margin-right:6px">
          <div style="font-size:9px;color:var(--text3);margin-bottom:2px">총 지출</div>
          <div style="font-size:20px;font-weight:500;font-variant-numeric:tabular-nums">${Utils.fmt(total)}</div>
          <div style="font-size:9px;color:var(--text3);margin-top:1px" id="sp-save-status"></div>
        </div>
        <div style="width:0.5px;background:var(--border);align-self:stretch;margin:0 4px"></div>
        ${cardTableHtml(myCards, '내 카드')}
        ${spouseCards.length ? `<div style="width:0.5px;background:var(--border);align-self:stretch;margin:0 4px"></div>` : ''}
        ${cardTableHtml(spouseCards, '남편 카드')}
      </div>`;
  }

  // ── 필터 ────────────────────────────────────────────────
  function renderFilter() {
    const settings = APP_STATE.settings || defaultSettings();
    const cards = settings.cards.filter(c => !c.inactive).map(c => c.name);
    const cats  = settings.categories.filter(c => !c.inactive).map(c => c.name);

    Utils.el('sp-filter').innerHTML = `
      <span style="font-size:10px;color:var(--text2)">필터</span>
      ${fsel('f-card',   '카드 전체',  cards)}
      ${fsel('f-cat',    '구분 전체',  cats)}
      ${fsel('f-perf',   '실적 전체',  ['포함만','미포함만'], ['y','n'])}
      ${fsel('f-status', '상태 전체',  ['배송','확인','예정'], ['1','2','3'])}
      <span style="font-size:10px;color:var(--text3);margin-left:4px" id="sp-count"></span>`;

    ['f-card','f-cat','f-perf','f-status'].forEach(id => {
      Utils.el(id)?.addEventListener('change', () => {
        _filters.card     = Utils.el('f-card').value;
        _filters.category = Utils.el('f-cat').value;
        _filters.perf     = Utils.el('f-perf').value;
        _filters.status   = Utils.el('f-status').value;
        renderTable();
      });
    });
  }

  function fsel(id, placeholder, labels, values) {
    const opts = labels.map((l, i) => `<option value="${values?values[i]:l}">${l}</option>`).join('');
    return `<select id="${id}" style="height:24px;font-size:11px;padding:0 5px;border:0.5px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--text1)">
      <option value="">${placeholder}</option>${opts}
    </select>`;
  }

  // ── 테이블 ──────────────────────────────────────────────
  function renderTable() {
    const settings = APP_STATE.settings || defaultSettings();
    const cards = settings.cards.filter(c => !c.inactive).map(c => c.name);
    const cats  = settings.categories.filter(c => !c.inactive).map(c => c.name);

    const filtered = _rows.map((r, i) => ({...r, _idx: i})).filter(r => {
      if (_filters.card     && r.card !== _filters.card) return false;
      if (_filters.category && r.category !== _filters.category) return false;
      if (_filters.perf === 'y' && !r.perf) return false;
      if (_filters.perf === 'n' && r.perf) return false;
      if (_filters.status   && r.status !== _filters.status) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));

    const wrap = Utils.el('sp-table-wrap');
    wrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
        <colgroup>
          <col style="width:70px"><col style="width:130px"><col style="width:78px">
          <col style="width:100px"><col style="width:66px"><col style="width:26px">
          <col style="width:26px"><col style="width:50px"><col style="width:20px">
        </colgroup>
        <thead><tr style="position:sticky;top:0;background:var(--bg1);z-index:1;border-bottom:0.5px solid var(--border)">
          <th style="${thStyle}">날짜</th>
          <th style="${thStyle}">항목</th>
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

    Utils.el('sp-tbody').addEventListener('input',   onInput);
    Utils.el('sp-tbody').addEventListener('change',  onChange);
    Utils.el('sp-tbody').addEventListener('click',   onClick);
    Utils.el('sp-tbody').addEventListener('keydown', onKeydown);
    Utils.el('sp-tbody').addEventListener('contextmenu', onContextMenu);

    updateCount(filtered.length);
    adjustLayout();
  }

  const thStyle = 'padding:4px 3px;font-size:9px;color:var(--text2);font-weight:500;text-align:left';

  function rowBg(status) {
    if (status === '1') return 'rgba(250,238,218,.5)';
    if (status === '2') return 'rgba(252,235,235,.5)';
    if (status === '3') return 'rgba(238,237,254,.5)';
    return '';
  }

  function rowHtml(row, idx, cards, cats) {
    const isMg = Utils.isMgCard(row.card);
    const cardOpts = cards.map(c=>`<option value="${c}"${c===row.card?' selected':''}>${c}</option>`).join('');
    const catOpts  = '<option value="">-</option>'+cats.map(c=>`<option value="${c}"${c===row.category?' selected':''}>${c}</option>`).join('');
    const stOpts   = [['','-'],['1','배송'],['2','확인'],['3','예정']].map(([v,l])=>`<option value="${v}"${row.status===v?' selected':''}>${l}</option>`).join('');
    const amtVal   = row.amount ? Utils.fmt(row.amount) : '';
    const hasMemo  = !!row.memo;
    const bg = rowBg(row.status);

    return `<tr data-row-idx="${idx}" style="border-bottom:0.5px solid var(--border);background:${bg}" oncontextmenu="event.preventDefault()">
      <td style="padding:0 2px">${inp(idx,'date',row.date||'','날짜')}</td>
      <td style="padding:0 2px">${inp(idx,'item',row.item||'','항목명')}${hasMemo?`<span style="color:var(--blue-text);font-size:9px;vertical-align:middle" title="${esc(row.memo||'')}"> ✎</span>`:''}</td>
      <td style="padding:0 2px">${inp(idx,'amount',amtVal,'0','text-align:right')}</td>
      <td style="padding:0 1px">${sel(idx,'card',cardOpts)}</td>
      <td style="padding:0 1px">${sel(idx,'category',catOpts)}</td>
      <td style="text-align:center;padding:0"><input type="checkbox" data-idx="${idx}" data-field="perf" ${row.perf?'checked':''} style="accent-color:var(--blue);width:12px;height:12px" /></td>
      <td style="text-align:center;padding:0"><input type="checkbox" data-idx="${idx}" data-field="disc" ${row.disc?'checked':''} ${!isMg?'disabled':''} style="accent-color:var(--blue);width:12px;height:12px" /></td>
      <td style="padding:0 1px">${sel(idx,'status',stOpts,'font-size:10px')}</td>
      <td style="padding:0"><button class="sp-rm" data-idx="${idx}" style="width:18px;height:18px;border:none;background:none;color:var(--text3);cursor:pointer;font-size:13px;padding:0;line-height:1">-</button></td>
    </tr>`;
  }

  function newRowHtml(cards, cats) {
    const cardOpts = cards.map(c=>`<option value="${c}">${c}</option>`).join('');
    const catOpts  = '<option value="">-</option>'+cats.map(c=>`<option value="${c}">${c}</option>`).join('');
    const stOpts   = [['','-'],['1','배송'],['2','확인'],['3','예정']].map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    const today = new Date();
    const defaultDate = (today.getMonth()+1)+'/'+today.getDate();
    return `<tr id="sp-new-row" style="border-bottom:0.5px solid var(--border);background:var(--bg2)">
      <td style="padding:0 2px">${ninp('date',defaultDate,'날짜')}</td>
      <td style="padding:0 2px">${ninp('item','','항목명')}</td>
      <td style="padding:0 2px">${ninp('amount','','0','text-align:right')}</td>
      <td style="padding:0 1px">${nsel('card',cardOpts)}</td>
      <td style="padding:0 1px">${nsel('category',catOpts)}</td>
      <td style="text-align:center;padding:0"><input type="checkbox" class="new-chk" data-field="perf" checked style="accent-color:var(--blue);width:12px;height:12px" /></td>
      <td style="text-align:center;padding:0"><input type="checkbox" class="new-chk" data-field="disc" style="accent-color:var(--blue);width:12px;height:12px" /></td>
      <td style="padding:0 1px">${nsel('status',stOpts,'font-size:10px')}</td>
      <td></td>
    </tr>`;
  }

  const inpStyle = 'width:100%;height:22px;padding:0 3px;font-size:11px;border:none;background:transparent;color:var(--text1);';
  const selStyle = 'width:100%;height:22px;padding:0 2px;font-size:10px;border:none;background:transparent;color:var(--text1);';

  function inp(idx, field, val, placeholder, extra='') {
    return `<input class="tbl-inp" data-idx="${idx}" data-field="${field}" value="${esc(val)}" placeholder="${placeholder}" style="${inpStyle}${extra}" />`;
  }
  function sel(idx, field, opts, extra='') {
    return `<select class="tbl-sel" data-idx="${idx}" data-field="${field}" style="${selStyle}${extra}">${opts}</select>`;
  }
  function ninp(field, val, placeholder, extra='') {
    return `<input class="new-inp" data-field="${field}" value="${esc(val)}" placeholder="${placeholder}" style="${inpStyle}${extra}" />`;
  }
  function nsel(field, opts, extra='') {
    return `<select class="new-sel" data-field="${field}" style="${selStyle}${extra}">${opts}</select>`;
  }

  // ── 날짜 파싱/변환 ──────────────────────────────────────
  function parseDateStr(s) {
    if (!s) return 99999;
    s = String(s);
    // yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [,m,d] = s.split('-');
      return +m * 100 + +d;
    }
    // m/d or mm/dd
    const parts = s.split('/');
    if (parts.length === 2) return +parts[0] * 100 + +parts[1];
    return 99999;
  }

  function normalizeDate(raw) {
    if (!raw) return '';
    raw = String(raw).trim();
    const month = APP_STATE.currentMonth; // 'YYYY-MM'
    const [year, mon] = month.split('-');

    // 숫자만 입력 → 일로 처리
    if (/^\d{1,2}$/.test(raw)) {
      return `${year}-${mon}-${raw.padStart(2,'0')}`;
    }
    // m/d or mm/dd
    if (/^\d{1,2}\/\d{1,2}$/.test(raw)) {
      const [m, d] = raw.split('/');
      return `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    // 이미 yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return raw;
  }

  // ── 이벤트 ──────────────────────────────────────────────
  function onInput(e) {
    const el = e.target;
    if (el.classList.contains('new-inp')) {
      if (el.dataset.field === 'item' && el.value.trim().length >= 1) {
        // 항목 입력 시작하면 새 행으로 추가 — 커서는 그대로
        const newRow = buildNewRow();
        if (newRow.item || newRow.amount || newRow.date) {
          commitNewRow(false); // false = 커서 이동 안 함
        }
      }
      return;
    }
    const idx = +el.dataset.idx;
    const field = el.dataset.field;
    if (isNaN(idx) || !field) return;
    if (field === 'amount') {
      const raw = el.value.replace(/[^0-9]/g,'');
      _rows[idx].amount = raw ? +raw : '';
      if (raw) el.value = Utils.fmt(raw);
    } else {
      _rows[idx][field] = el.value;
    }
    scheduleSave();
  }

  function onChange(e) {
    const el = e.target;
    if (el.classList.contains('new-sel') || el.classList.contains('new-chk')) return;
    const idx = +el.dataset.idx;
    const field = el.dataset.field;
    if (isNaN(idx) || !field) return;
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
    scheduleSave();
  }

  function onClick(e) {
    hideCtxMenu();
    const btn = e.target.closest('.sp-rm');
    if (!btn) return;
    const idx = +btn.dataset.idx;
    _rows.splice(idx, 1);
    if (!_rows.length) _rows.push(emptyRow());
    renderTable();
    scheduleSave();
  }

  function onKeydown(e) {
    const el = e.target;
    if (e.key === 'Tab' && el.classList.contains('new-inp') && el.dataset.field === 'amount') {
      commitNewRow(false);
    }
    if (e.key === 'Enter' && el.classList.contains('tbl-inp') && el.dataset.field === 'date') {
      const raw = el.value;
      el.value = normalizeDate(raw);
      _rows[+el.dataset.idx].date = el.value;
      scheduleSave();
    }
    if (e.key === 'Enter' && el.classList.contains('new-inp') && el.dataset.field === 'item') {
      e.preventDefault();
      commitNewRow(false);
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
    const tr = e.target.closest('tr[data-row-idx]');
    if (!tr) return;
    _contextMenuIdx = +tr.dataset.rowIdx;
    const menu = Utils.el('sp-ctx-menu');
    menu.style.display = 'block';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';
  }

  function bindContextMenu() {
    Utils.el('sp-ctx-memo')?.addEventListener('click', () => {
      hideCtxMenu();
      if (_contextMenuIdx === null) return;
      openItemMemo(_contextMenuIdx);
    });
    document.addEventListener('click', hideCtxMenu);
  }

  function hideCtxMenu() {
    const m = Utils.el('sp-ctx-menu');
    if (m) m.style.display = 'none';
  }

  function openItemMemo(idx) {
    Utils.el('item-memo-ta').value = _rows[idx]?.memo || '';
    Utils.el('item-memo-overlay').classList.add('show');
    Utils.el('item-memo-save').onclick = () => {
      const text = Utils.el('item-memo-ta').value.trim();
      _rows[idx].memo = text;
      Utils.el('item-memo-overlay').classList.remove('show');
      // 메모 아이콘 업데이트
      const td = Utils.qs(`tr[data-row-idx="${idx}"] td:nth-child(2)`, Utils.el('sp-tbody'));
      if (td) {
        const existing = td.querySelector('span');
        if (text && !existing) td.insertAdjacentHTML('beforeend', `<span style="color:var(--blue-text);font-size:9px;vertical-align:middle" title="${esc(text)}"> ✎</span>`);
        else if (!text && existing) existing.remove();
        else if (existing) existing.title = text;
      }
      // 메모 영역에 항목 메모 반영
      renderItemMemoSection();
      scheduleSave();
    };
    Utils.el('item-memo-cancel').onclick = () => Utils.el('item-memo-overlay').classList.remove('show');
  }

  function buildNewRow() {
    const nr = Utils.el('sp-new-row');
    if (!nr) return emptyRow();
    const row = emptyRow();
    nr.querySelectorAll('.new-inp').forEach(inp => {
      if (inp.dataset.field === 'amount') {
        const raw = inp.value.replace(/[^0-9]/g,'');
        row.amount = raw ? +raw : '';
      } else if (inp.dataset.field === 'date') {
        row.date = normalizeDate(inp.value);
      } else {
        row[inp.dataset.field] = inp.value;
      }
    });
    nr.querySelectorAll('.new-sel').forEach(s => { row[s.dataset.field] = s.value; });
    nr.querySelectorAll('.new-chk').forEach(c => { row[c.dataset.field] = c.checked; });
    return row;
  }

  function commitNewRow(moveCursor) {
    const row = buildNewRow();
    _rows.push(row);
    renderTable();
    scheduleSave();
    if (moveCursor !== false) {
      setTimeout(() => {
        const nr = Utils.el('sp-new-row');
        nr?.querySelector('[data-field=item]')?.focus();
      }, 30);
    }
  }

  function onCardChange(idx, cardName) {
    const cs = (APP_STATE.settings?.cards||[]).find(c=>c.name===cardName);
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

  // ── 자동저장 ────────────────────────────────────────────
  function scheduleSave() {
    setSaveStatus('...');
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(doSave, DEBOUNCE);
  }

  async function doSave() {
    const validRows = _rows.filter(r => r.item || r.amount);
    try {
      await API.saveTransactions(APP_STATE.currentMonth, validRows);
      APP_STATE.transactions = validRows.map(r=>({...r}));
      setSaveStatus('저장됨');
      setTimeout(()=>setSaveStatus(''), 1500);
      renderDash();
    } catch(e) {
      setSaveStatus('오류');
      // 재시도
      setTimeout(doSave, 3000);
    }
  }

  function setSaveStatus(msg) {
    const el = Utils.el('sp-save-status');
    if (el) el.textContent = msg;
  }

  // ── 메모 영역 ────────────────────────────────────────────
  function renderMemo() {
    const wrap = Utils.el('sp-memo-wrap');
    if (!wrap) return;

    wrap.innerHTML = `
      <div style="padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:10px;font-weight:500;color:var(--text2)">메모</div>
          <div style="position:relative">
            <button id="sp-add-memo-btn" style="font-size:10px;padding:2px 8px;height:22px;border:0.5px solid var(--border2);border-radius:4px;background:var(--bg1);color:var(--text2);cursor:pointer">+ 추가</button>
            <div id="sp-add-memo-menu" style="display:none;position:absolute;right:0;top:24px;background:var(--bg1);border:0.5px solid var(--border2);border-radius:6px;padding:4px 0;z-index:10;min-width:120px;box-shadow:0 4px 12px rgba(0,0,0,.1)">
              <div class="sp-memo-type-opt" data-type="checklist" style="padding:6px 12px;font-size:11px;cursor:pointer" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">체크리스트</div>
              <div class="sp-memo-type-opt" data-type="free" style="padding:6px 12px;font-size:11px;cursor:pointer" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">자유 메모</div>
              <div class="sp-memo-type-opt" data-type="info" style="padding:6px 12px;font-size:11px;cursor:pointer" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">정보</div>
              <div class="sp-memo-type-opt" data-type="image" style="padding:6px 12px;font-size:11px;cursor:pointer" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">이미지</div>
            </div>
          </div>
        </div>
        <div id="sp-memo-cards"></div>
        <div id="sp-item-memos" style="margin-top:8px"></div>
      </div>`;

    Utils.el('sp-add-memo-btn').addEventListener('click', e => {
      e.stopPropagation();
      const menu = Utils.el('sp-add-memo-menu');
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => {
      const m = Utils.el('sp-add-memo-menu');
      if (m) m.style.display = 'none';
    });
    Utils.qsa('.sp-memo-type-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        addMemoCard(opt.dataset.type);
        Utils.el('sp-add-memo-menu').style.display = 'none';
      });
    });

    renderMemoCards();
    renderItemMemoSection();
  }

  function renderMemoCards() {
    const cards = _memo.cards || [];
    const container = Utils.el('sp-memo-cards');
    if (!container) return;

    container.innerHTML = cards.map((card, ci) => memoCardHtml(card, ci)).join('');

    // 이벤트 바인딩
    container.querySelectorAll('.mc-title-inp').forEach(inp => {
      inp.addEventListener('input', e => {
        _memo.cards[+e.target.dataset.ci].title = e.target.value;
        scheduleMemoSave();
      });
    });
    container.querySelectorAll('.mc-del').forEach(btn => {
      btn.addEventListener('click', () => {
        _memo.cards.splice(+btn.dataset.ci, 1);
        renderMemoCards();
        scheduleMemoSave();
      });
    });
    container.querySelectorAll('.mc-add-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const ci = +btn.dataset.ci;
        const card = _memo.cards[ci];
        if (card.type === 'checklist') card.items = card.items || [];
        if (card.type === 'info') card.items = card.items || [];
        card.items.push(card.type === 'checklist' ? {text:'',done:false} : {label:'',value:''});
        renderMemoCards();
        scheduleMemoSave();
      });
    });
    container.querySelectorAll('.mc-item-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const {ci, ii} = btn.dataset;
        _memo.cards[+ci].items.splice(+ii, 1);
        renderMemoCards();
        scheduleMemoSave();
      });
    });
    container.querySelectorAll('.mc-inp').forEach(inp => {
      inp.addEventListener('input', e => {
        const {ci, ii, field} = e.target.dataset;
        const card = _memo.cards[+ci];
        if (card.type === 'free') { card.text = e.target.value; }
        else if (card.type === 'checklist') { card.items[+ii].text = e.target.value; }
        else if (card.type === 'info') { card.items[+ii][field] = e.target.value; }
        scheduleMemoSave();
      });
    });
    container.querySelectorAll('.mc-chk').forEach(chk => {
      chk.addEventListener('change', e => {
        const {ci, ii} = e.target.dataset;
        _memo.cards[+ci].items[+ii].done = e.target.checked;
        const item = e.target.closest('.mc-item');
        if (item) item.style.textDecoration = e.target.checked ? 'line-through' : '';
        scheduleMemoSave();
      });
    });
    // 이미지
    container.querySelectorAll('.mc-img-input').forEach(inp => {
      inp.addEventListener('change', e => {
        const ci = +inp.dataset.ci;
        Array.from(e.target.files).forEach(file => {
          const reader = new FileReader();
          reader.onload = ev => {
            _memo.cards[ci].images = _memo.cards[ci].images || [];
            _memo.cards[ci].images.push({ name: file.name, dataUrl: ev.target.result });
            renderMemoCards();
            scheduleMemoSave();
          };
          reader.readAsDataURL(file);
        });
        e.target.value = '';
      });
    });
    container.querySelectorAll('.mc-img-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const {ci, ii} = btn.dataset;
        _memo.cards[+ci].images.splice(+ii, 1);
        renderMemoCards();
        scheduleMemoSave();
      });
    });
  }

  function memoCardHtml(card, ci) {
    const typeLabel = {checklist:'체크리스트', free:'자유 메모', info:'정보', image:'이미지'}[card.type] || card.type;
    let bodyHtml = '';

    if (card.type === 'checklist') {
      const items = card.items || [];
      bodyHtml = `
        ${items.map((item, ii) => `
          <div class="mc-item" style="display:flex;align-items:center;gap:5px;margin-bottom:3px;${item.done?'text-decoration:line-through;color:var(--text3)':''}">
            <input type="checkbox" class="mc-chk" data-ci="${ci}" data-ii="${ii}" ${item.done?'checked':''} style="accent-color:var(--blue);width:12px;height:12px;flex-shrink:0" />
            <input class="mc-inp" data-ci="${ci}" data-ii="${ii}" value="${esc(item.text||'')}" placeholder="항목..." style="flex:1;border:none;background:transparent;font-size:11px;color:inherit" />
            <button class="mc-item-del" data-ci="${ci}" data-ii="${ii}" style="border:none;background:none;color:var(--text3);cursor:pointer;font-size:12px;padding:0;line-height:1">×</button>
          </div>`).join('')}
        <button class="mc-add-item" data-ci="${ci}" style="font-size:10px;color:var(--text3);border:none;background:none;cursor:pointer;padding:2px 0">+ 항목 추가</button>`;
    } else if (card.type === 'free') {
      bodyHtml = `<textarea class="mc-inp" data-ci="${ci}" style="width:100%;min-height:60px;font-size:11px;padding:5px;border:0.5px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--text1);resize:vertical;font-family:inherit;line-height:1.5" placeholder="자유롭게 입력...">${esc(card.text||'')}</textarea>`;
    } else if (card.type === 'info') {
      const items = card.items || [];
      bodyHtml = `
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          ${items.map((item, ii) => `
            <tr style="border-bottom:0.5px solid var(--border)">
              <td style="padding:2px 0;width:60px"><input class="mc-inp" data-ci="${ci}" data-ii="${ii}" data-field="label" value="${esc(item.label||'')}" placeholder="항목" style="width:100%;border:none;background:transparent;font-size:10px;color:var(--text2)" /></td>
              <td style="padding:2px 4px"><input class="mc-inp" data-ci="${ci}" data-ii="${ii}" data-field="value" value="${esc(item.value||'')}" placeholder="내용" style="width:100%;border:none;background:transparent;font-size:11px" /></td>
              <td style="width:16px"><button class="mc-item-del" data-ci="${ci}" data-ii="${ii}" style="border:none;background:none;color:var(--text3);cursor:pointer;font-size:12px;padding:0">×</button></td>
            </tr>`).join('')}
        </table>
        <button class="mc-add-item" data-ci="${ci}" style="font-size:10px;color:var(--text3);border:none;background:none;cursor:pointer;padding:3px 0">+ 행 추가</button>`;
    } else if (card.type === 'image') {
      const imgs = card.images || [];
      bodyHtml = `
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px">
          ${imgs.map((img, ii) => `
            <div style="position:relative;width:54px;height:40px;border-radius:4px;overflow:hidden;border:0.5px solid var(--border)">
              <img src="${img.dataUrl}" style="width:100%;height:100%;object-fit:cover" />
              <button class="mc-img-del" data-ci="${ci}" data-ii="${ii}" style="position:absolute;top:1px;right:1px;width:13px;height:13px;border-radius:50%;background:rgba(0,0,0,.5);color:#fff;border:none;cursor:pointer;font-size:9px;padding:0;line-height:1">×</button>
            </div>`).join('')}
        </div>
        <label style="font-size:10px;color:var(--text3);cursor:pointer;border:0.5px dashed var(--border2);border-radius:4px;padding:4px 8px;display:inline-block">
          + 이미지 추가
          <input type="file" class="mc-img-input" data-ci="${ci}" accept="image/*" multiple style="display:none" />
        </label>`;
    }

    return `<div style="background:var(--bg1);border-radius:6px;padding:8px 10px;margin-bottom:7px;border:0.5px solid var(--border)">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:6px">
        <input class="mc-title-inp" data-ci="${ci}" value="${esc(card.title||typeLabel)}" style="flex:1;border:none;background:transparent;font-size:10px;font-weight:500;color:var(--text2)" />
        <button class="mc-del" data-ci="${ci}" style="border:none;background:none;color:var(--text3);cursor:pointer;font-size:12px;padding:0" title="삭제">×</button>
      </div>
      ${bodyHtml}
    </div>`;
  }

  function addMemoCard(type) {
    _memo.cards = _memo.cards || [];
    const typeLabel = {checklist:'체크리스트', free:'자유 메모', info:'정보', image:'이미지'}[type];
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
    const withMemo = _rows.filter(r => r.memo && r.item);
    if (!withMemo.length) { container.innerHTML = ''; return; }
    container.innerHTML = `
      <div style="font-size:9px;color:var(--text3);margin-bottom:5px;letter-spacing:.04em">항목 메모</div>
      ${withMemo.map(r => `
        <div style="background:var(--bg1);border-radius:5px;padding:6px 8px;margin-bottom:5px;border:0.5px solid var(--border)">
          <div style="font-size:10px;font-weight:500;color:var(--text2);margin-bottom:2px">${esc(r.item)}</div>
          <div style="font-size:10px;color:var(--text1);line-height:1.5;white-space:pre-wrap">${esc(r.memo)}</div>
        </div>`).join('')}`;
  }

  let _memoSaveTimer = null;
  function scheduleMemoSave() {
    clearTimeout(_memoSaveTimer);
    _memoSaveTimer = setTimeout(async () => {
      try {
        await API.saveMemo(APP_STATE.currentMonth, _memo);
        APP_STATE.memo = JSON.parse(JSON.stringify(_memo));
      } catch {}
    }, DEBOUNCE);
  }

  // ── 유틸 ────────────────────────────────────────────────
  function emptyRow() {
    const settings = APP_STATE.settings || defaultSettings();
    const today = new Date();
    const month = APP_STATE.currentMonth || '';
    const [y, m] = month.split('-');
    const dateStr = y && m ? `${y}-${m}-${String(today.getDate()).padStart(2,'0')}` : (today.getMonth()+1)+'/'+today.getDate();
    return {
      date: dateStr,
      item:'', amount:'', shop:'',
      card: settings.cards?.find(c=>!c.inactive)?.name || '',
      category:'', perf:true, disc:false, status:'', memo:'',
    };
  }

  function updateCount(n) {
    const el = Utils.el('sp-count');
    if (el) el.textContent = `${n}건`;
  }

  function scrollToBottom() {
    setTimeout(() => {
      const wrap = Utils.el('sp-table-wrap');
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
    }, 80);
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, toggleCheck: () => {} };
})();