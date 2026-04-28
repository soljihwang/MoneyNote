/**
 * ledger.js — 내역 탭
 */

const LedgerPage = (() => {
  let _sortField = 'date';
  let _sortDir = 'desc'; // asc | desc
  let _filters = { card: '', category: '', perf: '', status: '' };

  async function init() {
    await ensureTransactions();
    render();
  }

  function render() {
    const content = Utils.el('content');
    const settings = APP_STATE.settings || defaultSettings();
    const cards = settings.cards.map(c => c.name);
    const cats = settings.categories.map(c => c.name);

    content.innerHTML = `
      <div class="page active" id="p-ledger">
        <div class="filter-row">
          <span class="filter-label">카드</span>
          <select id="f-card">
            <option value="">전체</option>
            ${cards.map(c => `<option value="${c}"${_filters.card === c ? ' selected' : ''}>${c}</option>`).join('')}
          </select>
          <span class="filter-label">구분</span>
          <select id="f-cat">
            <option value="">전체</option>
            ${cats.map(c => `<option value="${c}"${_filters.category === c ? ' selected' : ''}>${c}</option>`).join('')}
          </select>
          <span class="filter-label">실적</span>
          <select id="f-perf">
            <option value="">전체</option>
            <option value="y"${_filters.perf === 'y' ? ' selected' : ''}>포함만</option>
            <option value="n"${_filters.perf === 'n' ? ' selected' : ''}>미포함만</option>
          </select>
          <span class="filter-label">상태</span>
          <select id="f-status">
            <option value="">전체</option>
            <option value="1"${_filters.status === '1' ? ' selected' : ''}>1 배송</option>
            <option value="2"${_filters.status === '2' ? ' selected' : ''}>2 확인</option>
            <option value="3"${_filters.status === '3' ? ' selected' : ''}>3 예정</option>
          </select>
        </div>

        <div class="table-wrap">
          <table class="ledger-table" id="ledger-tbl">
            <colgroup>
              <col style="width:44px"><col style="width:110px"><col style="width:68px">
              <col style="width:80px"><col style="width:96px"><col style="width:64px">
              <col style="width:30px"><col style="width:30px"><col style="width:42px">
            </colgroup>
            <thead>
              <tr>
                ${thHtml('date',     '날짜')}
                ${thHtml('item',     '항목')}
                ${thHtml('shop',     '쇼핑몰')}
                ${thHtml('amount',   '금액',   'amount')}
                ${thHtml('card',     '카드')}
                ${thHtml('category', '구분')}
                <th>실적</th>
                <th>할인</th>
                ${thHtml('status',   '상태')}
              </tr>
            </thead>
            <tbody id="ledger-body"></tbody>
          </table>
        </div>
        <div class="ledger-footer">
          <span class="ledger-count" id="ledger-count"></span>
          <span class="ledger-total" id="ledger-total"></span>
        </div>
      </div>`;

    // 필터 바인딩
    ['f-card', 'f-cat', 'f-perf', 'f-status'].forEach(id => {
      Utils.el(id).addEventListener('change', applyFilter);
    });

    // 헤더 정렬 클릭
    Utils.qsa('#ledger-tbl th[data-field]').forEach(th => {
      th.addEventListener('click', () => {
        const f = th.dataset.field;
        if (_sortField === f) _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
        else { _sortField = f; _sortDir = 'asc'; }
        renderBody(getFiltered());
        updateSortHeaders();
      });
    });

    applyFilter();
  }

  function thHtml(field, label, cls) {
    const active = _sortField === field;
    const sortClass = active ? ('sort-' + _sortDir) : '';
    const clsAttr = cls ? ` class="${cls} ${sortClass}"` : ` class="${sortClass}"`;
    return `<th data-field="${field}"${clsAttr}>${label}</th>`;
  }

  function applyFilter() {
    _filters.card     = Utils.el('f-card')?.value   || '';
    _filters.category = Utils.el('f-cat')?.value    || '';
    _filters.perf     = Utils.el('f-perf')?.value   || '';
    _filters.status   = Utils.el('f-status')?.value || '';

    const si = Utils.el('search-input');
    const q = si ? si.value.toLowerCase() : '';

    const filtered = getFiltered(q);
    renderBody(filtered);
    updateFooter(filtered);
  }

  function getFiltered(searchQ) {
    let rows = [...APP_STATE.transactions];
    const q = searchQ || Utils.el('search-input')?.value?.toLowerCase() || '';

    if (_filters.card)     rows = rows.filter(r => r.card === _filters.card);
    if (_filters.category) rows = rows.filter(r => r.category === _filters.category);
    if (_filters.perf === 'y') rows = rows.filter(r => r.perf);
    if (_filters.perf === 'n') rows = rows.filter(r => !r.perf);
    if (_filters.status)   rows = rows.filter(r => r.status === _filters.status);
    if (q) rows = rows.filter(r =>
      (r.item || '').toLowerCase().includes(q) || (r.shop || '').toLowerCase().includes(q)
    );

    // 정렬
    rows.sort((a, b) => {
      let av = a[_sortField] ?? '';
      let bv = b[_sortField] ?? '';
      if (_sortField === 'amount') { av = Utils.parseNum(av); bv = Utils.parseNum(bv); }
      if (_sortField === 'date') {
        av = parseDateStr(av); bv = parseDateStr(bv);
      }
      if (av < bv) return _sortDir === 'asc' ? -1 : 1;
      if (av > bv) return _sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return rows;
  }

  function parseDateStr(s) {
    if (!s) return 0;
    const [m, d] = String(s).split('/').map(Number);
    return (m || 0) * 100 + (d || 0);
  }

  function renderBody(rows) {
    const tbody = Utils.el('ledger-body');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="9">내역이 없습니다</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const perfBadge = row.perf
        ? '<span class="badge badge-green">O</span>'
        : '<span class="badge badge-gray">X</span>';
      const discBadge = Utils.isMgCard(row.card)
        ? (row.disc ? '<span class="badge badge-blue">O</span>' : '<span class="badge badge-gray">X</span>')
        : '<span style="color:var(--text3);font-size:10px">-</span>';
      const statusBadge = statusHtml(row.status);
      const memoTip = row.memo ? ` title="${row.memo}"` : '';
      const memoMark = row.memo ? ' <span style="color:var(--blue-text);font-size:9px">✎</span>' : '';

      return `<tr${memoTip}>
        <td>${row.date || ''}</td>
        <td>${esc(row.item || '')}${memoMark}</td>
        <td>${esc(row.shop || '')}</td>
        <td class="amount">${Utils.fmt(row.amount)}</td>
        <td>${esc(row.card || '')}</td>
        <td>${esc(row.category || '-')}</td>
        <td>${perfBadge}</td>
        <td>${discBadge}</td>
        <td>${statusBadge}</td>
      </tr>`;
    }).join('');
  }

  function statusHtml(s) {
    if (s === '1') return '<span class="badge badge-amber">배송</span>';
    if (s === '2') return '<span class="badge badge-red">확인</span>';
    if (s === '3') return '<span class="badge badge-purple">예정</span>';
    return '';
  }

  function updateFooter(rows) {
    const total = rows.reduce((s, r) => s + Utils.parseNum(r.amount), 0);
    const count = Utils.el('ledger-count');
    const totalEl = Utils.el('ledger-total');
    if (count) count.textContent = rows.length + '건 표시';
    if (totalEl) totalEl.textContent = '합계 ' + Utils.fmt(total);
  }

  function updateSortHeaders() {
    Utils.qsa('#ledger-tbl th[data-field]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.field === _sortField) th.classList.add('sort-' + _sortDir);
    });
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return { init, applyFilter };
})();