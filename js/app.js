/**
 * app.js — 앱 상태 관리, 라우팅, 공통 유틸
 */

// ── 전역 상태 ──────────────────────────────────────────────
const APP_STATE = {
  currentMonth: '',
  months: [],       // ['2025-04', '2025-03', ...]
  settings: null,   // { cards: [...], categories: [...], toggles: {...} }
  transactions: [], // 현재 월 거래 내역
  memo: null,       // 현재 월 메모
  dirtyInput: false,// 입력 탭 미저장 변경 있음
};

// ── 유틸 ───────────────────────────────────────────────────
const Utils = {
  fmt(n) {
    if (n == null || n === '') return '';
    const num = Number(n);
    if (!Number.isFinite(num)) return '';
    return num.toLocaleString('ko-KR');
  },
  fmtWon(n) {
    return Utils.fmt(n);
  },
  parseNum(s) {
    if (s == null || s === '') return 0;
    return Number(String(s).replace(/,/g, '')) || 0;
  },
  fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },
  dataUrlToBlob(dataUrl) {
    const [header, base64 = ''] = String(dataUrl || '').split(',');
    const mime = (header.match(/data:(.*?);base64/) || [])[1] || 'application/octet-stream';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  },
  safeFileName(name) {
    const source = String(name || 'image').trim();
    const cleaned = source.replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return cleaned || 'image.jpg';
  },
  resizeImageFile(file, { maxSide = 1200, quality = 0.82, maxBytes = 3 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('이미지를 처리할 수 없습니다.'));
          return;
        }

        const estimateDataUrlBytes = dataUrl => {
          const base64 = String(dataUrl || '').split(',')[1] || '';
          const padding = (base64.match(/=*$/) || [''])[0].length;
          return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
        };

        const renderAtScale = scale => {
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };

        let scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        let dataUrl = '';
        const qualities = [quality, 0.72, 0.6, 0.5];

        while (scale > 0.35) {
          renderAtScale(scale);
          for (const q of qualities) {
            dataUrl = canvas.toDataURL('image/jpeg', q);
            if (estimateDataUrlBytes(dataUrl) <= maxBytes) {
              resolve(dataUrl);
              return;
            }
          }
          scale *= 0.85;
        }

        if (estimateDataUrlBytes(dataUrl) > maxBytes) {
          reject(new Error('이미지 용량이 너무 커서 저장할 수 없습니다. 더 작은 이미지를 선택해주세요.'));
          return;
        }
        resolve(dataUrl);
      };
      img.onerror = reject;
      Utils.fileToDataUrl(file).then(src => { img.src = src; }).catch(reject);
    });
  },
  monthLabel(ym) {
    const [y, m] = ym.split('-');
    return y + '년 ' + Number(m) + '월';
  },
  nextMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return m === 12
      ? (y + 1) + '-01'
      : y + '-' + String(m + 1).padStart(2, '0');
  },
  prevMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return m === 1
      ? (y - 1) + '-12'
      : y + '-' + String(m - 1).padStart(2, '0');
  },
  isMgCard(cardName) {
    return cardName && cardName.includes('mg+s');
  },
  pbarColor(pct) {
    if (pct >= 1) return 'pbar-red';
    if (pct >= 0.8) return 'pbar-amber';
    return 'pbar-green';
  },
  pct(val, total) {
    if (!total) return 0;
    return Math.min(val / total, 1.2);
  },
  el(id) { return document.getElementById(id); },
  qs(sel, ctx) { return (ctx || document).querySelector(sel); },
  qsa(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; },
};

