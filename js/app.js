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
    return Number(n).toLocaleString('ko-KR');
  },
  fmtWon(n) {
    return Utils.fmt(n);
  },
  parseNum(s) {
    if (s == null || s === '') return 0;
    return Number(String(s).replace(/,/g, '')) || 0;
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
    if (pct >= 1)   return 'pbar-red';
    if (pct >= 0.8) return 'pbar-amber';
    return 'pbar-green';
  },
  // 퍼센트 소수로 반환 (0~1+)
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
  memo:     { title: '메모',     search: false, save: true,  init: () => MemoPage.init() },
  compare:  { title: '카드 대조', search: false, save: false, init: () => ComparePage.init() },
  settings: { title: '설정',     search: false, save: true,  init: () => SettingsPage.init() },
};

let _currentPage = 'input';

function navigateTo(pageId) {
  if (!PAGES[pageId]) return;

  // 미저장 경고 (입력 탭에서 다른 탭으로 이동 시)
  if (_currentPage === 'input' && APP_STATE.dirtyInput && pageId !== 'input') {
    if (!confirm('저장하지 않은 입력이 있습니다. 이동하시겠습니까?')) return;
    APP_STATE.dirtyInput = false;
  }

  _currentPage = pageId;

  // 네비 active 업데이트
  Utils.qsa('.ni').forEach(ni => {
    ni.classList.toggle('active', ni.dataset.page === pageId);
  });

  // 타이틀 / 월 라벨
  Utils.el('page-title').textContent = PAGES[pageId].title;
  Utils.el('tb-month').textContent = Utils.monthLabel(APP_STATE.currentMonth);

  // 검색창 / 저장 버튼
  const tbRight = Utils.el('tb-right');
  const sw = tbRight.querySelector('.search-wrap');
  const saveBtn = Utils.el('top-save-btn');
  sw.style.display = PAGES[pageId].search ? '' : 'none';
  saveBtn.style.display = PAGES[pageId].save ? '' : 'none';

  // 콘텐츠 렌더링
  const content = Utils.el('content');
  content.innerHTML = '<div class="page-loading"><div class="loading-spinner"></div></div>';

  // 저장 버튼 핸들러 교체
  saveBtn.onclick = null;
  if (pageId === 'input')    saveBtn.onclick = () => InputPage.save();
  if (pageId === 'memo')     saveBtn.onclick = () => MemoPage.save();
  if (pageId === 'settings') saveBtn.onclick = () => SettingsPage.save();

  // 검색 핸들러
  const si = Utils.el('search-input');
  si.value = '';
  si.oninput = null;
  if (pageId === 'ledger') si.oninput = () => LedgerPage.applyFilter();
  if (pageId === 'input')  si.oninput = () => InputPage.search(si.value);

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
  // 네비 클릭 바인딩
  Utils.qsa('.ni:not(.disabled)').forEach(ni => {
    ni.addEventListener('click', () => navigateTo(ni.dataset.page));
  });

  // 모바일 햄버거
  Utils.el('hamburger').addEventListener('click', () => {
    Utils.el('sidebar').classList.toggle('open');
    Utils.el('sidebar-overlay').classList.toggle('show');
  });
  Utils.el('sidebar-overlay').addEventListener('click', () => {
    Utils.el('sidebar').classList.remove('open');
    Utils.el('sidebar-overlay').classList.remove('show');
  });

  // 모달 버튼
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
      navigateTo('input');
    } catch (e) {
      showToast('생성 실패: ' + e.message);
    } finally {
      Utils.el('modal-confirm').textContent = '생성';
      Utils.el('modal-confirm').disabled = false;
    }
  });

  // 월 변경
  Utils.el('month-sel').addEventListener('change', async e => {
    APP_STATE.currentMonth = e.target.value;
    APP_STATE.transactions = [];
    APP_STATE.memo = null;
    Utils.el('tb-month').textContent = Utils.monthLabel(APP_STATE.currentMonth);
    navigateTo(_currentPage);
  });

  // 설정/월 목록 로드
  try {
    const [months, settings] = await Promise.all([
      API.getMonths(),
      API.getSettings(),
    ]);
    APP_STATE.months = months && months.length ? months : [currentYearMonth()];
    APP_STATE.currentMonth = APP_STATE.months[0];
    APP_STATE.settings = settings || defaultSettings();
  } catch {
    // GAS 미연결 시 목업 데이터로 시작
    APP_STATE.months = [currentYearMonth()];
    APP_STATE.currentMonth = APP_STATE.months[0];
    APP_STATE.settings = defaultSettings();
    showToast('오프라인 모드 — GAS URL을 설정해주세요');
  }

  populateMonthSel(APP_STATE.months, APP_STATE.currentMonth);
  Utils.el('tb-month').textContent = Utils.monthLabel(APP_STATE.currentMonth);

  navigateTo('input');
}

function currentYearMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function defaultSettings() {
  return {
    cards: [
      { name: 'mg+s(나)',       perf: 600000, disc: 30000, perfDefault: true,  discDefault: false },
      { name: 'mg+s(재욱)',     perf: 412800, disc: 30000, perfDefault: true,  discDefault: false },
      { name: 'mg+s(나)할인',  perf: 0,      disc: 30000, perfDefault: false, discDefault: true },
      { name: 'mg+s(재욱)할인',perf: 0,      disc: 30000, perfDefault: false, discDefault: true },
      { name: '내 제이드',      perf: 30000,  disc: 0,     perfDefault: true,  discDefault: false },
      { name: '더모아',         perf: 300000, disc: 0,     perfDefault: true,  discDefault: false },
      { name: '제일(3일이후)', perf: 300000, disc: 0,     perfDefault: true,  discDefault: false },
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
    payments: [],     // [{label, value}]
    checklist: [],    // [{text, done}]
    benefits: [],     // [{label, value}]
    freeText: '',
    images: [],       // [{ name, dataUrl }]
  };
}

// ── 시작 ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initApp);