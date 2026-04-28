/**
 * settings.js — 설정 탭 (v2 — 카드 추가/삭제, localStorage fallback)
 */

const SettingsPage = (() => {
  let _settings = null;

  async function init() {
    _settings = JSON.parse(JSON.stringify(APP_STATE.settings));
    render();
  }

  function render() {
    const s = _settings;
    const content = Utils.el('content');
    content.innerHTML = `
      <div class="page active" id="p-settings">

        <div class="settings-section">
          <div class="settings-section-title">카드별 실적 / 할인 설정</div>
          <table class="settings-table" id="card-settings-tbl">
            <thead><tr>
              <th style="width:110px">카드명</th>
              <th>실적 허들</th><th>할인 한도</th>
              <th>기본 실적</th><th>기본 할인</th>
              <th style="width:28px"></th>
            </tr></thead>
            <tbody id="card-tbody">
              ${s.cards.map((c, i) => cardRowHtml(i, c)).join('')}
            </tbody>
          </table>
          <button class="btn btn-sm" style="margin-top:6px" onclick="SettingsPage.addCard()">+ 카드 추가</button>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">구분 / 월 목표금액</div>
          <div style="display:grid;grid-template-columns:120px 1fr 24px;gap:6px;font-size:9px;color:var(--text3);margin-bottom:4px">
            <span>구분명</span><span>월 목표금액</span><span></span>
          </div>
          <div id="cat-settings-rows">
            ${s.categories.map((c, i) => catRowHtml(i, c.name, c.budget)).join('')}
          </div>
          <button class="btn btn-sm" style="margin-top:6px" onclick="SettingsPage.addCat()">+ 구분 추가</button>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">월 총 지출 목표</div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="number" id="total-budget" value="${s.totalBudget || 0}"
              style="height:28px;padding:0 8px;font-size:12px;border:0.5px solid var(--border);border-radius:5px;background:var(--bg1);color:var(--text1);width:140px;text-align:right" />
            <span style="font-size:11px;color:var(--text2)">원</span>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">일반 설정</div>
          ${toggleRowHtml('confirmSave', '저장 시 확인 팝업', '저장 전 확인 다이얼로그 표시', s.toggles.confirmSave)}
          ${toggleRowHtml('autoNextRow', '입력 후 자동 다음 행 이동', 'Enter 시 다음 행으로 포커스', s.toggles.autoNextRow)}
          ${toggleRowHtml('commaFormat', '금액 천단위 자동 콤마', '입력 중 실시간 포맷', s.toggles.commaFormat)}
        </div>

        <div style="display:flex;justify-content:flex-end">
          <button class="btn btn-primary" onclick="SettingsPage.save()">설정 저장</button>
        </div>
      </div>`;

    bindEvents();
  }

  function cardRowHtml(i, c) {
    return `<tr data-ci="${i}">
      <td><input data-ci="${i}" data-key="name" value="${esc(c.name)}" placeholder="카드명" /></td>
      <td><input type="number" data-ci="${i}" data-key="perf" value="${c.perf || 0}" /></td>
      <td><input type="number" data-ci="${i}" data-key="disc" value="${c.disc || 0}" placeholder="0" /></td>
      <td><select data-ci="${i}" data-key="perfDefault">
        <option value="true"${c.perfDefault ? ' selected' : ''}>포함</option>
        <option value="false"${!c.perfDefault ? ' selected' : ''}>미포함</option>
      </select></td>
      <td><select data-ci="${i}" data-key="discDefault">
        <option value="true"${c.discDefault ? ' selected' : ''}>포함</option>
        <option value="false"${!c.discDefault ? ' selected' : ''}>미포함</option>
      </select></td>
      <td><button class="btn-icon" onclick="SettingsPage.removeCard(${i})">-</button></td>
    </tr>`;
  }

  function catRowHtml(i, name, budget) {
    return `<div class="cat-settings-row" data-cat-idx="${i}">
      <input data-cat="${i}" data-key="name" value="${esc(name)}" placeholder="구분명" />
      <input type="number" data-cat="${i}" data-key="budget" value="${budget || 0}" />
      <button class="btn-icon" onclick="SettingsPage.removeCat(${i})">-</button>
    </div>`;
  }

  function toggleRowHtml(key, label, sub, on) {
    return `<div class="toggle-row">
      <div><div class="toggle-label">${label}</div><div class="toggle-sub">${sub}</div></div>
      <button class="toggle-btn${on ? ' on' : ''}" data-toggle="${key}" onclick="this.classList.toggle('on')"></button>
    </div>`;
  }

  function bindEvents() {
    const cardTbl = Utils.el('card-settings-tbl');
    cardTbl.addEventListener('input', e => {
      const { ci, key } = e.target.dataset;
      if (ci === undefined || !key || !_settings.cards[+ci]) return;
      _settings.cards[+ci][key] = (key === 'perf' || key === 'disc') ? +e.target.value : e.target.value;
    });
    cardTbl.addEventListener('change', e => {
      const { ci, key } = e.target.dataset;
      if (ci === undefined || !key || !_settings.cards[+ci]) return;
      _settings.cards[+ci][key] = e.target.value === 'true';
    });

    Utils.el('cat-settings-rows').addEventListener('input', e => {
      const { cat: idx, key } = e.target.dataset;
      if (idx === undefined || !key) return;
      _settings.categories[+idx][key] = key === 'budget' ? +e.target.value : e.target.value;
    });

    Utils.el('total-budget').addEventListener('input', e => {
      _settings.totalBudget = +e.target.value;
    });
  }

  function addCard() {
    const newCard = { name: '', perf: 0, disc: 0, perfDefault: true, discDefault: false };
    _settings.cards.push(newCard);
    const tbody = Utils.el('card-tbody');
    const i = _settings.cards.length - 1;
    tbody.insertAdjacentHTML('beforeend', cardRowHtml(i, newCard));
    tbody.lastElementChild.querySelector('input[data-key=name]').focus();
  }

  function removeCard(idx) {
    if (_settings.cards.length <= 1) { showToast('카드는 최소 1개 필요합니다'); return; }
    _settings.cards.splice(idx, 1);
    Utils.el('card-tbody').innerHTML = _settings.cards.map((c, i) => cardRowHtml(i, c)).join('');
  }

  function addCat() {
    _settings.categories.push({ name: '', budget: 0 });
    const rows = Utils.el('cat-settings-rows');
    const i = _settings.categories.length - 1;
    rows.insertAdjacentHTML('beforeend', catRowHtml(i, '', 0));
    rows.lastElementChild.querySelector('input[data-key=name]').focus();
  }

  function removeCat(idx) {
    _settings.categories.splice(idx, 1);
    Utils.el('cat-settings-rows').innerHTML = _settings.categories.map((c, i) => catRowHtml(i, c.name, c.budget)).join('');
  }

  async function save() {
    Utils.qsa('.toggle-btn[data-toggle]').forEach(btn => {
      _settings.toggles[btn.dataset.toggle] = btn.classList.contains('on');
    });

    const btn = Utils.el('top-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    // GAS 시도, 실패 시 localStorage fallback
    let savedToGas = false;
    try {
      await API.saveSettings(_settings);
      savedToGas = true;
    } catch {}

    try {
      localStorage.setItem('ledger_settings', JSON.stringify(_settings));
    } catch {}

    APP_STATE.settings = JSON.parse(JSON.stringify(_settings));
    showToast(savedToGas ? '설정 저장됨' : '설정 저장됨 (로컬)');

    if (btn) { btn.disabled = false; btn.textContent = '설정 저장'; }
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { init, save, addCard, removeCard, addCat, removeCat };
})();