// ── 토스트 ─────────────────────────────────────────────────
function showToast(msg, duration = 2200) {
  const t = Utils.el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── 페이지 라우터 ───────────────────────────────────────────
const PAGES = {
  dash:     { title: '대시보드', search: false, save: false, init: () => DashboardPage.init() },
  input:    { title: '입력',     search: true,  save: true,  init: () => InputPage.init() },
  ledger:   { title: '내역',     search: true,  save: false, init: () => LedgerPage.init() },
  split:    { title: '가계부',   search: false, save: true,  init: () => SplitPage.init() },
  memo:     { title: '메모',     search: false, save: false, month: false, init: () => MemoPage.init() },
  compare:  { title: '카드대조', search: false, save: false, init: () => ComparePage.init() },
  settings: { title: '설정',     search: false, save: true,  init: () => SettingsPage.init() },
};

let _currentPage = 'input';

function navigateTo(pageId) {
  if (!PAGES[pageId]) return;

  if (_currentPage === 'input' && APP_STATE.dirtyInput && pageId !== 'input') {
    if (!confirm('저장하지 않은 입력이 있습니다. 이동하시겠습니까?')) return;
    APP_STATE.dirtyInput = false;
  }

  _currentPage = pageId;

  Utils.qsa('.ni').forEach(ni => {
    ni.classList.toggle('active', ni.dataset.page === pageId);
  });

  Utils.el('page-title').textContent = PAGES[pageId].title;
  const tbMonth = Utils.el('tb-month');
  tbMonth.textContent = Utils.monthLabel(APP_STATE.currentMonth);
  tbMonth.style.display = PAGES[pageId].month === false ? 'none' : '';

  const tbRight = Utils.el('tb-right');
  const sw = tbRight.querySelector('.search-wrap');
  const saveBtn = Utils.el('top-save-btn');
  sw.style.display = PAGES[pageId].search ? '' : 'none';
  saveBtn.style.display = PAGES[pageId].save ? '' : 'none';
  saveBtn.disabled = false;
  saveBtn.textContent = '저장';

  const content = Utils.el('content');
  content.removeAttribute('style');
  content.innerHTML = '<div class="page-loading"><div class="loading-spinner"></div></div>';

  saveBtn.onclick = null;
  if (pageId === 'input') saveBtn.onclick = () => InputPage.save();
  if (pageId === 'split') saveBtn.onclick = () => SplitPage.save();
  if (pageId === 'memo') saveBtn.onclick = () => MemoPage.save();
  if (pageId === 'settings') saveBtn.onclick = () => SettingsPage.save();

  const si = Utils.el('search-input');
  si.value = '';
  si.oninput = null;
  if (pageId === 'ledger') si.oninput = () => LedgerPage.applyFilter();
  if (pageId === 'input') si.oninput = () => InputPage.search(si.value);

  setTimeout(() => PAGES[pageId].init(), 0);
}

// ── 월 선택기 ───────────────────────────────────────────────
function populateMonthSel(months, current) {
  const sel = Utils.el('month-sel');
  sel.innerHTML = months.map(m =>
    `<option value="${m}"${m === current ? ' selected' : ''}>${Utils.monthLabel(m)}</option>`
  ).join('');
}

// ── 월 생성 모달 ────────────────────────────────────────────
function openNewMonthModal() {
  const next = Utils.nextMonth(APP_STATE.currentMonth);
  Utils.el('modal-month-title').textContent = Utils.monthLabel(next) + ' 시트 생성';
  Utils.el('modal-confirm').dataset.month = next;
  Utils.el('modal-overlay').classList.add('show');
}

function closeModal() {
  Utils.el('modal-overlay').classList.remove('show');
  Utils.el('item-memo-overlay').classList.remove('show');
}

// ── 앱 초기화 ───────────────────────────────────────────────
async function initApp() {
  Utils.qsa('.ni:not(.disabled)').forEach(ni => {
    ni.addEventListener('click', () => navigateTo(ni.dataset.page));
  });

  Utils.el('hamburger').addEventListener('click', () => {
    Utils.el('sidebar').classList.toggle('open');
    Utils.el('sidebar-overlay').classList.toggle('show');
  });
  Utils.el('sidebar-overlay').addEventListener('click', () => {
    Utils.el('sidebar').classList.remove('open');
    Utils.el('sidebar-overlay').classList.remove('show');
  });

  Utils.el('btn-new-month').addEventListener('click', openNewMonthModal);
  Utils.el('modal-cancel').addEventListener('click', closeModal);
  Utils.el('modal-overlay').addEventListener('click', e => {
    if (e.target === Utils.el('modal-overlay')) closeModal();
  });

  Utils.el('modal-confirm').addEventListener('click', async () => {
    const month = Utils.el('modal-confirm').dataset.month;
    try {
      Utils.el('modal-confirm').textContent = '생성 중...';
      Utils.el('modal-confirm').disabled = true;
      await API.createMonth(month);
      APP_STATE.months.unshift(month);
      populateMonthSel(APP_STATE.months, month);
      APP_STATE.currentMonth = month;
      APP_STATE.transactions = [];
      APP_STATE.memo = null;
      closeModal();
      showToast(Utils.monthLabel(month) + ' 생성됨');
      navigateTo('split');
    } catch (e) {
      showToast('생성 실패: ' + e.message);
    } finally {
      Utils.el('modal-confirm').textContent = '생성';
      Utils.el('modal-confirm').disabled = false;
    }
  });

  Utils.el('month-sel').addEventListener('change', async e => {
    const nextMonth = e.target.value;
    APP_STATE.currentMonth = nextMonth;
    APP_STATE.transactions = [];
    APP_STATE.memo = null;
    try {
      APP_STATE.settings = await API.getSettings(nextMonth);
    } catch (err) {
      console.error('[month change:getSettings]', err);
      APP_STATE.settings = defaultSettings();
      showToast('설정 데이터를 불러오지 못했습니다: ' + err.message, 3000);
    }
    const tbMonth = Utils.el('tb-month');
    tbMonth.textContent = Utils.monthLabel(APP_STATE.currentMonth);
    tbMonth.style.display = PAGES[_currentPage]?.month === false ? 'none' : '';
    navigateTo(_currentPage);
  });

  try {
    const months = await API.getMonths();
    APP_STATE.months = months && months.length ? months : [currentYearMonth()];
    const thisMonth = currentYearMonth();
    APP_STATE.currentMonth = APP_STATE.months.includes(thisMonth) ? thisMonth : APP_STATE.months[0];
    APP_STATE.settings = await API.getSettings(APP_STATE.currentMonth);
  } catch {
    APP_STATE.months = [currentYearMonth()];
    APP_STATE.currentMonth = APP_STATE.months[0];
    try {
      const saved = localStorage.getItem('ledger_settings');
      APP_STATE.settings = saved ? JSON.parse(saved) : defaultSettings();
    } catch {
      APP_STATE.settings = defaultSettings();
    }
    showToast('오프라인 모드 — GAS URL을 설정해주세요');
  }

  populateMonthSel(APP_STATE.months, APP_STATE.currentMonth);
  const tbMonth = Utils.el('tb-month');
  tbMonth.textContent = Utils.monthLabel(APP_STATE.currentMonth);
  tbMonth.style.display = '';

  navigateTo('split');
}

function currentYearMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function defaultSettings() {
  return {
    cards: [
      { name: 'mg+s(나)',       perf: 600000, disc: 30000, perfDefault: true,  discDefault: false, inactive: false },
      { name: 'mg+s(재욱)',     perf: 412800, disc: 30000, perfDefault: true,  discDefault: false },
      { name: 'mg+s(나)할인',   perf: 0,      disc: 30000, perfDefault: false, discDefault: true },
      { name: 'mg+s(재욱)할인', perf: 0,      disc: 30000, perfDefault: false, discDefault: true },
      { name: '내 제이드',      perf: 30000,  disc: 0,     perfDefault: true,  discDefault: false },
      { name: '더모아',         perf: 300000, disc: 0,     perfDefault: true,  discDefault: false },
      { name: '제일(3일이후)',  perf: 300000, disc: 0,     perfDefault: true,  discDefault: false },
      { name: '현금/기타',      perf: 0,      disc: 0,     perfDefault: false, discDefault: false },
    ],
    categories: [
      { name: '외식배달', budget: 100000 },
      { name: '식료품',   budget: 400000 },
      { name: '취미생활', budget: 100000 },
      { name: '생활용품', budget: 150000 },
      { name: '자기개발', budget: 0 },
      { name: '여행',     budget: 0 },
      { name: '솔지',     budget: 0 },
      { name: '재욱',     budget: 0 },
    ],
    totalBudget: 1000000,
    toggles: {
      confirmSave: true,
      autoNextRow: false,
      commaFormat: true,
    },
  };
}

// ── 거래 데이터 헬퍼 ────────────────────────────────────────
async function ensureTransactions() {
  if (APP_STATE.transactions.length > 0) return;
  try {
    const rows = await API.getTransactions(APP_STATE.currentMonth);
    APP_STATE.transactions = rows || [];
  } catch {
    APP_STATE.transactions = [];
  }
}

async function ensureMemo() {
  if (APP_STATE.memo) return;
  try {
    const memo = await API.getMemo(APP_STATE.currentMonth);
    APP_STATE.memo = memo || defaultMemo();
  } catch {
    APP_STATE.memo = defaultMemo();
  }
}

function defaultMemo() {
  return {
    payments: [],
    checklist: [],
    benefits: [],
    freeText: '',
    images: [],
    cards: [],
  };
}

// ── 시작 ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initApp);
