/**
 * dashboard.js — 대시보드 탭
 */

const DashboardPage = (() => {

  async function init() {
    await ensureTransactions();
    const settings = APP_STATE.settings || defaultSettings();
    const rows = APP_STATE.transactions;
    const summary = calcSummary(rows, settings);
    render(summary, settings);
  }

  function calcSummary(rows, settings) {
    const activeCards = (settings.cards || []).filter(c => c && c.name && !c.inactive);
    const total = rows.reduce((s, r) => s + Utils.parseNum(r.amount), 0);

    // 카드별 실적/할인 집계
    const cardMap = {};
    activeCards.forEach(c => {
      cardMap[c.name] = { perf: 0, disc: 0, total: 0 };
    });
    rows.forEach(r => {
      if (!cardMap[r.card]) cardMap[r.card] = { perf: 0, disc: 0, total: 0 };
      const amt = Utils.parseNum(r.amount);
      cardMap[r.card].total += amt;
      if (r.perf) cardMap[r.card].perf += amt;
      if (r.disc) cardMap[r.card].disc += amt;
    });

    // mg+s 나/재욱 통합 (기본 + 할인 카드 합산)
    const mgPersons = {};
    activeCards.forEach(c => {
      if (!Utils.isMgCard(c.name)) return;
      const isDisc = c.name.includes('할인');
      const who = c.name.includes('재욱') ? '재욱' : '나';
      if (!mgPersons[who]) mgPersons[who] = {
        perf: 0, disc: 0,
        perfHurdle: 0, discLimit: 0,
      };
      mgPersons[who].perfHurdle = Math.max(mgPersons[who].perfHurdle, c.perf || 0);
      mgPersons[who].discLimit  = Math.max(mgPersons[who].discLimit,  c.disc || 0);
      const cd = cardMap[c.name] || { perf: 0, disc: 0 };
      mgPersons[who].perf += cd.perf;
      mgPersons[who].disc += cd.disc;
    });

    // 구분별 집계
    const catMap = {};
    rows.forEach(r => {
      const cat = r.category || '-';
      catMap[cat] = (catMap[cat] || 0) + Utils.parseNum(r.amount);
    });

    // 고정비 (구분 없는 항목 제외 별도 설정 없으므로 표기만)
    const fixedCost = settings.fixedCost || 0;

    return { total, cardMap, mgPersons, catMap, fixedCost };
  }

  function render(s, settings) {
    const budget = settings.totalBudget || 0;
    const over = s.total - budget;
    const totalPct = Utils.pct(s.total, budget);
    const totalColor = totalPct >= 1 ? 'pbar-red' : totalPct >= 0.8 ? 'pbar-amber' : 'pbar-green';

    // 카드별 실적 (mg+s 제외 나머지)
    const otherCards = (settings.cards || []).filter(c => c && !c.inactive && !Utils.isMgCard(c.name) && c.perf > 0);

    const content = Utils.el('content');
    content.innerHTML = `
      <div class="page active" id="p-dash">

        <div class="dash-grid">
          <div class="card">
            <div class="dc-label">이번달 총 지출</div>
            <div class="dc-val">${Utils.fmt(s.total)}</div>
            <div class="dc-sub">${budget ? '목표 ' + Utils.fmt(budget) + (over > 0 ? ' — 초과 ' + Utils.fmt(over) : ' — 남음 ' + Utils.fmt(-over)) : '목표 미설정'}</div>
            ${budget ? `<div class="pbar"><div class="pbar-fill ${totalColor}" style="width:${Math.min(totalPct*100,100)}%"></div></div>` : ''}
          </div>
          ${settings.fixedCost ? `
          <div class="card">
            <div class="dc-label">고정비 포함</div>
            <div class="dc-val">${Utils.fmt(s.total + settings.fixedCost)}</div>
            <div class="dc-sub">변동 ${Utils.fmt(s.total)} / 고정 ${Utils.fmt(settings.fixedCost)}</div>
          </div>` : '<div></div>'}
        </div>

        ${renderMgSection(s.mgPersons)}

        <div class="sec-title">카드별 실적</div>
        <div class="dash-grid" style="margin-bottom:14px">
          ${otherCards.map(c => {
            const cd = s.cardMap[c.name] || { perf: 0 };
            const pct = Utils.pct(cd.perf, c.perf);
            const color = pct >= 1 ? 'pbar-green' : pct >= 0.8 ? 'pbar-amber' : 'pbar-red';
            return `
            <div class="card">
              <div class="dc-label">${c.name}</div>
              <div class="dc-val" style="font-size:14px">${Utils.fmt(cd.perf)}</div>
              <div class="dc-sub">허들 ${Utils.fmt(c.perf)}${pct >= 1 ? ' 달성' : ''}</div>
              <div class="pbar"><div class="pbar-fill ${color}" style="width:${Math.min(pct*100,100)}%"></div></div>
            </div>`;
          }).join('')}
        </div>

        <div class="sec-title">구분별 지출</div>
        <div class="card">
          ${renderCatBars(s.catMap, (settings.categories || []).filter(c => c && !c.inactive))}
        </div>

      </div>`;
  }

  function renderMgSection(mgPersons) {
    const persons = Object.entries(mgPersons);
    if (!persons.length) return '';
    return `
      <div class="card mg-box">
        <div class="mg-title">mg+s 실적 / 할인</div>
        ${persons.map(([who, d]) => {
          const perfPct = Utils.pct(d.perf, d.perfHurdle);
          const discPct = Utils.pct(d.disc, d.discLimit);
          const pc = perfPct >= 1 ? 'pbar-green' : perfPct >= 0.8 ? 'pbar-amber' : 'pbar-red';
          const dc = discPct >= 1 ? 'pbar-green' : discPct >= 0.8 ? 'pbar-amber' : 'pbar-blue';
          return `
          <div class="mg-person">
            <div class="mg-who">${who}</div>
            <div class="mg-bars">
              ${d.perfHurdle ? `
              <div class="mg-bar-row">
                <div class="mg-bar-lbl">실적</div>
                <div class="mg-bar-track"><div class="mg-bar-fill ${pc}" style="width:${Math.min(perfPct*100,100)}%"></div></div>
                <div class="mg-bar-val">${Utils.fmt(d.perf)} / ${Utils.fmt(d.perfHurdle)}</div>
              </div>` : ''}
              ${d.discLimit ? `
              <div class="mg-bar-row">
                <div class="mg-bar-lbl">할인</div>
                <div class="mg-bar-track"><div class="mg-bar-fill ${dc}" style="width:${Math.min(discPct*100,100)}%"></div></div>
                <div class="mg-bar-val">${Utils.fmt(d.disc)} / ${Utils.fmt(d.discLimit)}</div>
              </div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  function renderCatBars(catMap, categories) {
    const maxAmt = Math.max(...Object.values(catMap).concat([1]));
    const sorted = [...categories]
      .map(c => ({ name: c.name, amt: catMap[c.name] || 0, budget: c.budget }))
      .sort((a, b) => b.amt - a.amt);

    if (!sorted.length) return '<div style="color:var(--text3);font-size:11px;padding:4px 0">내역 없음</div>';

    return sorted.map(c => {
      const pct = c.amt / maxAmt;
      const bpct = c.budget ? Utils.pct(c.amt, c.budget) : null;
      const color = bpct === null ? 'pbar-blue'
        : bpct >= 1 ? 'pbar-red' : bpct >= 0.8 ? 'pbar-amber' : 'pbar-green';
      return `
        <div class="cat-bar-row">
          <div class="cat-bar-name">${c.name}</div>
          <div class="cat-bar-track"><div class="cat-bar-fill ${color}" style="width:${Math.min(pct*100,100)}%"></div></div>
          <div class="cat-bar-val">${Utils.fmt(c.amt)}</div>
        </div>`;
    }).join('');
  }

  return { init };
})();
