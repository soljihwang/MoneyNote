/**
 * settings.js — 설정 탭
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

        <!-- 카드 설정 -->
        <div class="settings-section">
          <div class="settings-section-title">카드별 실적 / 할인 설정</div>
          <table class="settings-table" id="card-settings-tbl">
            <thead>
              <tr>
                <th style="width:120px">카드명</th>
                <th>실적 허들</th>
                <th>할인 한도</th>
                <th>기본 실적</th>
                <th style="width:60px">기본 할인</th>
              </tr>
            </thead>
            <tbody>
              ${s.cards.map((c, i) => `
                <tr>
                  <td><input data-ci="${i}" data-key="name" value="${esc(c.name)}" /></td>
                  <td><input type="number" data-ci="${i}" data-key="perf" value="${c.perf || 0}" /></td>
                  <td><input type="number" data-ci="${i}" data-key="disc" value="${c.disc || 0}" placeholder="-" /></td>
                  <td>
                    <select data-ci="${i}" data-key="perfDefault">
                      <option value="true"${c.perfDefault ? ' selected' : ''}>포함</option>
                      <option value="false"${!c.perfDefault ? ' selected' : ''}>미포함</option>
                    </select>
                  </td>
                  <td>
                    <select data-ci="${i}" data-key="discDefault">
                      <option value="true"${c.discDefault ? ' selected' : ''}>포함</option>
                      <option value="false"${!c.discDefault ? ' selected' : ''}>미포함</option>
                    </select>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <!-- 구분별 예산 -->
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

        <!-- 월 총 목표 -->
        <div class="settings-section">
          <div class="settings-section-title">월 총 지출 목표</div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="number" id="total-budget" value="${s.totalBudget || 0}"
              style="height:28px;padding:0 8px;font-size:12px;border:0.5px solid var(--border);border-radius:5px;background:var(--bg1);color:var(--text1);width:140px;text-align:right" />
            <span style="font-size:11px;color:var(--text2)">원</span>
          </div>
        </div>

        <!-- 일반 설정 -->
        <div class="settings-section">
          <div class="settings-section-title">일반 설정</div>
          ${toggleRowHtml('confirmSave', '저장 시 확인 팝업', '저장 전 확인 다이얼로그 표시', s.toggles.confirmSave)}
          ${toggleRowHtml('autoNextRow', '입력 후 자동 다음 행 이동', 'Enter 시 다음 행 항목으로 포커스', s.toggles.autoNextRow)}
          ${toggleRowHtml('commaFormat', '금액 천단위 자동 콤마', '입력 중 실시간 포맷', s.toggles.commaFormat)}
        </div>

        <div style="display:flex;justify-content:flex-end">
          <button class="btn btn-primary" onclick="SettingsPage.save()">설정 저장</button>
        </div>
      </div>`;

    bindEvents();
  }

  function catRowHtml(i, name, budget) {
    return `
      <div class="cat-settings-row" data-cat-idx="${i}">
        <input data-cat="${i}" data-key="name" value="${esc(name)}" placeholder="구분명" />
        <input type="number" data-cat="${i}" data-key="budget" value="${budget || 0}" />
        <button class="btn-icon" onclick="SettingsPage.removeCat(${i})">-</button>
      </div>`;
  }

  function toggleRowHtml(key, label, sub, on) {
    return `
      <div class="toggle-row">
        <div>
          <div class="toggle-label">${label}</div>
          <div class="toggle-sub">${sub}</div>
        </div>
        <button class="toggle-btn${on ? ' on' : ''}" data-toggle="${key}" onclick="this.classList.toggle('on')"></button>
      </div>`;
  }

  function bindEvents() {
    // 카드 설정 실시간 반영
    const cardTbl = Utils.el('card-settings-tbl');
    cardTbl.addEventListener('input', e => {
      const inp = e.target;
      const ci = inp.dataset.ci;
      const key = inp.dataset.key;
      if (ci === undefined || !key) return;
      const idx = +ci;
      if (key === 'perf' || key === 'disc') {
        _settings.cards[idx][key] = +inp.value;
      } else {
        _settings.cards[idx][key] = inp.value;
      }
    });
    cardTbl.addEventListener('change', e => {
      const sel = e.target;
      const ci = sel.dataset.ci;
      const key = sel.dataset.key;
      if (ci === undefined || !key) return;
      _settings.cards[+ci][key] = sel.value === 'true';
    });

    // 구분 설정 실시간 반영
    const catRows = Utils.el('cat-settings-rows');
    catRows.addEventListener('input', e => {
      const inp = e.target;
      const idx = inp.dataset.cat;
      const key = inp.dataset.key;
      if (idx === undefined || !key) return;
      if (key === 'budget') _settings.categories[+idx][key] = +inp.value;
      else _settings.categories[+idx][key] = inp.value;
    });

    // 총 목표
    Utils.el('total-budget').addEventListener('input', e => {
      _settings.totalBudget = +e.target.value;
    });
  }

  function addCat() {
    _settings.categories.push({ name: '', budget: 0 });
    const rows = Utils.el('cat-settings-rows');
    const i = _settings.categories.length - 1;
    rows.insertAdjacentHTML('beforeend', catRowHtml(i, '', 0));
    const newRow = rows.lastElementChild;
    newRow.querySelector('input[data-key=name]').focus();
  }

  function removeCat(idx) {
    _settings.categories.splice(idx, 1);
    const rows = Utils.el('cat-settings-rows');
    rows.innerHTML = _settings.categories.map((c, i) => catRowHtml(i, c.name, c.budget)).join('');
  }

  async function save() {
    // 토글 수집
    Utils.qsa('.toggle-btn[data-toggle]').forEach(btn => {
      _settings.toggles[btn.dataset.toggle] = btn.classList.contains('on');
    });

    const btn = Utils.el('top-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }
    try {
      await API.saveSettings(_settings);
      APP_STATE.settings = JSON.parse(JSON.stringify(_settings));
      showToast('설정 저장됨');
    } catch (e) {
      showToast('저장 실패: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '설정 저장'; }
    }
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { init, save, addCat, removeCat };
})();