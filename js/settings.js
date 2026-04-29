/**
 * settings.js v4 — 카드/구분 설정 저장 안정화
 */

const SettingsPage = (() => {
  let _settings = null;

  async function init() {
    _settings = normalizeSettings(JSON.parse(JSON.stringify(APP_STATE.settings || defaultSettings())));
    render();
  }

  function render() {
    const s = _settings;

    Utils.el('content').innerHTML = `
      <div class="page active" id="p-settings">

        <div class="settings-section">
          <div class="settings-section-title">카드별 실적 / 할인 설정</div>
          <div style="font-size:9px;color:var(--text3);margin-bottom:5px">기본 실적: 카드 선택 시 실적 체크박스 기본값 / 기본 할인: 카드 선택 시 할인 체크박스 기본값 (mg+s 계열만 활성)</div>
          <table class="settings-table" id="card-settings-tbl">
            <thead><tr>
              <th style="width:110px">카드명</th>
              <th>실적 허들</th>
              <th>할인 한도</th>
              <th>기본 실적</th>
              <th>기본 할인</th>
              <th style="width:70px">구분</th>
              <th style="width:40px;text-align:center">비활성</th>
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
          <div style="display:grid;grid-template-columns:120px 1fr 50px 24px;gap:6px;font-size:9px;color:var(--text3);margin-bottom:4px">
            <span>구분명</span>
            <span>월 목표금액</span>
            <span style="text-align:center">비활성</span>
            <span></span>
          </div>
          <div id="cat-settings-rows">
            ${s.categories.map((c, i) => catRowHtml(i, c.name, c.budget, c.inactive)).join('')}
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

        <div style="display:flex;justify-content:flex-end">
          <button class="btn btn-primary" onclick="SettingsPage.save()">설정 저장</button>
        </div>
      </div>`;

    bindEvents();
  }

  function cardRowHtml(i, c) {
    const inactive = c.inactive ? 'checked' : '';
    const owner = c.owner || 'me';

    return `<tr data-ci="${i}" style="${c.inactive ? 'opacity:.45' : ''}">
      <td><input data-ci="${i}" data-key="name" value="${esc(c.name)}" placeholder="카드명" /></td>
      <td><input type="number" data-ci="${i}" data-key="perf" value="${c.perf || 0}" /></td>
      <td><input type="number" data-ci="${i}" data-key="disc" value="${c.disc || 0}" placeholder="0" /></td>
      <td><select data-ci="${i}" data-key="perfDefault">
        <option value="true"${c.perfDefault !== false ? ' selected' : ''}>포함</option>
        <option value="false"${c.perfDefault === false ? ' selected' : ''}>미포함</option>
      </select></td>
      <td><select data-ci="${i}" data-key="discDefault">
        <option value="true"${c.discDefault === true ? ' selected' : ''}>포함</option>
        <option value="false"${c.discDefault !== true ? ' selected' : ''}>미포함</option>
      </select></td>
      <td><select data-ci="${i}" data-key="owner" style="width:100%;height:26px;font-size:11px;padding:0 4px;border:0.5px solid var(--border);border-radius:4px;background:var(--bg1);color:var(--text1)">
        <option value="me"${owner === 'me' ? ' selected' : ''}>내 카드</option>
        <option value="spouse"${owner === 'spouse' ? ' selected' : ''}>남편 카드</option>
        <option value="common"${owner === 'common' ? ' selected' : ''}>공통</option>
      </select></td>
      <td style="text-align:center"><input type="checkbox" data-ci="${i}" data-key="inactive" ${inactive} style="accent-color:var(--blue)" /></td>
      <td><button class="btn-icon" onclick="SettingsPage.removeCard(${i})">-</button></td>
    </tr>`;
  }

  function catRowHtml(i, name, budget, inactive) {
    return `<div class="cat-settings-row" data-cat-idx="${i}" style="grid-template-columns:120px 1fr 50px 24px;${inactive ? 'opacity:.45' : ''}">
      <input data-cat="${i}" data-key="name" value="${esc(name)}" placeholder="구분명" />
      <input type="number" data-cat="${i}" data-key="budget" value="${budget || 0}" />
      <div style="display:flex;align-items:center;justify-content:center">
        <input type="checkbox" data-cat="${i}" data-key="inactive" ${inactive ? 'checked' : ''} style="accent-color:var(--blue)" />
      </div>
      <button class="btn-icon" onclick="SettingsPage.removeCat(${i})">-</button>
    </div>`;
  }

  function bindEvents() {
    const cardTbl = Utils.el('card-settings-tbl');

    cardTbl.addEventListener('input', e => {
      const { ci, key } = e.target.dataset;
      if (ci === undefined || !key || !_settings.cards[+ci]) return;

      const card = _settings.cards[+ci];

      if (key === 'perf' || key === 'disc') {
        card[key] = Number(e.target.value || 0);
      } else {
        card[key] = e.target.value;
      }
    });

    cardTbl.addEventListener('change', e => {
      const { ci, key } = e.target.dataset;
      if (ci === undefined || !key || !_settings.cards[+ci]) return;

      const card = _settings.cards[+ci];

      if (e.target.type === 'checkbox') {
        card[key] = e.target.checked;
      } else if (key === 'perfDefault' || key === 'discDefault') {
        card[key] = e.target.value === 'true';
      } else if (key === 'owner') {
        card[key] = e.target.value || 'me';
      } else if (key === 'perf' || key === 'disc') {
        card[key] = Number(e.target.value || 0);
      } else {
        card[key] = e.target.value;
      }

      if (key === 'inactive') {
        const tr = e.target.closest('tr');
        if (tr) tr.style.opacity = e.target.checked ? '.45' : '';
      }
    });

    Utils.el('cat-settings-rows').addEventListener('input', e => {
      const { cat: idx, key } = e.target.dataset;
      if (idx === undefined || !key || !_settings.categories[+idx]) return;

      if (key === 'budget') {
        _settings.categories[+idx][key] = Number(e.target.value || 0);
      } else {
        _settings.categories[+idx][key] = e.target.value;
      }
    });

    Utils.el('cat-settings-rows').addEventListener('change', e => {
      const { cat: idx, key } = e.target.dataset;
      if (idx === undefined || !key || !_settings.categories[+idx]) return;

      if (e.target.type === 'checkbox') {
        _settings.categories[+idx][key] = e.target.checked;

        const row = e.target.closest('.cat-settings-row');
        if (row) row.style.opacity = e.target.checked ? '.45' : '';
      }
    });

    Utils.el('total-budget').addEventListener('input', e => {
      _settings.totalBudget = Number(e.target.value || 0);
    });
  }

  function addCard() {
    const newCard = {
      name: '',
      perf: 0,
      disc: 0,
      perfDefault: true,
      discDefault: false,
      owner: 'me',
      inactive: false,
    };

    _settings.cards.push(newCard);

    const tbody = Utils.el('card-tbody');
    const i = _settings.cards.length - 1;

    tbody.insertAdjacentHTML('beforeend', cardRowHtml(i, newCard));
    tbody.lastElementChild.querySelector('input[data-key=name]').focus();
  }

  function removeCard(idx) {
    if (_settings.cards.length <= 1) {
      showToast('카드는 최소 1개 필요합니다');
      return;
    }

    _settings.cards.splice(idx, 1);
    Utils.el('card-tbody').innerHTML = _settings.cards.map((c, i) => cardRowHtml(i, c)).join('');
  }

  function addCat() {
    _settings.categories.push({
      name: '',
      budget: 0,
      inactive: false,
    });

    const rows = Utils.el('cat-settings-rows');
    const i = _settings.categories.length - 1;

    rows.insertAdjacentHTML('beforeend', catRowHtml(i, '', 0, false));
    rows.lastElementChild.querySelector('input[data-key=name]').focus();
  }

  function removeCat(idx) {
    _settings.categories.splice(idx, 1);
    Utils.el('cat-settings-rows').innerHTML = _settings.categories.map((c, i) => catRowHtml(i, c.name, c.budget, c.inactive)).join('');
  }

  async function save() {
    document.activeElement?.blur?.();

    _settings = normalizeSettings(_settings);

    const btn = Utils.el('top-save-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '저장 중...';
    }

    try {
      await API.saveSettings(_settings);

      localStorage.setItem('ledger_settings', JSON.stringify(_settings));
      APP_STATE.settings = JSON.parse(JSON.stringify(_settings));

      API.clearCacheForMonth('');
      showToast('설정 저장됨');

      render();
    } catch (err) {
      console.error('[SettingsPage.save]', err);
      showToast('설정 저장 실패: ' + err.message, 3500);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '설정 저장';
      }
    }
  }

  function normalizeSettings(settings) {
    const s = settings || {};

    return {
      cards: Array.isArray(s.cards) ? s.cards.map(card => ({
        name: card.name || '',
        perf: Number(card.perf || 0),
        disc: Number(card.disc || 0),
        perfDefault: card.perfDefault !== false,
        discDefault: card.discDefault === true,
        owner: card.owner || 'me',
        inactive: card.inactive === true,
      })) : [],

      categories: Array.isArray(s.categories) ? s.categories.map(cat => ({
        name: cat.name || '',
        budget: Number(cat.budget || 0),
        inactive: cat.inactive === true,
      })) : [],

      totalBudget: Number(s.totalBudget || 0),

      toggles: s.toggles || {},
    };
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    init,
    save,
    addCard,
    removeCard,
    addCat,
    removeCat,
  };
})();