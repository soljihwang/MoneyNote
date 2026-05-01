/**
 * compare.js — 카드 대조 탭
 */

const ComparePage = (() => {
  let _cardRows = [];     // 카드사 CSV 파싱 결과
  let _selectedCard = ''; // 선택된 카드명

  async function init() {
    await ensureTransactions();
    const settings = APP_STATE.settings || defaultSettings();
    _selectedCard = settings.cards[0]?.name || '';
    render(settings);
  }

  function render(settings) {
    const cards = (settings || APP_STATE.settings || defaultSettings()).cards;
    const month = Utils.monthLabel(APP_STATE.currentMonth);
    const content = Utils.el('content');

    content.innerHTML = `
      <div class="page active page-shell" id="p-compare">

        <div class="filter-row" style="margin-bottom:12px">
          <span class="filter-label">카드</span>
          <select id="cmp-card-sel">
            ${cards.map(c => `<option value="${c.name}"${c.name === _selectedCard ? ' selected' : ''}>${c.name} — ${month}</option>`).join('')}
          </select>
        </div>

        <div class="upload-zone" id="cmp-upload-zone">
          CSV 파일을 여기에 끌어다 놓거나 클릭해서 업로드
          <p>카드사 앱 / 홈페이지에서 월별 내역 다운로드 후 업로드</p>
          <input type="file" id="cmp-file-input" accept=".csv,text/csv" style="display:none" />
        </div>

        <div class="dash-grid" style="margin-bottom:12px">
          <div class="card">
            <div class="dc-label">내 입력 합계</div>
            <div class="dc-val" id="my-total" style="font-size:15px">-</div>
          </div>
          <div class="card">
            <div class="dc-label">카드사 합계</div>
            <div class="dc-val" id="card-total" style="font-size:15px;color:var(--text3)">CSV 대기중</div>
          </div>
          <div class="card">
            <div class="dc-label">차이</div>
            <div class="dc-val" id="diff-total" style="font-size:15px;color:var(--text3)">-</div>
          </div>
        </div>

        <div class="table-wrap">
          <table class="compare-table" id="cmp-table">
            <colgroup>
              <col style="width:44px"><col style="width:110px"><col style="width:110px">
              <col style="width:72px"><col style="width:72px"><col style="width:60px">
            </colgroup>
            <thead>
              <tr>
                <th>날짜</th>
                <th>내 입력</th>
                <th>카드사 내역</th>
                <th class="amount">내 금액</th>
                <th class="amount">카드 금액</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody id="cmp-body">
              <tr><td colspan="6" style="text-align:center;color:var(--text3);padding:28px 0;font-size:11px">CSV를 업로드하면 자동으로 대조합니다</td></tr>
            </tbody>
          </table>
        </div>
      </div>`;

    bindEvents();
    updateMyTotal();
  }

  function bindEvents() {
    // 카드 선택
    Utils.el('cmp-card-sel').addEventListener('change', e => {
      _selectedCard = e.target.value;
      _cardRows = [];
      updateMyTotal();
      renderCompareBody([]);
      resetSummary();
    });

    // 업로드 존 클릭
    const zone = Utils.el('cmp-upload-zone');
    const fi   = Utils.el('cmp-file-input');
    zone.addEventListener('click', () => fi.click());
    fi.addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });

    // 드래그앤드롭
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      handleFile(e.dataTransfer.files[0]);
    });
  }

  // ── CSV 처리 ─────────────────────────────────────────
  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        _cardRows = parseCSV(e.target.result);
        const matched = matchRows();
        renderCompareBody(matched);
        updateSummary(matched);
        showToast('CSV 로드 완료 — ' + _cardRows.length + '건');
      } catch (err) {
        showToast('CSV 파싱 오류: ' + err.message);
      }
    };
    reader.readAsText(file, 'UTF-8');
  }

  /**
   * 범용 CSV 파서
   * 날짜/금액 컬럼을 휴리스틱으로 감지
   */
  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('데이터가 부족합니다');

    const sep = lines[0].includes('\t') ? '\t' : ',';
    const headers = lines[0].split(sep).map(h => h.replace(/"/g, '').trim());

    // 컬럼 인덱스 휴리스틱 감지
    const dateIdx = findColIdx(headers, ['날짜', '거래일', '이용일', 'date']);
    const amtIdx  = findColIdx(headers, ['금액', '이용금액', '결제금액', '승인금액', 'amount']);
    const nameIdx = findColIdx(headers, ['가맹점', '상호', '내용', '적요', 'name', 'merchant']);

    return lines.slice(1).map(line => {
      const cols = parseCsvLine(line, sep);
      const rawAmt = cols[amtIdx] || '0';
      const amt = Utils.parseNum(rawAmt.replace(/[^0-9\-]/g, ''));
      if (!amt) return null;
      return {
        date: normalizeDate(cols[dateIdx] || ''),
        name: (cols[nameIdx] || '').trim(),
        amount: Math.abs(amt),
      };
    }).filter(Boolean);
  }

  function findColIdx(headers, candidates) {
    for (const c of candidates) {
      const idx = headers.findIndex(h => h.toLowerCase().includes(c.toLowerCase()));
      if (idx >= 0) return idx;
    }
    return 0;
  }

  function parseCsvLine(line, sep) {
    const result = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === sep && !inQ) { result.push(cur); cur = ''; continue; }
      cur += ch;
    }
    result.push(cur);
    return result.map(s => s.trim());
  }

  function normalizeDate(s) {
    // 2025-04-03, 20250403, 2025.04.03, 04/03 등 → M/D
    s = s.replace(/[.\-]/g, '/').replace(/^20\d{2}\//, '');
    const parts = s.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return Number(parts[0]) + '/' + Number(parts[1]);
    }
    return s;
  }

  // ── 매칭 ────────────────────────────────────────────
  function matchRows() {
    // 내 입력 중 선택된 카드만
    const myRows = APP_STATE.transactions.filter(r => r.card === _selectedCard);
    const cardRows = [..._cardRows];
    const used = new Set();
    const result = [];

    // 내 입력 기준으로 매칭
    myRows.forEach(my => {
      const myAmt = Utils.parseNum(my.amount);
      const matchIdx = cardRows.findIndex((cr, i) =>
        !used.has(i) && cr.amount === myAmt && cr.date === my.date
      );

      if (matchIdx >= 0) {
        used.add(matchIdx);
        result.push({ my, card: cardRows[matchIdx], status: 'ok' });
      } else {
        // 날짜는 같고 금액 다른 경우 탐색
        const diffIdx = cardRows.findIndex((cr, i) =>
          !used.has(i) && cr.date === my.date
        );
        if (diffIdx >= 0) {
          used.add(diffIdx);
          result.push({ my, card: cardRows[diffIdx], status: 'diff' });
        } else {
          result.push({ my, card: null, status: 'my-only' });
        }
      }
    });

    // 카드사에만 있는 항목
    cardRows.forEach((cr, i) => {
      if (!used.has(i)) {
        result.push({ my: null, card: cr, status: 'miss' });
      }
    });

    // 날짜 내림차순 정렬
    result.sort((a, b) => {
      const da = a.my?.date || a.card?.date || '';
      const db = b.my?.date || b.card?.date || '';
      return parseDate(db) - parseDate(da);
    });

    return result;
  }

  function parseDate(s) {
    if (!s) return 0;
    const [m, d] = String(s).split('/').map(Number);
    return (m || 0) * 100 + (d || 0);
  }

  // ── 렌더 ────────────────────────────────────────────
  function renderCompareBody(rows) {
    const tbody = Utils.el('cmp-body');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:28px 0;font-size:11px">CSV를 업로드하면 자동으로 대조합니다</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(r => {
      let cls = '', statusHtml = '';
      if (r.status === 'ok')      { statusHtml = '<span class="status-ok">일치</span>'; }
      if (r.status === 'diff')    { cls = 'row-diff'; statusHtml = '<span class="status-diff">금액 다름</span>'; }
      if (r.status === 'miss')    { cls = 'row-miss'; statusHtml = '<span class="status-miss">누락</span>'; }
      if (r.status === 'my-only') { statusHtml = '<span class="status-diff">카드사 없음</span>'; }

      const date    = r.my?.date    || r.card?.date    || '';
      const myName  = r.my?.item    || '';
      const cardName= r.card?.name  || '';
      const myAmt   = r.my   ? Utils.fmt(r.my.amount) : '';
      const cardAmt = r.card ? Utils.fmt(r.card.amount) : '';

      const amtStyle = r.status === 'diff' ? ' style="color:var(--amber-text)"' : '';

      return `<tr class="${cls}">
        <td>${date}</td>
        <td>${myName || '<span style="color:var(--text3)">-</span>'}</td>
        <td>${cardName || '<span style="color:var(--text3)">-</span>'}</td>
        <td class="amount">${myAmt}</td>
        <td class="amount"${amtStyle}>${cardAmt}</td>
        <td>${statusHtml}</td>
      </tr>`;
    }).join('');
  }

  function updateMyTotal() {
    const myRows = APP_STATE.transactions.filter(r => r.card === _selectedCard);
    const total = myRows.reduce((s, r) => s + Utils.parseNum(r.amount), 0);
    const el = Utils.el('my-total');
    if (el) el.textContent = Utils.fmt(total);
  }

  function updateSummary(matched) {
    const myTotal   = matched.filter(r => r.my).reduce((s, r) => s + Utils.parseNum(r.my.amount), 0);
    const cardTotal = matched.filter(r => r.card).reduce((s, r) => s + r.card.amount, 0);
    const diff = myTotal - cardTotal;

    const ct = Utils.el('card-total');
    const dt = Utils.el('diff-total');
    if (ct) ct.textContent = Utils.fmt(cardTotal);
    if (dt) {
      dt.textContent = (diff === 0 ? '' : diff > 0 ? '+' : '') + Utils.fmt(diff);
      dt.style.color = diff === 0 ? 'var(--green-text)' : diff > 0 ? 'var(--amber-text)' : 'var(--red-text)';
    }
  }

  function resetSummary() {
    const ct = Utils.el('card-total');
    const dt = Utils.el('diff-total');
    if (ct) { ct.textContent = 'CSV 대기중'; ct.style.color = ''; }
    if (dt) { dt.textContent = '-'; dt.style.color = ''; }
  }

  return { init };
})();
