/**
 * input.js — 입력 탭
 */

const InputPage = (() => {
  let _rows = [];       // 현재 입력 행 데이터
  let _memoMap = {};    // rowIndex -> 메모 텍스트
  let _editingMemoIdx = null;
  let _searchQuery = '';

  // ── 초기화 ──────────────────────────────────────────────
  async function init() {
    await ensureTransactions();
    _rows = APP_STATE.transactions.length
      ? APP_STATE.transactions.map(r => ({ ...r }))
      : [emptyRow()];
    _memoMap = {};
    _rows.forEach((r, i) => { if (r.memo) _memoMap[i] = r.memo; });
    render();
    bindItemMemoModal();
  }

  // ── 빈 행 ───────────────────────────────────────────────
  function emptyRow() {
    const settings = APP_STATE.settings;
    const today = new Date();
    const dateStr = (today.getMonth() + 1) + '/' + today.getDate();
    return {
      date: dateStr,
      item: '',
      amount: '',
      shop: '',
      card: settings ? settings.cards[0].name : '',
      category: '',
      perf: true,
      disc: false,
      status: '',
      memo: '',
    };
  }

  // ── 카드 설정 찾기 ───────────────────────────────────────
  function getCardSetting(cardName) {
    const settings = APP_STATE.settings;
    if (!settings) return null;
    return settings.cards.find(c => c.name === cardName) || null;
  }

  // ── 렌더링 ──────────────────────────────────────────────
  function render() {
    const settings = APP_STATE.settings || defaultSettings();
    const cards = settings.cards.map(c => c.name);
    const cats = settings.categories.map(c => c.name);

    const filtered = _searchQuery
      ? _rows.filter((r, i) => {
          const q = _searchQuery.toLowerCase();
          return r.item.toLowerCase().includes(q) || r.shop.toLowerCase().includes(q);
        })
      : _rows;

    const headerHtml = `
      <div class="input-header">
        <span class="col-label">날짜</span>
        <span class="col-label">항목</span>
        <span class="col-label">쇼핑몰</span>
        <span class="col-label" style="text-align:right">금액</span>
        <span class="col-label">카드</span>
        <span class="col-label">구분</span>
        <span class="col-label center">실적</span>
        <span class="col-label center">할인</span>
        <span class="col-label">상태</span>
        <span class="col-label center" title="항목 메모">✎</span>
        <span></span>
      </div>`;

    const rowsHtml = _rows.map((row, realIdx) => {
      if (_searchQuery) {
        const q = _searchQuery.toLowerCase();
        if (!row.item.toLowerCase().includes(q) && !row.shop.toLowerCase().includes(q)) return '';
      }
      return renderRow(row, realIdx, cards, cats);
    }).join('');

    const cardOptHtml = cards.map(c => `<option value="${c}">${c}</option>`).join('');
    const mgHasSome = _rows.some(r => Utils.isMgCard(r.card));

    const content = Utils.el('content');
    content.innerHTML = `
      <div class="page active" id="p-input">
        <div class="mg-hint${mgHasSome ? ' show' : ''}" id="mg-hint">
          mg+s 카드 선택 시 — 실적/할인 체크를 건별로 조정하세요
        </div>
        ${headerHtml}
        <div id="input-rows">${rowsHtml}</div>
        <button class="add-row-btn" id="add-row-btn">+ 행 추가</button>
        <div class="input-footer">
          <span class="input-count" id="input-count">${_rows.length}건 입력됨</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-primary" onclick="InputPage.save()">저장</button>
          </div>
        </div>
      </div>`;

    Utils.el('add-row-btn').addEventListener('click', addRow);
    bindRowEvents();
    updateCount();
  }

  // ── 단일 행 HTML ────────────────────────────────────────
  function renderRow(row, idx, cards, cats) {
    const isMg = Utils.isMgCard(row.card);
    const cardOpts = cards.map(c =>
      `<option value="${c}"${c === row.card ? ' selected' : ''}>${c}</option>`
    ).join('');
    const catOpts = '<option value="">-</option>' + cats.map(c =>
      `<option value="${c}"${c === row.category ? ' selected' : ''}>${c}</option>`
    ).join('');
    const statusOpts = [['', '-'], ['1', '1 배송'], ['2', '2 확인'], ['3', '3 예정']].map(
      ([v, l]) => `<option value="${v}"${row.status === v ? ' selected' : ''}>${l}</option>`
    ).join('');

    const hasMemo = !!_memoMap[idx];
    const amountVal = row.amount ? Utils.fmt(row.amount) : '';

    return `
      <div class="input-row" data-idx="${idx}">
        <input type="text" data-field="date" value="${row.date || ''}" placeholder="4/1" />
        <input type="text" data-field="item" value="${row.item || ''}" placeholder="항목명" />
        <input type="text" data-field="shop" value="${row.shop || ''}" placeholder="쇼핑몰" />
        <input type="text" data-field="amount" value="${amountVal}" placeholder="0" class="amount-input" />
        <select data-field="card">${cardOpts}</select>
        <select data-field="category">${catOpts}</select>
        <div class="chk-wrap"><input type="checkbox" data-field="perf" ${row.perf ? 'checked' : ''} /></div>
        <div class="chk-wrap"><input type="checkbox" data-field="disc" ${row.disc ? 'checked' : ''} ${!isMg ? 'disabled' : ''} /></div>
        <select data-field="status" style="font-size:10px;padding:0 3px">${statusOpts}</select>
        <button class="memo-icon-btn${hasMemo ? ' has-memo' : ''}" data-memo-idx="${idx}" title="${hasMemo ? _memoMap[idx] : '메모 추가'}">✎</button>
        <button class="btn-icon rm-btn" data-rm-idx="${idx}">-</button>
      </div>`;
  }

  // ── 이벤트 바인딩 ───────────────────────────────────────
  function bindRowEvents() {
    const container = Utils.el('input-rows');
    if (!container) return;

    // 이벤트 위임
    container.addEventListener('change', onFieldChange);
    container.addEventListener('input',  onFieldInput);
    container.addEventListener('click',  onRowClick);
  }

  function onFieldChange(e) {
    const row = e.target.closest('.input-row');
    if (!row) return;
    const idx = +row.dataset.idx;
    const field = e.target.dataset.field;
    if (!field) return;

    if (e.target.type === 'checkbox') {
      _rows[idx][field] = e.target.checked;
    } else {
      _rows[idx][field] = e.target.value;
    }

    if (field === 'card') onCardChange(idx, e.target.value, row);
    APP_STATE.dirtyInput = true;
  }

  function onFieldInput(e) {
    const row = e.target.closest('.input-row');
    if (!row) return;
    const idx = +row.dataset.idx;
    const field = e.target.dataset.field;
    if (!field) return;

    if (field === 'amount') {
      // 숫자만 허용, 포맷
      const raw = e.target.value.replace(/[^0-9]/g, '');
      _rows[idx].amount = raw ? +raw : '';
      if (APP_STATE.settings?.toggles?.commaFormat && raw) {
        const pos = e.target.selectionStart;
        e.target.value = Utils.fmt(raw);
      }
    } else {
      _rows[idx][field] = e.target.value;
    }
    APP_STATE.dirtyInput = true;
  }

  function onRowClick(e) {
    // 행 삭제
    const rmBtn = e.target.closest('.rm-btn');
    if (rmBtn) {
      const idx = +rmBtn.dataset.rmIdx;
      removeRow(idx);
      return;
    }
    // 항목 메모
    const memoBtn = e.target.closest('.memo-icon-btn');
    if (memoBtn) {
      const idx = +memoBtn.dataset.memoIdx;
      openItemMemo(idx);
    }
  }

  // ── 카드 변경 시 실적/할인 기본값 세팅 ─────────────────
  function onCardChange(idx, cardName, rowEl) {
    const cs = getCardSetting(cardName);
    if (!cs) return;

    const isMg = Utils.isMgCard(cardName);
    const perfChk = rowEl.querySelector('[data-field=perf]');
    const discChk = rowEl.querySelector('[data-field=disc]');

    _rows[idx].perf = cs.perfDefault;
    _rows[idx].disc = isMg ? cs.discDefault : false;
    perfChk.checked = _rows[idx].perf;
    discChk.checked = _rows[idx].disc;
    discChk.disabled = !isMg;

    // mg+s 힌트
    const anyMg = _rows.some(r => Utils.isMgCard(r.card));
    const hint = Utils.el('mg-hint');
    if (hint) hint.classList.toggle('show', anyMg);
  }

  // ── 행 추가 ─────────────────────────────────────────────
  function addRow() {
    const lastRow = _rows[_rows.length - 1];
    const newRow = emptyRow();
    // 직전 행의 날짜/카드 이어받기
    if (lastRow) {
      newRow.date = lastRow.date;
      newRow.card = lastRow.card;
      const cs = getCardSetting(newRow.card);
      if (cs) {
        newRow.perf = cs.perfDefault;
        newRow.disc = cs.discDefault;
      }
    }
    _rows.push(newRow);
    APP_STATE.dirtyInput = true;

    const settings = APP_STATE.settings || defaultSettings();
    const cards = settings.cards.map(c => c.name);
    const cats = settings.categories.map(c => c.name);
    const newIdx = _rows.length - 1;
    const html = renderRow(newRow, newIdx, cards, cats);
    const container = Utils.el('input-rows');
    container.insertAdjacentHTML('beforeend', html);
    updateCount();

    // 새 행 첫 필드에 포커스
    const newRowEl = container.lastElementChild;
    const firstInput = newRowEl.querySelector('input[data-field=item]');
    if (firstInput) firstInput.focus();
  }

  // ── 행 삭제 ─────────────────────────────────────────────
  function removeRow(idx) {
    if (_rows.length === 1) {
      _rows[0] = emptyRow();
      render();
      return;
    }
    _rows.splice(idx, 1);
    // memoMap 인덱스 재조정
    const newMap = {};
    Object.keys(_memoMap).forEach(k => {
      const ki = +k;
      if (ki < idx) newMap[ki] = _memoMap[ki];
      else if (ki > idx) newMap[ki - 1] = _memoMap[ki];
    });
    _memoMap = newMap;
    APP_STATE.dirtyInput = true;
    render();
  }

  // ── 항목 메모 모달 ──────────────────────────────────────
  function openItemMemo(idx) {
    _editingMemoIdx = idx;
    Utils.el('item-memo-ta').value = _memoMap[idx] || '';
    Utils.el('item-memo-overlay').classList.add('show');
    setTimeout(() => Utils.el('item-memo-ta').focus(), 100);
  }

  function bindItemMemoModal() {
    Utils.el('item-memo-cancel').onclick = () => {
      Utils.el('item-memo-overlay').classList.remove('show');
    };
    Utils.el('item-memo-save').onclick = () => {
      const text = Utils.el('item-memo-ta').value.trim();
      if (_editingMemoIdx !== null) {
        _memoMap[_editingMemoIdx] = text;
        _rows[_editingMemoIdx].memo = text;
        APP_STATE.dirtyInput = true;
      }
      Utils.el('item-memo-overlay').classList.remove('show');
      // 메모 아이콘 업데이트
      const btn = Utils.qs(`[data-memo-idx="${_editingMemoIdx}"]`);
      if (btn) {
        btn.classList.toggle('has-memo', !!text);
        btn.title = text || '메모 추가';
      }
    };
    Utils.el('item-memo-overlay').addEventListener('click', e => {
      if (e.target === Utils.el('item-memo-overlay')) {
        Utils.el('item-memo-overlay').classList.remove('show');
      }
    });
  }

  // ── 행 카운트 업데이트 ──────────────────────────────────
  function updateCount() {
    const el = Utils.el('input-count');
    if (el) el.textContent = _rows.length + '건 입력됨';
  }

  // ── 검색 ────────────────────────────────────────────────
  function search(q) {
    _searchQuery = q;
    render();
  }

  // ── 저장 ────────────────────────────────────────────────
  async function save() {
    const validRows = _rows.filter(r => r.item || r.amount);
    if (!validRows.length) { showToast('입력된 내역이 없습니다'); return; }

    if (APP_STATE.settings?.toggles?.confirmSave) {
      if (!confirm(validRows.length + '건을 저장할까요?')) return;
    }

    const saveBtn = Utils.el('top-save-btn');
    const innerSaveBtn = Utils.qs('#p-input .btn-primary');
    [saveBtn, innerSaveBtn].forEach(b => { if (b) { b.disabled = true; b.textContent = '저장 중...'; } });

    try {
      await API.saveTransactions(APP_STATE.currentMonth, validRows);
      APP_STATE.transactions = validRows;
      APP_STATE.dirtyInput = false;
      _rows = validRows.map(r => ({ ...r }));
      showToast('저장됨');
      updateCount();
    } catch (e) {
      showToast('저장 실패: ' + e.message);
    } finally {
      [saveBtn, innerSaveBtn].forEach(b => {
        if (b) { b.disabled = false; b.textContent = '저장'; }
      });
    }
  }

  return { init, save, search, addRow };
})();