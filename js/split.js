/**
 * split.js — 분할 뷰 v3
 */

const SplitPage = (() => {
  let _rows = [];
  let _saveTimer = null;
  let _filters = { card: '', category: '', perf: '', status: '' };
  const DEBOUNCE = 1000;

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
    renderFilter();
    renderTable();
    renderMemo();
    scrollToBottom();
  }

  // ── 레이아웃 ────────────────────────────────────────────
  function renderShell() {
    const content = Utils.el('content');
    content.innerHTML = `
      <div id="sp-dash" style="flex-shrink:0;padding:10px 14px;border-bottom:0.5px solid var(--border);overflow-x:auto"></div>
      <div id="sp-filter" style="flex-shrink:0;display:flex;gap:6px;align-items:center;padding:5px 14px;border-bottom:0.5px solid var(--border);flex-wrap:wrap"></div>
      <div style="display:grid;grid-template-columns:1fr 300px;flex:1;overflow:hidden;min-height:0">
        <div style="display:flex;flex-direction:column;overflow:hidden;border-right:0.5px solid var(--border)">
          <div style="overflow:auto;flex:1" id="sp-table-wrap"></div>
        </div>
        <div style="overflow-y:auto;padding:10px 12px;background:var(--bg2)" id="sp-memo"></div>
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

    const mgPersons = {};
    settings.cards.filter(c => Utils.isMgCard(c.name)).forEach(c => {
      const who = c.name.includes('재욱') ? '재욱' : '나';
      if (!mgPersons[who]) mgPersons[who] = { perf:0, disc:0, perfHurdle:0, discLimit:0 };
      mgPersons[who].perfHurdle = Math.max(mgPersons[who].perfHurdle, c.perf||0);
      mgPersons[who].discLimit  = Math.max(mgPersons[who].discLimit,  c.disc||0);
    });
    rows.forEach(r => {
      if (!Utils.isMgCard(r.card)) return;
      const who = r.card.includes('재욱') ? '재욱' : '나';
      if (!mgPersons[who]) return;
      const amt = Utils.parseNum(r.amount);
      if (r.perf) mgPersons[who].perf += amt;
      if (r.disc) mgPersons[who].disc += amt;
    });

    const catMap = {};
    rows.forEach(r => { if (r.category) catMap[r.category] = (catMap[r.category]||0) + Utils.parseNum(r.amount); });
    const topCats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,4);
    const maxCat = topCats[0]?.[1] || 1;

    Utils.el('sp-dash').innerHTML = `
      <div style="display:flex;gap:7px;align-items:stretch;min-width:max-content">
        <div class="card" style="min-width:130px;padding:8px 10px">
          <div class="dc-label">총 지출</div>
          <div style="font-size:14px;font-weight:500;font-variant-numeric:tabular-nums">${Utils.fmt(total)}</div>
          ${budget?`<div style="font-size:9px;color:var(--text3)">목표 ${Utils.fmt(budget)}</div>
          <div class="pbar"><div class="pbar-fill ${color}" style="width:${Math.min(pct*100,100)}%"></div></div>`:''}
        </div>
        ${Object.entries(mgPersons).map(([who,d])=>{
          const pp=d.perfHurdle?Math.min(d.perf/d.perfHurdle,1):0;
          const dp=d.discLimit?Math.min(d.disc/d.discLimit,1):0;
          const pc=pp>=1?'pbar-green':pp>=0.8?'pbar-amber':'pbar-red';
          const dc=dp>=1?'pbar-green':dp>=0.8?'pbar-amber':'pbar-blue';
          return `<div class="card" style="min-width:150px;padding:8px 10px">
            <div class="dc-label">mg+s ${who}</div>
            ${d.perfHurdle?`<div class="mg-bar-row" style="margin-top:3px">
              <div class="mg-bar-lbl">실적</div>
              <div class="mg-bar-track"><div class="mg-bar-fill ${pc}" style="width:${pp*100}%"></div></div>
              <div class="mg-bar-val">${Utils.fmt(d.perf)} / ${Utils.fmt(d.perfHurdle)}</div>
            </div>`:''}
            ${d.discLimit?`<div class="mg-bar-row" style="margin-top:2px">
              <div class="mg-bar-lbl">할인</div>
              <div class="mg-bar-track"><div class="mg-bar-fill ${dc}" style="width:${dp*100}%"></div></div>
              <div class="mg-bar-val">${Utils.fmt(d.disc)} / ${Utils.fmt(d.discLimit)}</div>
            </div>`:''}
          </div>`;
        }).join('')}
        ${topCats.length?`<div class="card" style="min-width:170px;padding:8px 10px">
          <div class="dc-label" style="margin-bottom:4px">구분별</div>
          ${topCats.map(([cat,amt])=>`
          <div class="cat-bar-row" style="margin-bottom:2px">
            <div class="cat-bar-name" style="font-size:10px">${cat}</div>
            <div class="cat-bar-track"><div class="cat-bar-fill pbar-blue" style="width:${amt/maxCat*100}%"></div></div>
            <div class="cat-bar-val" style="font-size:10px">${Utils.fmt(amt)}</div>
          </div>`).join('')}
        </div>`:''}
        <div style="font-size:10px;color:var(--text3);align-self:flex-end;padding-bottom:2px" id="sp-save-status"></div>
      </div>`;
  }

  // ── 필터 ────────────────────────────────────────────────
  function renderFilter() {
    const settings = APP_STATE.settings || defaultSettings();
    const cards = settings.cards.map(c => c.name);
    const cats  = settings.categories.map(c => c.name);

    Utils.el('sp-filter').innerHTML = `
      <span style="font-size:10px;color:var(--text2)">필터</span>
      <select id="f-card" style="height:24px;font-size:11px;padding:0 5px;border:0.5px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--text1)">
        <option value="">카드 전체</option>
        ${cards.map(c=>`<option value="${c}">${c}</option>`).join('')}
      </select>
      <select id="f-cat" style="height:24px;font-size:11px;padding:0 5px;border:0.5px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--text1)">
        <option value="">구분 전체</option>
        ${cats.map(c=>`<option value="${c}">${c}</option>`).join('')}
      </select>
      <select id="f-perf" style="height:24px;font-size:11px;padding:0 5px;border:0.5px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--text1)">
        <option value="">실적 전체</option>
        <option value="y">포함만</option>
        <option value="n">미포함만</option>
      </select>
      <select id="f-status" style="height:24px;font-size:11px;padding:0 5px;border:0.5px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--text1)">
        <option value="">상태 전체</option>
        <option value="1">배송</option>
        <option value="2">확인</option>
        <option value="3">예정</option>
      </select>
      <span style="font-size:10px;color:var(--text2);margin-left:4px" id="sp-count"></span>`;

    ['f-card','f-cat','f-perf','f-status'].forEach(id => {
      Utils.el(id).addEventListener('change', () => {
        _filters.card     = Utils.el('f-card').value;
        _filters.category = Utils.el('f-cat').value;
        _filters.perf     = Utils.el('f-perf').value;
        _filters.status   = Utils.el('f-status').value;
        renderTable();
      });
    });
  }

  // ── 테이블 ──────────────────────────────────────────────
  function renderTable() {
    const settings = APP_STATE.settings || defaultSettings();
    const cards = settings.cards.map(c => c.name);
    const cats  = settings.categories.map(c => c.name);

    const wrap = Utils.el('sp-table-wrap');
    wrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
        <colgroup>
          <col style="width:50px"><col style="width:120px"><col style="width:76px">
          <col style="width:108px"><col style="width:72px"><col style="width:26px">
          <col style="width:26px"><col style="width:52px"><col style="width:22px">
        </colgroup>
        <thead>
          <tr style="position:sticky;top:0;background:var(--bg1);z-index:1;border-bottom:0.5px solid var(--border)">
            <th style="padding:4px 4px;font-size:9px;color:var(--text2);font-weight:500;text-align:left">날짜</th>
            <th style="padding:4px 4px;font-size:9px;color:var(--text2);font-weight:500;text-align:left">항목</th>
            <th style="padding:4px 4px;font-size:9px;color:var(--text2);font-weight:500;text-align:right">금액</th>
            <th style="padding:4px 4px;font-size:9px;color:var(--text2);font-weight:500;text-align:left">카드</th>
            <th style="padding:4px 4px;font-size:9px;color:var(--text2);font-weight:500;text-align:left">구분</th>
            <th style="padding:4px 4px;font-size:9px;color:var(--text2);font-weight:500;text-align:center">실적</th>
            <th style="padding:4px 4px;font-size:9px;color:var(--text2);font-weight:500;text-align:center">할인</th>
            <th style="padding:4px 4px;font-size:9px;color:var(--text2);font-weight:500;text-align:left">상태</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="sp-tbody"></tbody>
      </table>`;

    const tbody = Utils.el('sp-tbody');

    // 필터 적용
    const filtered = _rows.filter((r, idx) => {
      r._idx = idx; // 원본 인덱스 보존
      if (_filters.card     && r.card !== _filters.card) return false;
      if (_filters.category && r.category !== _filters.category) return false;
      if (_filters.perf === 'y' && !r.perf) return false;
      if (_filters.perf === 'n' && r.perf) return false;
      if (_filters.status   && r.status !== _filters.status) return false;
      return true;
    });

    // 날짜 파싱으로 정렬 (오름차순 — 최신이 아래)
    const sorted = [...filtered].sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date));

    tbody.innerHTML = sorted.map(row => rowHtml(row, row._idx, cards, cats)).join('') + emptyRowHtml();

    tbody.addEventListener('input',   onInput);
    tbody.addEventListener('change',  onChange);
    tbody.addEventListener('click',   onClick);
    tbody.addEventListener('keydown', onKeydown);

    updateCount(filtered.length);
    scrollToBottom();
  }

  function parseDateStr(s) {
    if (!s) return 99999;
    const [m,d] = String(s).split('/').map(Number);
    return (m||0)*100+(d||0);
  }

  function rowHtml(row, idx, cards, cats) {
    const isMg = Utils.isMgCard(row.card);
    const cardOpts = cards.map(c=>`<option value="${c}"${c===row.card?' selected':''}>${c}</option>`).join('');
    const catOpts  = '<option value="">-</option>'+cats.map(c=>`<option value="${c}"${c===row.category?' selected':''}>${c}</option>`).join('');
    const stOpts   = [['','-'],['1','배송'],['2','확인'],['3','예정']].map(([v,l])=>`<option value="${v}"${row.status===v?' selected':''}>${l}</option>`).join('');
    const amtVal   = row.amount ? Utils.fmt(row.amount) : '';
    const bg = row.status==='3'?'rgba(238,237,254,.5)':row.status==='2'?'rgba(252,235,235,.4)':'';

    const inp = (field, val, placeholder, extra='') =>
      `<input class="tbl-inp" data-idx="${idx}" data-field="${field}" value="${esc(val)}" placeholder="${placeholder}" style="width:100%;height:22px;padding:0 3px;font-size:11px;border:none;background:transparent;color:var(--text1);${extra}" />`;

    const sel = (field, opts, extra='') =>
      `<select class="tbl-sel" data-idx="${idx}" data-field="${field}" style="width:100%;height:22px;padding:0 2px;font-size:10px;border:none;background:transparent;color:var(--text1);${extra}">${opts}</select>`;

    return `<tr data-row-idx="${idx}" style="border-bottom:0.5px solid var(--border);background:${bg}">
      <td style="padding:0 2px">${inp('date', row.date||'', '날짜')}</td>
      <td style="padding:0 2px">${inp('item', row.item||'', '항목명')}</td>
      <td style="padding:0 2px">${inp('amount', amtVal, '0', 'text-align:right')}</td>
      <td style="padding:0 1px">${sel('card', cardOpts)}</td>
      <td style="padding:0 1px">${sel('category', catOpts)}</td>
      <td style="text-align:center;padding:0"><input type="checkbox" data-idx="${idx}" data-field="perf" ${row.perf?'checked':''} style="accent-color:var(--blue);width:12px;height:12px" /></td>
      <td style="text-align:center;padding:0"><input type="checkbox" data-idx="${idx}" data-field="disc" ${row.disc?'checked':''} ${!isMg?'disabled':''} style="accent-color:var(--blue);width:12px;height:12px" /></td>
      <td style="padding:0 1px">${sel('status', stOpts, 'font-size:10px')}</td>
      <td style="padding:0 1px"><button class="sp-rm" data-idx="${idx}" style="width:18px;height:18px;border:none;background:none;color:var(--text3);cursor:pointer;font-size:12px;padding:0;line-height:1">-</button></td>
    </tr>`;
  }

  function emptyRowHtml() {
    const settings = APP_STATE.settings || defaultSettings();
    const cards = settings.cards.map(c => c.name);
    const cats  = settings.categories.map(c => c.name);
    const newIdx = _rows.length; // 새 행 인덱스
    const cardOpts = cards.map(c=>`<option value="${c}">${c}</option>`).join('');
    const catOpts  = '<option value="">-</option>'+cats.map(c=>`<option value="${c}">${c}</option>`).join('');
    const stOpts   = [['','-'],['1','배송'],['2','확인'],['3','예정']].map(([v,l])=>`<option value="${v}">${l}</option>`).join('');

    const inp = (field, placeholder, extra='') =>
      `<input class="tbl-inp new-inp" data-field="${field}" placeholder="${placeholder}" style="width:100%;height:22px;padding:0 3px;font-size:11px;border:none;background:transparent;color:var(--text1);${extra}" />`;
    const sel = (field, opts) =>
      `<select class="tbl-sel new-sel" data-field="${field}" style="width:100%;height:22px;padding:0 2px;font-size:10px;border:none;background:transparent;color:var(--text1)">${opts}</select>`;

    return `<tr id="sp-new-row" style="border-bottom:0.5px solid var(--border);background:var(--bg2)">
      <td style="padding:0 2px">${inp('date','날짜')}</td>
      <td style="padding:0 2px">${inp('item','항목명')}</td>
      <td style="padding:0 2px">${inp('amount','0','text-align:right')}</td>
      <td style="padding:0 1px">${sel('card',cardOpts)}</td>
      <td style="padding:0 1px">${sel('category',catOpts)}</td>
      <td style="text-align:center;padding:0"><input type="checkbox" class="new-chk" data-field="perf" checked style="accent-color:var(--blue);width:12px;height:12px" /></td>
      <td style="text-align:center;padding:0"><input type="checkbox" class="new-chk" data-field="disc" style="accent-color:var(--blue);width:12px;height:12px" /></td>
      <td style="padding:0 1px">${sel('status',stOpts)}</td>
      <td></td>
    </tr>`;
  }

  // ── 이벤트 ──────────────────────────────────────────────
  function onInput(e) {
    const el = e.target;

    // 빈 새 행 입력
    if (el.classList.contains('new-inp')) {
      // 항목이나 금액 입력 시작하면 새 행 추가
      if (el.dataset.field === 'item' && el.value.length === 1) {
        commitNewRow();
      }
      return;
    }

    const idx = +el.dataset.idx;
    const field = el.dataset.field;
    if (!field || isNaN(idx)) return;

    if (field === 'amount') {
      const raw = el.value.replace(/[^0-9]/g, '');
      _rows[idx].amount = raw ? +raw : '';
      if (raw) el.value = Utils.fmt(raw);
    } else {
      _rows[idx][field] = el.value;
    }
    scheduleSave();
  }

  function onChange(e) {
    const el = e.target;

    // 새 행 select 변경
    if (el.classList.contains('new-sel') || el.classList.contains('new-chk')) return;

    const idx = +el.dataset.idx;
    const field = el.dataset.field;
    if (!field || isNaN(idx)) return;

    if (el.type === 'checkbox') {
      _rows[idx][field] = el.checked;
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
    _rows.splice(idx, 1);
    if (!_rows.length) _rows.push(emptyRow());
    renderTable();
    scheduleSave();
  }

  function onKeydown(e) {
    const el = e.target;
    if (e.key === 'Enter' && el.classList.contains('new-inp') && el.dataset.field === 'item') {
      e.preventDefault();
      commitNewRow();
    }
  }

  function commitNewRow() {
    const newRowEl = Utils.el('sp-new-row');
    if (!newRowEl) return;

    const row = emptyRow();
    newRowEl.querySelectorAll('.new-inp').forEach(inp => {
      if (inp.dataset.field === 'amount') {
        const raw = inp.value.replace(/[^0-9]/g, '');
        row.amount = raw ? +raw : '';
      } else {
        row[inp.dataset.field] = inp.value;
      }
    });
    newRowEl.querySelectorAll('.new-sel').forEach(sel => {
      row[sel.dataset.field] = sel.value;
    });
    newRowEl.querySelectorAll('.new-chk').forEach(chk => {
      row[chk.dataset.field] = chk.checked;
    });

    _rows.push(row);
    renderTable();
    scheduleSave();

    // 새 빈 행 항목 포커스
    setTimeout(() => {
      const newRow = Utils.el('sp-new-row');
      if (newRow) newRow.querySelector('[data-field=item]')?.focus();
    }, 50);
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

  function updateRowBg(idx) {
    const tr = Utils.qs(`tr[data-row-idx="${idx}"]`, Utils.el('sp-tbody'));
    if (!tr) return;
    const s = _rows[idx].status;
    tr.style.background = s==='3'?'rgba(238,237,254,.5)':s==='2'?'rgba(252,235,235,.4)':'';
  }

  // ── 자동저장 ────────────────────────────────────────────
  function scheduleSave() {
    setSaveStatus('저장 중...');
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(doSave, DEBOUNCE);
  }

  async function doSave() {
    const validRows = _rows.filter(r => r.item || r.amount);
    try {
      await API.saveTransactions(APP_STATE.currentMonth, validRows);
      APP_STATE.transactions = validRows.map(r=>({...r}));
      setSaveStatus('저장됨');
      setTimeout(() => setSaveStatus(''), 2000);
      renderDash();
    } catch(e) {
      setSaveStatus('저장 실패: ' + e.message);
    }
  }

  function setSaveStatus(msg) {
    const el = Utils.el('sp-save-status');
    if (el) el.textContent = msg;
  }

  // ── 메모 ────────────────────────────────────────────────
  function renderMemo() {
    const memo = APP_STATE.memo || defaultMemo();
    const el = Utils.el('sp-memo');
    if (!el) return;

    const payments  = memo.payments  || [];
    const checklist = memo.checklist || [];
    const freeText  = memo.freeText  || '';

    el.innerHTML = `
      <div style="font-size:10px;font-weight:500;color:var(--text2);margin-bottom:7px">메모</div>
      ${payments.length ? `
      <div class="card" style="margin-bottom:7px;padding:8px 10px">
        <div style="font-size:9px;font-weight:500;color:var(--text2);margin-bottom:5px">결제 정보</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          ${payments.map(p=>`<tr>
            <td style="padding:2px 0;color:var(--text2);width:60px;border-bottom:0.5px solid var(--border)">${esc(p.label||'')}</td>
            <td style="padding:2px 0;border-bottom:0.5px solid var(--border)">${esc(p.value||'')}</td>
          </tr>`).join('')}
        </table>
      </div>` : ''}
      ${checklist.length ? `
      <div class="card" style="margin-bottom:7px;padding:8px 10px">
        <div style="font-size:9px;font-weight:500;color:var(--text2);margin-bottom:5px">체크리스트</div>
        ${checklist.map((item,i)=>`
          <div style="display:flex;align-items:center;gap:5px;font-size:11px;margin-bottom:3px${item.done?';color:var(--text3);text-decoration:line-through':''}">
            <input type="checkbox" ${item.done?'checked':''} style="accent-color:var(--blue);width:12px;height:12px;flex-shrink:0" onchange="SplitPage.toggleCheck(${i},this.checked)" />
            <span>${esc(item.text||'')}</span>
          </div>`).join('')}
      </div>` : ''}
      ${freeText ? `
      <div class="card" style="padding:8px 10px">
        <div style="font-size:9px;font-weight:500;color:var(--text2);margin-bottom:4px">메모</div>
        <div style="font-size:10px;color:var(--text2);white-space:pre-wrap;line-height:1.6">${esc(freeText.slice(0,300))}${freeText.length>300?'…':''}</div>
      </div>` : ''}`;
  }

  async function toggleCheck(idx, checked) {
    if (!APP_STATE.memo?.checklist?.[idx]) return;
    APP_STATE.memo.checklist[idx].done = checked;
    try { await API.saveMemo(APP_STATE.currentMonth, APP_STATE.memo); } catch {}
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

  function updateCount(n) {
    const el = Utils.el('sp-count');
    if (el) el.textContent = `${n !== undefined ? n : _rows.filter(r=>r.item||r.amount).length}건`;
  }

  function scrollToBottom() {
    setTimeout(() => {
      const wrap = Utils.el('sp-table-wrap');
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
    }, 50);
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, toggleCheck };
})();