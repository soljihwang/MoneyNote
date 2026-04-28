/**
 * split.js — 분할 뷰 v2
 * 상단: 대시보드 요약
 * 하단 좌: 내역+입력 통합 테이블 (인라인 편집, 자동저장)
 * 하단 우: 메모 요약
 */

const SplitPage = (() => {
  let _rows = [];
  let _saveTimer = null;
  let _editingCell = null;
  const DEBOUNCE = 800;

  // ── 초기화 ──────────────────────────────────────────────
  async function init() {
    const content = Utils.el('content');
    content.style.padding = '0';
    content.style.overflow = 'hidden';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';

    await ensureTransactions();
    await ensureMemo();
    _rows = APP_STATE.transactions.length
      ? APP_STATE.transactions.map(r => ({...r}))
      : [emptyRow()];

    renderShell();
    renderDash();
    renderTable();
    renderMemo();
  }

  // ── 전체 레이아웃 ────────────────────────────────────────
  function renderShell() {
    const content = Utils.el('content');
    content.innerHTML = `
      <div id="sp-dash" style="flex-shrink:0;padding:12px 16px;border-bottom:0.5px solid var(--border);overflow-y:auto;max-height:200px"></div>
      <div style="display:grid;grid-template-columns:1fr 320px;flex:1;overflow:hidden;min-height:0">
        <div style="display:flex;flex-direction:column;overflow:hidden;border-right:0.5px solid var(--border)">
          <div style="font-size:10px;font-weight:500;color:var(--text2);padding:8px 14px 6px;flex-shrink:0;border-bottom:0.5px solid var(--border)">
            내역 <span id="sp-count" style="color:var(--text3)"></span>
            <span id="sp-save-status" style="float:right;font-size:9px;color:var(--text3)"></span>
          </div>
          <div style="overflow:auto;flex:1" id="sp-table-wrap"></div>
        </div>
        <div style="overflow-y:auto;padding:12px 14px" id="sp-memo"></div>
      </div>`;
  }

  // ── 대시보드 ────────────────────────────────────────────
  function renderDash() {
    const settings = APP_STATE.settings || defaultSettings();
    const rows = _rows.filter(r => r.item || r.amount);
    const total = rows.reduce((s, r) => s + Utils.parseNum(r.amount), 0);
    const budget = settings.totalBudget || 0;
    const pct = budget ? Math.min(total / budget, 1) : 0;
    const color = pct >= 1 ? 'pbar-red' : pct >= 0.8 ? 'pbar-amber' : 'pbar-green';

    // mg+s
    const mgPersons = {};
    settings.cards.filter(c => Utils.isMgCard(c.name)).forEach(c => {
      const who = c.name.includes('재욱') ? '재욱' : '나';
      if (!mgPersons[who]) mgPersons[who] = { perf: 0, disc: 0, perfHurdle: 0, discLimit: 0 };
      mgPersons[who].perfHurdle = Math.max(mgPersons[who].perfHurdle, c.perf || 0);
      mgPersons[who].discLimit  = Math.max(mgPersons[who].discLimit,  c.disc || 0);
    });
    rows.forEach(r => {
      if (!Utils.isMgCard(r.card)) return;
      const who = r.card.includes('재욱') ? '재욱' : '나';
      if (!mgPersons[who]) return;
      const amt = Utils.parseNum(r.amount);
      if (r.perf) mgPersons[who].perf += amt;
      if (r.disc) mgPersons[who].disc += amt;
    });

    // 구분별
    const catMap = {};
    rows.forEach(r => {
      if (!r.category) return;
      catMap[r.category] = (catMap[r.category] || 0) + Utils.parseNum(r.amount);
    });
    const topCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 4);

    const dash = Utils.el('sp-dash');
    dash.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:stretch">
        <div class="card" style="min-width:140px;flex:1">
          <div class="dc-label">총 지출</div>
          <div class="dc-val" style="font-size:15px">${Utils.fmt(total)}</div>
          ${budget ? `<div class="dc-sub">목표 ${Utils.fmt(budget)}</div>
          <div class="pbar"><div class="pbar-fill ${color}" style="width:${Math.min(pct*100,100)}%"></div></div>` : ''}
        </div>
        ${Object.entries(mgPersons).map(([who, d]) => {
          const pp = d.perfHurdle ? Math.min(d.perf / d.perfHurdle, 1) : 0;
          const dp = d.discLimit  ? Math.min(d.disc / d.discLimit,  1) : 0;
          const pc = pp>=1?'pbar-green':pp>=0.8?'pbar-amber':'pbar-red';
          const dc = dp>=1?'pbar-green':dp>=0.8?'pbar-amber':'pbar-blue';
          return `<div class="card" style="min-width:140px;flex:1">
            <div class="dc-label">mg+s ${who}</div>
            ${d.perfHurdle ? `<div class="mg-bar-row" style="margin-top:4px">
              <div class="mg-bar-lbl">실적</div>
              <div class="mg-bar-track"><div class="mg-bar-fill ${pc}" style="width:${pp*100}%"></div></div>
              <div class="mg-bar-val">${Utils.fmt(d.perf)} / ${Utils.fmt(d.perfHurdle)}</div>
            </div>` : ''}
            ${d.discLimit ? `<div class="mg-bar-row" style="margin-top:3px">
              <div class="mg-bar-lbl">할인</div>
              <div class="mg-bar-track"><div class="mg-bar-fill ${dc}" style="width:${dp*100}%"></div></div>
              <div class="mg-bar-val">${Utils.fmt(d.disc)} / ${Utils.fmt(d.discLimit)}</div>
            </div>` : ''}
          </div>`;
        }).join('')}
        ${topCats.length ? `<div class="card" style="min-width:160px;flex:1.5">
          <div class="dc-label" style="margin-bottom:5px">구분별</div>
          ${topCats.map(([cat, amt]) => {
            const max = topCats[0][1];
            return `<div class="cat-bar-row" style="margin-bottom:3px">
              <div class="cat-bar-name" style="font-size:10px">${cat}</div>
              <div class="cat-bar-track"><div class="cat-bar-fill pbar-blue" style="width:${(amt/max*100)}%"></div></div>
              <div class="cat-bar-val" style="font-size:10px">${Utils.fmt(amt)}</div>
            </div>`;
          }).join('')}
        </div>` : ''}
      </div>`;
  }

  // ── 통합 테이블 ──────────────────────────────────────────
  function renderTable() {
    const settings = APP_STATE.settings || defaultSettings();
    const cards = settings.cards.map(c => c.name);
    const cats  = settings.categories.map(c => c.name);

    const wrap = Utils.el('sp-table-wrap');
    wrap.innerHTML = `
      <table class="ledger-table" id="sp-tbl" style="min-width:560px;table-layout:fixed">
        <colgroup>
          <col style="width:46px"><col style="width:110px"><col style="width:80px">
          <col style="width:106px"><col style="width:64px"><col style="width:28px">
          <col style="width:28px"><col style="width:54px"><col style="width:28px">
        </colgroup>
        <thead><tr>
          <th>날짜</th><th>항목</th><th style="text-align:right">금액</th>
          <th>카드</th><th>구분</th><th>실적</th><th>할인</th><th>상태</th><th></th>
        </tr></thead>
        <tbody id="sp-tbody"></tbody>
      </table>
      <div style="padding:6px 10px">
        <button class="add-row-btn" id="sp-add-btn">+ 행 추가</button>
      </div>`;

    renderRows(cards, cats);
    updateCount();

    Utils.el('sp-add-btn').addEventListener('click', () => {
      _rows.push(emptyRow());
      renderRows(cards, cats);
      updateCount();
      // 새 행 첫 셀 포커스
      const tbody = Utils.el('sp-tbody');
      const lastRow = tbody.lastElementChild;
      if (lastRow) lastRow.querySelector('[data-field=date]')?.focus();
    });
  }

  function renderRows(cards, cats) {
    const settings = APP_STATE.settings || defaultSettings();
    const _cards = cards || settings.cards.map(c => c.name);
    const _cats  = cats  || settings.categories.map(c => c.name);

    const tbody = Utils.el('sp-tbody');
    if (!tbody) return;

    tbody.innerHTML = _rows.map((row, idx) => rowHtml(row, idx, _cards, _cats)).join('');

    // 이벤트 바인딩
    tbody.addEventListener('input',  onInput);
    tbody.addEventListener('change', onChange);
    tbody.addEventListener('click',  onClick);
    tbody.addEventListener('keydown', onKeydown);
  }

  function rowHtml(row, idx, cards, cats) {
    const isMg = Utils.isMgCard(row.card);
    const cardOpts = cards.map(c =>
      `<option value="${c}"${c === row.card ? ' selected' : ''}>${c}</option>`
    ).join('');
    const catOpts = '<option value="">-</option>' + cats.map(c =>
      `<option value="${c}"${c === row.category ? ' selected' : ''}>${c}</option>`
    ).join('');
    const statusOpts = [['','-'],['1','배송'],['2','확인'],['3','예정']].map(
      ([v,l]) => `<option value="${v}"${row.status===v?' selected':''}>${l}</option>`
    ).join('');
    const amtVal = row.amount ? Utils.fmt(row.amount) : '';
    const rowBg = row.status === '3' ? 'background:rgba(238,237,254,.4)' :
                  row.status === '2' ? 'background:rgba(252,235,235,.3)' : '';

    return `<tr data-idx="${idx}" style="${rowBg}">
      <td><input class="tbl-input" data-idx="${idx}" data-field="date" value="${esc(row.date||'')}" placeholder="날짜" /></td>
      <td><input class="tbl-input" data-idx="${idx}" data-field="item" value="${esc(row.item||'')}" placeholder="항목명" /></td>
      <td><input class="tbl-input amt-input" data-idx="${idx}" data-field="amount" value="${amtVal}" placeholder="0" style="text-align:right" /></td>
      <td><select class="tbl-sel" data-idx="${idx}" data-field="card">${cardOpts}</select></td>
      <td><select class="tbl-sel" data-idx="${idx}" data-field="category">${catOpts}</select></td>
      <td style="text-align:center"><input type="checkbox" data-idx="${idx}" data-field="perf" ${row.perf?'checked':''} style="accent-color:var(--blue)" /></td>
      <td style="text-align:center"><input type="checkbox" data-idx="${idx}" data-field="disc" ${row.disc?'checked':''} ${!isMg?'disabled':''} style="accent-color:var(--blue)" /></td>
      <td><select class="tbl-sel" data-idx="${idx}" data-field="status" style="font-size:10px;padding:0 2px">${statusOpts}</select></td>
      <td><button class="btn-icon sp-rm" data-idx="${idx}" style="width:20px;height:20px;font-size:12px">-</button></td>
    </tr>`;
  }

  // ── 이벤트 핸들러 ────────────────────────────────────────
  function onInput(e) {
    const el = e.target;
    const idx = +el.dataset.idx;
    const field = el.dataset.field;
    if (!field || isNaN(idx)) return;

    if (field === 'amount') {
      const raw = el.value.replace(/[^0-9]/g, '');
      _rows[idx].amount = raw ? +raw : '';
      if (APP_STATE.settings?.toggles?.commaFormat && raw) {
        el.value = Utils.fmt(raw);
      }
    } else {
      _rows[idx][field] = el.value;
    }
    scheduleSave();
  }

  function onChange(e) {
    const el = e.target;
    const idx = +el.dataset.idx;
    const field = el.dataset.field;
    if (!field || isNaN(idx)) return;

    if (el.type === 'checkbox') {
      _rows[idx][field] = el.checked;
      if (field === 'perf' || field === 'disc') {
        // 행 배경색 업데이트
        const tr = Utils.qs(`tr[data-idx="${idx}"]`, Utils.el('sp-tbody'));
        if (tr && field === 'disc') {
          const discChk = tr.querySelector('[data-field=disc]');
          if (discChk) discChk.disabled = !Utils.isMgCard(_rows[idx].card);
        }
      }
    } else {
      _rows[idx][field] = el.value;
      if (field === 'card') onCardChange(idx, el.value);
      if (field === 'status') updateRowBg(idx);
    }
    scheduleSave();
  }

  function onClick(e) {
    const btn = e.target.closest('.sp-rm');
    if (!btn) return;
    const idx = +btn.dataset.idx;
    if (_rows.length === 1) { _rows[0] = emptyRow(); }
    else _rows.splice(idx, 1);
    const settings = APP_STATE.settings || defaultSettings();
    renderRows(settings.cards.map(c => c.name), settings.categories.map(c => c.name));
    updateCount();
    scheduleSave();
  }

  function onKeydown(e) {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    const el = e.target;
    if (!el.classList.contains('tbl-input')) return;
    const idx = +el.dataset.idx;
    const field = el.dataset.field;
    // 마지막 행 마지막 입력에서 Enter → 새 행 추가
    if (e.key === 'Enter' && idx === _rows.length - 1 && field === 'item') {
      e.preventDefault();
      Utils.el('sp-add-btn')?.click();
    }
  }

  function onCardChange(idx, cardName) {
    const cs = (APP_STATE.settings?.cards || []).find(c => c.name === cardName);
    if (!cs) return;
    const isMg = Utils.isMgCard(cardName);
    _rows[idx].perf = cs.perfDefault;
    _rows[idx].disc = isMg ? cs.discDefault : false;

    const tr = Utils.qs(`tr[data-idx="${idx}"]`, Utils.el('sp-tbody'));
    if (!tr) return;
    const perfChk = tr.querySelector('[data-field=perf]');
    const discChk = tr.querySelector('[data-field=disc]');
    if (perfChk) perfChk.checked = _rows[idx].perf;
    if (discChk) { discChk.checked = _rows[idx].disc; discChk.disabled = !isMg; }
  }

  function updateRowBg(idx) {
    const tr = Utils.qs(`tr[data-idx="${idx}"]`, Utils.el('sp-tbody'));
    if (!tr) return;
    const s = _rows[idx].status;
    tr.style.background = s === '3' ? 'rgba(238,237,254,.4)' :
                          s === '2' ? 'rgba(252,235,235,.3)' : '';
  }

  // ── 자동저장 ────────────────────────────────────────────
  function scheduleSave() {
    const el = Utils.el('sp-save-status');
    if (el) el.textContent = '저장 중...';
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(doSave, DEBOUNCE);
  }

  async function doSave() {
    const validRows = _rows.filter(r => r.item || r.amount);
    try {
      await API.saveTransactions(APP_STATE.currentMonth, validRows);
      APP_STATE.transactions = validRows.map(r => ({...r}));
      const el = Utils.el('sp-save-status');
      if (el) { el.textContent = '저장됨'; setTimeout(() => { if (el) el.textContent = ''; }, 2000); }
      renderDash(); // 대시보드 실시간 업데이트
    } catch {
      const el = Utils.el('sp-save-status');
      if (el) el.textContent = '저장 실패';
    }
    updateCount();
  }

  // ── 메모 요약 ────────────────────────────────────────────
  function renderMemo() {
    const memo = APP_STATE.memo || defaultMemo();
    const memoEl = Utils.el('sp-memo');
    if (!memoEl) return;

    const payments = (memo.payments || []).slice(0, 8);
    const checklist = memo.checklist || [];
    const freeText = memo.freeText || '';

    memoEl.innerHTML = `
      <div style="font-size:10px;font-weight:500;color:var(--text2);margin-bottom:8px">메모</div>

      ${payments.length ? `
      <div class="card" style="margin-bottom:8px">
        <div class="memo-card-title">결제 정보</div>
        <table class="memo-kv-table">
          ${payments.map(p => `<tr><td>${esc(p.label||'')}</td><td>${esc(p.value||'')}</td></tr>`).join('')}
        </table>
      </div>` : ''}

      ${checklist.length ? `
      <div class="card" style="margin-bottom:8px">
        <div class="memo-card-title">체크리스트</div>
        <div class="checklist">
          ${checklist.map((item, i) => `
            <div class="check-item${item.done?' done':''}">
              <input type="checkbox" ${item.done?'checked':''} onchange="SplitPage.toggleCheck(${i},this.checked)" />
              <span>${esc(item.text||'')}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}

      ${freeText ? `
      <div class="card" style="margin-bottom:8px">
        <div class="memo-card-title">메모</div>
        <div style="font-size:11px;color:var(--text2);white-space:pre-wrap;line-height:1.6">${esc(freeText).slice(0,200)}${freeText.length>200?'...':''}</div>
      </div>` : ''}`;
  }

  // ── 체크리스트 토글 ──────────────────────────────────────
  async function toggleCheck(idx, checked) {
    if (!APP_STATE.memo?.checklist?.[idx]) return;
    APP_STATE.memo.checklist[idx].done = checked;
    try {
      await API.saveMemo(APP_STATE.currentMonth, APP_STATE.memo);
    } catch {}
    renderMemo();
  }

  // ── 유틸 ────────────────────────────────────────────────
  function emptyRow() {
    const settings = APP_STATE.settings || defaultSettings();
    const today = new Date();
    return {
      date: (today.getMonth()+1)+'/'+today.getDate(),
      item:'', amount:'', shop:'',
      card: settings.cards[0]?.name || '',
      category:'', perf:true, disc:false, status:'', memo:'',
    };
  }

  function updateCount() {
    const el = Utils.el('sp-count');
    const valid = _rows.filter(r => r.item || r.amount).length;
    if (el) el.textContent = `(${valid}건)`;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, toggleCheck };
})();