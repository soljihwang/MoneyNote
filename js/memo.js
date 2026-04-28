/**
 * memo.js — 메모 탭
 */

const MemoPage = (() => {
  let _memo = null;

  async function init() {
    await ensureMemo();
    _memo = JSON.parse(JSON.stringify(APP_STATE.memo)); // deep copy
    render();
  }

  function render() {
    const content = Utils.el('content');
    content.innerHTML = `
      <div class="page active" id="p-memo">
        <div class="memo-grid">

          <!-- 결제 정보 -->
          <div class="card-raised">
            <div class="memo-card-title">
              결제 정보
              <button class="memo-edit-btn" id="btn-edit-payments">편집</button>
            </div>
            <div id="payments-view">${renderPaymentsView()}</div>
            <div id="payments-edit" style="display:none">${renderPaymentsEdit()}</div>
          </div>

          <!-- 체크리스트 -->
          <div class="card-raised">
            <div class="memo-card-title">
              체크리스트
              <button class="memo-edit-btn" id="btn-add-check">+ 항목</button>
            </div>
            <div class="checklist" id="checklist">${renderChecklist()}</div>
          </div>

          <!-- 카드 혜택 -->
          <div class="card-raised">
            <div class="memo-card-title">
              카드 혜택
              <button class="memo-edit-btn" id="btn-edit-benefits">편집</button>
            </div>
            <div id="benefits-view">${renderBenefitsView()}</div>
            <div id="benefits-edit" style="display:none">${renderBenefitsEdit()}</div>
          </div>

          <!-- 자유 메모 -->
          <div class="card-raised">
            <div class="memo-card-title">자유 메모</div>
            <textarea class="memo-textarea" id="free-text" placeholder="자유롭게 입력하세요...">${_memo.freeText || ''}</textarea>
          </div>

        </div>

        <!-- 이미지 메모 -->
        <div class="card-raised" style="margin-bottom:12px">
          <div class="memo-card-title">
            이미지 메모
            <button class="memo-edit-btn" id="btn-add-img">+ 추가</button>
          </div>
          <div class="img-thumb-row" id="img-thumb-row">${renderImgThumbs()}</div>
          <div class="img-drop-zone" id="img-drop-zone">
            이미지를 여기에 끌어다 놓거나 클릭해서 추가
            <input type="file" id="img-file-input" accept="image/*" multiple style="display:none" />
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end">
          <button class="btn btn-primary" onclick="MemoPage.save()">저장</button>
        </div>
      </div>`;

    bindEvents();
  }

  // ── 결제 정보 ─────────────────────────────────────────
  function renderPaymentsView() {
    const items = _memo.payments || [];
    if (!items.length) return '<div style="color:var(--text3);font-size:11px">-</div>';
    return `<table class="memo-kv-table">${items.map(p =>
      `<tr><td>${esc(p.label)}</td><td>${esc(p.value)}</td></tr>`
    ).join('')}</table>`;
  }

  function renderPaymentsEdit() {
    const items = _memo.payments || [];
    return `<table class="memo-kv-edit" id="payments-edit-tbl">
      ${items.map((p, i) => editRow(i, p.label, p.value, 'payments')).join('')}
    </table>
    <button class="btn btn-sm" style="margin-top:5px" onclick="MemoPage.addKvRow('payments')">+ 행 추가</button>`;
  }

  // ── 카드 혜택 ────────────────────────────────────────
  function renderBenefitsView() {
    const items = _memo.benefits || [];
    if (!items.length) return '<div style="color:var(--text3);font-size:11px">-</div>';
    return `<table class="memo-kv-table">${items.map(p =>
      `<tr><td>${esc(p.label)}</td><td>${esc(p.value)}</td></tr>`
    ).join('')}</table>`;
  }

  function renderBenefitsEdit() {
    const items = _memo.benefits || [];
    return `<table class="memo-kv-edit" id="benefits-edit-tbl">
      ${items.map((p, i) => editRow(i, p.label, p.value, 'benefits')).join('')}
    </table>
    <button class="btn btn-sm" style="margin-top:5px" onclick="MemoPage.addKvRow('benefits')">+ 행 추가</button>`;
  }

  function editRow(i, label, value, field) {
    return `<tr>
      <td style="width:72px"><input data-field="${field}" data-idx="${i}" data-key="label" value="${esc(label)}" placeholder="항목" /></td>
      <td><input data-field="${field}" data-idx="${i}" data-key="value" value="${esc(value)}" placeholder="내용" /></td>
      <td style="width:24px"><button class="btn-icon" onclick="MemoPage.removeKvRow('${field}',${i})">-</button></td>
    </tr>`;
  }

  // ── 체크리스트 ────────────────────────────────────────
  function renderChecklist() {
    const items = _memo.checklist || [];
    return items.map((item, i) => `
      <div class="check-item${item.done ? ' done' : ''}" data-ci="${i}">
        <input type="checkbox" ${item.done ? 'checked' : ''} onchange="MemoPage.toggleCheck(${i}, this.checked)" />
        <input class="check-item-input" value="${esc(item.text)}" placeholder="할 일..."
          oninput="MemoPage.updateCheck(${i}, this.value)"
          onkeydown="if(event.key==='Enter')MemoPage.addCheck()" />
        <button class="btn-icon" onclick="MemoPage.removeCheck(${i})">-</button>
      </div>`
    ).join('');
  }

  // ── 이미지 ───────────────────────────────────────────
  function renderImgThumbs() {
    const imgs = _memo.images || [];
    return imgs.map((img, i) => `
      <div class="img-thumb" title="${esc(img.name || '')}">
        <img src="${img.dataUrl}" alt="${esc(img.name || '')}" />
        <div class="img-thumb-del" onclick="MemoPage.removeImg(${i})">×</div>
      </div>`
    ).join('');
  }

  // ── 이벤트 바인딩 ────────────────────────────────────
  function bindEvents() {
    // 결제 정보 편집 토글
    Utils.el('btn-edit-payments').addEventListener('click', () => {
      toggleKvEdit('payments');
    });

    // 카드 혜택 편집 토글
    Utils.el('btn-edit-benefits').addEventListener('click', () => {
      toggleKvEdit('benefits');
    });

    // 체크 추가
    Utils.el('btn-add-check').addEventListener('click', addCheck);

    // 자유 메모 실시간 반영
    Utils.el('free-text').addEventListener('input', e => {
      _memo.freeText = e.target.value;
    });

    // 이미지 추가 버튼
    Utils.el('btn-add-img').addEventListener('click', () => {
      Utils.el('img-file-input').click();
    });

    // 파일 선택
    Utils.el('img-file-input').addEventListener('change', handleFileInput);

    // 드래그앤드롭
    const dz = Utils.el('img-drop-zone');
    dz.addEventListener('click', () => Utils.el('img-file-input').click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      handleFiles(e.dataTransfer.files);
    });
  }

  function toggleKvEdit(field) {
    const viewEl  = Utils.el(field + '-view');
    const editEl  = Utils.el(field + '-edit');
    const btn     = Utils.el('btn-edit-' + field);
    const isEditing = editEl.style.display !== 'none';

    if (isEditing) {
      // 편집 완료 → 데이터 수집
      collectKvData(field);
      viewEl.innerHTML = field === 'payments' ? renderPaymentsView() : renderBenefitsView();
      viewEl.style.display = '';
      editEl.style.display = 'none';
      btn.textContent = '편집';
    } else {
      // 편집 시작
      editEl.innerHTML = field === 'payments' ? renderPaymentsEdit().replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '') : renderBenefitsEdit().replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
      editEl.innerHTML = field === 'payments' ? renderPaymentsEdit() : renderBenefitsEdit();
      viewEl.style.display = 'none';
      editEl.style.display = '';
      btn.textContent = '완료';
      bindKvInputs(field);
    }
  }

  function bindKvInputs(field) {
    const tbl = Utils.el(field + '-edit-tbl');
    if (!tbl) return;
    tbl.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => collectKvData(field));
    });
  }

  function collectKvData(field) {
    const tbl = Utils.el(field + '-edit-tbl');
    if (!tbl) return;
    const items = [];
    const rows = tbl.querySelectorAll('tr');
    rows.forEach(tr => {
      const labelEl = tr.querySelector('[data-key=label]');
      const valueEl = tr.querySelector('[data-key=value]');
      if (labelEl && valueEl) {
        items.push({ label: labelEl.value, value: valueEl.value });
      }
    });
    _memo[field] = items;
  }

  // ── 공개 메서드 ──────────────────────────────────────
  function addKvRow(field) {
    _memo[field] = _memo[field] || [];
    _memo[field].push({ label: '', value: '' });
    const tbl = Utils.el(field + '-edit-tbl');
    if (tbl) {
      const i = _memo[field].length - 1;
      const tr = document.createElement('tr');
      tr.innerHTML = editRow(i, '', '', field);
      tbl.appendChild(tr);
      bindKvInputs(field);
    }
  }

  function removeKvRow(field, idx) {
    _memo[field].splice(idx, 1);
    const tbl = Utils.el(field + '-edit-tbl');
    if (tbl) tbl.innerHTML = _memo[field].map((p, i) => editRow(i, p.label, p.value, field)).join('');
    bindKvInputs(field);
  }

  function addCheck() {
    _memo.checklist = _memo.checklist || [];
    _memo.checklist.push({ text: '', done: false });
    const cl = Utils.el('checklist');
    if (cl) {
      cl.innerHTML = renderChecklist();
      const last = cl.lastElementChild?.querySelector('.check-item-input');
      if (last) last.focus();
    }
  }

  function removeCheck(idx) {
    _memo.checklist.splice(idx, 1);
    const cl = Utils.el('checklist');
    if (cl) cl.innerHTML = renderChecklist();
  }

  function toggleCheck(idx, checked) {
    if (_memo.checklist[idx]) {
      _memo.checklist[idx].done = checked;
      const item = Utils.qs(`[data-ci="${idx}"]`);
      if (item) item.classList.toggle('done', checked);
    }
  }

  function updateCheck(idx, text) {
    if (_memo.checklist[idx]) _memo.checklist[idx].text = text;
  }

  // ── 이미지 처리 ──────────────────────────────────────
  function handleFileInput(e) {
    handleFiles(e.target.files);
    e.target.value = '';
  }

  function handleFiles(fileList) {
    Array.from(fileList).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = ev => {
        _memo.images = _memo.images || [];
        _memo.images.push({ name: file.name, dataUrl: ev.target.result });
        const row = Utils.el('img-thumb-row');
        if (row) row.innerHTML = renderImgThumbs();
      };
      reader.readAsDataURL(file);
    });
  }

  function removeImg(idx) {
    _memo.images.splice(idx, 1);
    const row = Utils.el('img-thumb-row');
    if (row) row.innerHTML = renderImgThumbs();
  }

  // ── 저장 ────────────────────────────────────────────
  async function save() {
    // 편집 중인 KV 데이터 수집
    ['payments', 'benefits'].forEach(field => {
      const editEl = Utils.el(field + '-edit');
      if (editEl && editEl.style.display !== 'none') collectKvData(field);
    });
    _memo.freeText = Utils.el('free-text')?.value || _memo.freeText || '';

    const btn = Utils.el('top-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }
    try {
      await API.saveMemo(APP_STATE.currentMonth, _memo);
      APP_STATE.memo = JSON.parse(JSON.stringify(_memo));
      showToast('메모 저장됨');
    } catch (e) {
      showToast('저장 실패: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '저장'; }
    }
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { init, save, addKvRow, removeKvRow, addCheck, removeCheck, toggleCheck, updateCheck, removeImg };
})();