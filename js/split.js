/**
 * split.js — 분할 뷰 (입력 + 내역 + 대시보드 동시 표시)
 */

const SplitPage = (() => {

  async function init() {
    await ensureTransactions();
    render();
  }

  function render() {
    const content = Utils.el('content');
    content.style.padding = '0';
    content.innerHTML = `
      <div id="split-wrap" style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto 1fr;height:100%;overflow:hidden;">

        <!-- 좌상: 입력 -->
        <div style="border-right:0.5px solid var(--border);border-bottom:0.5px solid var(--border);overflow-y:auto;padding:12px 14px;">
          <div style="font-size:10px;font-weight:500;color:var(--text2);margin-bottom:8px;letter-spacing:.03em">입력</div>
          <div id="split-input-area"></div>
        </div>

        <!-- 우상: 대시보드 요약 -->
        <div style="border-bottom:0.5px solid var(--border);overflow-y:auto;padding:12px 14px;">
          <div style="font-size:10px;font-weight:500;color:var(--text2);margin-bottom:8px;letter-spacing:.03em">이번달 현황</div>
          <div id="split-dash-area"></div>
        </div>

        <!-- 하단 전체: 내역 -->
        <div style="grid-column:1/-1;overflow-y:auto;padding:12px 14px;">
          <div style="font-size:10px;font-weight:500;color:var(--text2);margin-bottom:8px;letter-spacing:.03em">내역</div>
          <div id="split-ledger-area"></div>
        </div>
      </div>`;

    renderInput();
    renderDash();
    renderLedger();
  }

  // ── 입력 영역 ────────────────────────────────────────────
  function renderInput() {
    const settings = APP_STATE.settings || defaultSettings();
    const cards = settings.cards.map(c => c.name);
    const cats  = settings.categories.map(c => c.name);
    const rows  = APP_STATE.transactions.length
      ? APP_STATE.transactions.map(r => ({...r}))
      : [emptyRow(settings)];

    const headerHtml = `
      <div class="input-header" style="font-size:9px;">
        <span class="col-label">날짜</span>
        <span class="col-label">항목</span>
        <span class="col-label" style="text-align:right">금액</span>
        <span class="col-label">카드</span>
        <span class="col-label">구분</span>
        <span class="col-label center">실적</span>
        <span class="col-label center">할인</span>
        <span class="col-label">상태</span>
        <span></span>
        <span></span>
      </div>`;

    const rowsHtml = rows.map((row, idx) => renderInputRow(row, idx, cards, cats)).join('');

    const area = Utils.el('split-input-area');
    area.innerHTML = `
      ${headerHtml}
      <div id="split-rows">${rowsHtml}</div>
      <button class="add-row-btn" id="split-add-btn">+ 행 추가</button>
      <div style="display:flex;justify-content:space-between;align-items:center;border-top:0.5px solid var(--border);margin-top:8px;padding-top:8px">
        <span style="font-size:10px;color:var(--text2)" id="split-count">${rows.length}건</span>
        <button class="btn btn-primary btn-sm" onclick="InputPage.save()">저장</button>
      </div>`;

    // InputPage 상태와 동기화 — split도 InputPage.init() 내부 _rows를 씀
    InputPage.init().then(() => {});

    Utils.el('split-add-btn').addEventListener('click', () => {
      InputPage.addRow();
      // 내역/대시 새로고침
      setTimeout(() => { renderLedger(); renderDash(); }, 300);
    });
  }

  function renderInputRow(row, idx, cards, cats) {
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

    return `<div class="input-row" data-idx="${idx}">
      <input type="text" data-field="date" value="${row.date||''}" placeholder="날짜"/>
      <input type="text" data-field="item" value="${row.item||''}" placeholder="항목"/>
      <input type="text" data-field="amount" value="${amtVal}" placeholder="0" style="text-align:right"/>
      <select data-field="card">${cardOpts}</select>
      <select data-field="category">${catOpts}</select>
      <div class="chk-wrap"><input type="checkbox" data-field="perf" ${row.perf?'checked':''}/></div>
      <div class="chk-wrap"><input type="checkbox" data-field="disc" ${row.disc?'checked':''} ${!isMg?'disabled':''}/></div>
      <select data-field="status" style="font-size:10px;padding:0 2px">${statusOpts}</select>
      <span></span>
      <button class="btn-icon rm-btn" style="width:20px;height:20px;font-size:12px" data-rm-idx="${idx}">-</button>
    </div>`;
  }

  function emptyRow(settings) {
    const today = new Date();
    return {
      date: (today.getMonth()+1)+'/'+today.getDate(),
      item:'', amount:'', shop:'',
      card: settings.cards[0]?.name || '',
      category:'', perf:true, disc:false, status:'', memo:'',
    };
  }

  // ── 대시보드 요약 ─────────────────────────────────────────
  function renderDash() {
    const settings = APP_STATE.settings || defaultSettings();
    const rows = APP_STATE.transactions;
    const total = rows.reduce((s,r) => s + Utils.parseNum(r.amount), 0);
    const budget = settings.totalBudget || 0;
    const pct = budget ? Math.min(total/budget, 1) : 0;
    const color = pct >= 1 ? 'pbar-red' : pct >= 0.8 ? 'pbar-amber' : 'pbar-green';

    // mg+s 집계
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

    const area = Utils.el('split-dash-area');
    if (!area) return;
    area.innerHTML = `
      <div class="card" style="margin-bottom:8px">
        <div class="dc-label">총 지출</div>
        <div class="dc-val" style="font-size:15px">${Utils.fmt(total)}</div>
        ${budget ? `<div class="dc-sub">목표 ${Utils.fmt(budget)}</div>
        <div class="pbar"><div class="pbar-fill ${color}" style="width:${Math.min(pct*100,100)}%"></div></div>` : ''}
      </div>
      ${Object.entries(mgPersons).map(([who, d]) => {
        const pp = d.perfHurdle ? Math.min(d.perf/d.perfHurdle,1) : 0;
        const dp = d.discLimit  ? Math.min(d.disc/d.discLimit,1)  : 0;
        const pc = pp>=1?'pbar-green':pp>=0.8?'pbar-amber':'pbar-red';
        const dc = dp>=1?'pbar-green':dp>=0.8?'pbar-amber':'pbar-blue';
        return `<div class="card" style="margin-bottom:6px">
          <div class="dc-label">mg+s ${who}</div>
          ${d.perfHurdle ? `<div class="mg-bar-row" style="margin-top:4px">
            <div class="mg-bar-lbl">실적</div>
            <div class="mg-bar-track"><div class="mg-bar-fill ${pc}" style="width:${pp*100}%"></div></div>
            <div class="mg-bar-val">${Utils.fmt(d.perf)} / ${Utils.fmt(d.perfHurdle)}</div>
          </div>` : ''}
          ${d.discLimit ? `<div class="mg-bar-row" style="margin-top:4px">
            <div class="mg-bar-lbl">할인</div>
            <div class="mg-bar-track"><div class="mg-bar-fill ${dc}" style="width:${dp*100}%"></div></div>
            <div class="mg-bar-val">${Utils.fmt(d.disc)} / ${Utils.fmt(d.discLimit)}</div>
          </div>` : ''}
        </div>`;
      }).join('')}`;
  }

  // ── 내역 테이블 ──────────────────────────────────────────
  function renderLedger() {
    const rows = [...APP_STATE.transactions].sort((a,b) => {
      const pa = parseDateStr(a.date), pb = parseDateStr(b.date);
      return pb - pa;
    });
    const total = rows.reduce((s,r) => s + Utils.parseNum(r.amount), 0);

    const area = Utils.el('split-ledger-area');
    if (!area) return;

    if (!rows.length) {
      area.innerHTML = '<div style="color:var(--text3);font-size:11px;padding:16px 0;text-align:center">내역 없음</div>';
      return;
    }

    area.innerHTML = `
      <div style="overflow-x:auto">
      <table class="ledger-table" style="min-width:500px">
        <colgroup><col style="width:38px"><col style="width:100px"><col style="width:56px"><col style="width:70px"><col style="width:86px"><col style="width:52px"><col style="width:24px"><col style="width:24px"><col style="width:36px"></colgroup>
        <thead><tr>
          <th>날짜</th><th>항목</th><th>쇼핑몰</th>
          <th style="text-align:right">금액</th><th>카드</th><th>구분</th>
          <th>실적</th><th>할인</th><th>상태</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td>${r.date||''}</td>
            <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.item||'')}</td>
            <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.shop||'')}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${Utils.fmt(r.amount)}</td>
            <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.card||'')}</td>
            <td>${esc(r.category||'-')}</td>
            <td>${r.perf ? '<span class="badge badge-green">O</span>' : '<span class="badge badge-gray">X</span>'}</td>
            <td>${Utils.isMgCard(r.card) ? (r.disc ? '<span class="badge badge-blue">O</span>' : '<span class="badge badge-gray">X</span>') : '-'}</td>
            <td>${statusBadge(r.status)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>
      <div style="display:flex;justify-content:space-between;border-top:0.5px solid var(--border);padding-top:6px;margin-top:4px">
        <span style="font-size:10px;color:var(--text2)">${rows.length}건</span>
        <span style="font-size:12px;font-weight:500">합계 ${Utils.fmt(total)}</span>
      </div>`;
  }

  function parseDateStr(s) {
    if (!s) return 0;
    const [m,d] = String(s).split('/').map(Number);
    return (m||0)*100+(d||0);
  }

  function statusBadge(s) {
    if (s==='1') return '<span class="badge badge-amber">배송</span>';
    if (s==='2') return '<span class="badge badge-red">확인</span>';
    if (s==='3') return '<span class="badge badge-purple">예정</span>';
    return '';
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init };
})();