/**
 * memo.js — 글로벌 메모 (월에 귀속되지 않음)
 * 저장소: GAS MEMO_GLOBAL 시트
 */

const MemoPage = (() => {
  let _memo = null;
  let _saveTimer = null;
  const DEBOUNCE = 800;
  const GLOBAL_KEY = 'GLOBAL';

  async function init() {
    const content = Utils.el('content');
    content.innerHTML = '<div class="page-loading"><div class="loading-spinner"></div></div>';

    try {
      const data = await API.getMemo(GLOBAL_KEY);
      _memo = data || defaultGlobalMemo();
    } catch {
      const saved = localStorage.getItem('ledger_global_memo');
      _memo = saved ? JSON.parse(saved) : defaultGlobalMemo();
    }
    if (!_memo.cards) _memo.cards = [];

    render();
  }

  function defaultGlobalMemo() {
    return { cards: [] };
  }

  function render() {
    const content = Utils.el('content');
    content.innerHTML = `
      <div class="page active" id="p-memo">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-size:12px;color:var(--text2)">월에 귀속되지 않는 공통 메모</div>
          <div style="position:relative">
            <button id="memo-add-btn" class="btn btn-sm">+ 추가</button>
            <div id="memo-add-menu" style="display:none;position:absolute;right:0;top:30px;background:var(--bg1);border:0.5px solid var(--border2);border-radius:6px;padding:4px 0;z-index:50;min-width:120px;box-shadow:0 4px 12px rgba(0,0,0,.1)">
              ${['checklist:체크리스트','free:자유 메모','info:정보','image:이미지'].map(s => {
                const [type,label] = s.split(':');
                return `<div data-type="${type}" class="memo-type-opt" style="padding:7px 14px;font-size:12px;cursor:pointer" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">${label}</div>`;
              }).join('')}
            </div>
          </div>
        </div>
        <div id="memo-cards-wrap" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px"></div>
      </div>`;

    Utils.el('memo-add-btn').addEventListener('click', e => {
      e.stopPropagation();
      const m = Utils.el('memo-add-menu');
      m.style.display = m.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => {
      const m = Utils.el('memo-add-menu');
      if (m) m.style.display = 'none';
    });
    Utils.qsa('.memo-type-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        addCard(opt.dataset.type);
        Utils.el('memo-add-menu').style.display = 'none';
      });
    });

    renderCards();
  }

  function renderCards() {
    const wrap = Utils.el('memo-cards-wrap');
    if (!wrap) return;

    if (!_memo.cards.length) {
      wrap.innerHTML = `<div style="color:var(--text3);font-size:12px;padding:20px 0">+ 추가 버튼으로 메모를 만들어보세요</div>`;
      return;
    }

    wrap.innerHTML = _memo.cards.map((card, ci) => cardHtml(card, ci)).join('');
    bindCardEvents();
  }

  function cardHtml(card, ci) {
    const typeLabel = {checklist:'체크리스트',free:'자유 메모',info:'정보',image:'이미지'}[card.type] || card.type;
    let body = '';

    if (card.type === 'checklist') {
      const items = card.items || [];
      body = `<div class="checklist">
        ${items.map((item, ii) => `
          <div class="check-item${item.done?' done':''}" style="margin-bottom:4px">
            <input type="checkbox" class="mc-chk" data-ci="${ci}" data-ii="${ii}" ${item.done?'checked':''} style="accent-color:var(--blue)" />
            <input class="mc-inp check-item-input" data-ci="${ci}" data-ii="${ii}" value="${esc(item.text||'')}" placeholder="항목..." />
            <button class="mc-item-del btn-icon" data-ci="${ci}" data-ii="${ii}">×</button>
          </div>`).join('')}
      </div>
      <button class="mc-add-item btn btn-sm" data-ci="${ci}" style="margin-top:6px">+ 항목</button>`;
    } else if (card.type === 'free') {
      body = `<textarea class="mc-inp memo-textarea" data-ci="${ci}" placeholder="자유롭게 입력...">${esc(card.text||'')}</textarea>`;
    } else if (card.type === 'info') {
      const items = card.items || [];
      body = `<table class="memo-kv-table" style="width:100%">
        ${items.map((item, ii) => `
          <tr>
            <td style="width:70px"><input class="mc-inp" data-ci="${ci}" data-ii="${ii}" data-field="label" value="${esc(item.label||'')}" placeholder="항목" style="font-size:11px;border:none;background:transparent;width:100%;color:var(--text2)" /></td>
            <td><input class="mc-inp" data-ci="${ci}" data-ii="${ii}" data-field="value" value="${esc(item.value||'')}" placeholder="내용" style="font-size:11px;border:none;background:transparent;width:100%" /></td>
            <td style="width:18px"><button class="mc-item-del btn-icon" data-ci="${ci}" data-ii="${ii}">×</button></td>
          </tr>`).join('')}
      </table>
      <button class="mc-add-item btn btn-sm" data-ci="${ci}" style="margin-top:6px">+ 행</button>`;
    } else if (card.type === 'image') {
      const imgs = card.images || [];
      body = `<div class="img-thumb-row">
        ${imgs.map((img, ii) => `
          <div class="img-thumb" onclick="MemoPage.openLightbox('${img.dataUrl||''}')">
            ${img.dataUrl ? `<img src="${img.dataUrl}" />` : `<div style="font-size:9px;color:var(--text3);padding:4px">${esc(img.name||'')}</div>`}
            <div class="img-thumb-del" onclick="event.stopPropagation();MemoPage.delImg(${ci},${ii})">×</div>
          </div>`).join('')}
      </div>
      <div class="img-drop-zone" onclick="document.getElementById('memo-img-input-${ci}').click()">
        이미지 추가
        <input type="file" id="memo-img-input-${ci}" class="mc-img-input" data-ci="${ci}" accept="image/*" multiple style="display:none" />
      </div>`;
    }

    return `
      <div class="card-raised" style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:6px">
          <input class="mc-title-inp" data-ci="${ci}" value="${esc(card.title||typeLabel)}" style="flex:1;border:none;background:transparent;font-size:12px;font-weight:500;color:var(--text1)" placeholder="제목..." />
          <button class="mc-del btn-icon" data-ci="${ci}" title="삭제">×</button>
        </div>
        ${body}
      </div>`;
  }

  function bindCardEvents() {
    const wrap = Utils.el('memo-cards-wrap');
    if (!wrap) return;

    wrap.querySelectorAll('.mc-title-inp').forEach(inp => {
      inp.oninput = e => { _memo.cards[+e.target.dataset.ci].title = e.target.value; scheduleSave(); };
    });
    wrap.querySelectorAll('.mc-del').forEach(btn => {
      btn.onclick = () => { _memo.cards.splice(+btn.dataset.ci, 1); renderCards(); scheduleSave(); };
    });
    wrap.querySelectorAll('.mc-add-item').forEach(btn => {
      btn.onclick = () => {
        const ci = +btn.dataset.ci;
        const card = _memo.cards[ci];
        card.items = card.items || [];
        card.items.push(card.type === 'checklist' ? {text:'',done:false} : {label:'',value:''});
        renderCards(); scheduleSave();
      };
    });
    wrap.querySelectorAll('.mc-item-del').forEach(btn => {
      btn.onclick = () => {
        _memo.cards[+btn.dataset.ci].items.splice(+btn.dataset.ii, 1);
        renderCards(); scheduleSave();
      };
    });
    wrap.querySelectorAll('.mc-inp').forEach(inp => {
      inp.oninput = e => {
        const {ci, ii, field} = e.target.dataset;
        const card = _memo.cards[+ci];
        if (card.type === 'free') card.text = e.target.value;
        else if (card.type === 'checklist') card.items[+ii].text = e.target.value;
        else if (card.type === 'info') card.items[+ii][field] = e.target.value;
        scheduleSave();
      };
    });
    wrap.querySelectorAll('.mc-chk').forEach(chk => {
      chk.onchange = e => {
        const {ci, ii} = e.target.dataset;
        _memo.cards[+ci].items[+ii].done = e.target.checked;
        const item = e.target.closest('.check-item');
        if (item) item.classList.toggle('done', e.target.checked);
        scheduleSave();
      };
    });
    wrap.querySelectorAll('.mc-img-input').forEach(inp => {
      inp.onchange = e => {
        const ci = +inp.dataset.ci;
        Array.from(e.target.files).forEach(file => {
          const reader = new FileReader();
          reader.onload = ev => {
            _memo.cards[ci].images = _memo.cards[ci].images || [];
            _memo.cards[ci].images.push({name: file.name, dataUrl: ev.target.result});
            renderCards(); scheduleSave();
          };
          reader.readAsDataURL(file);
        });
        e.target.value = '';
      };
    });
  }

  function addCard(type) {
    const typeLabel = {checklist:'체크리스트',free:'자유 메모',info:'정보',image:'이미지'}[type];
    const card = {type, title: typeLabel};
    if (type === 'checklist') card.items = [];
    if (type === 'info') card.items = [];
    if (type === 'image') card.images = [];
    if (type === 'free') card.text = '';
    _memo.cards.push(card);
    renderCards(); scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(doSave, DEBOUNCE);
  }

  async function doSave() {
    try {
      // 이미지 제외하고 GAS 저장
      const toSave = JSON.parse(JSON.stringify(_memo));
      if (toSave.cards) toSave.cards.forEach(card => {
        if (card.images) card.images = card.images.map(img => ({name: img.name}));
      });
      await API.saveMemo(GLOBAL_KEY, toSave);
    } catch {}
    // 이미지 포함해서 localStorage 저장
    try { localStorage.setItem('ledger_global_memo', JSON.stringify(_memo)); } catch {}
  }

  function openLightbox(src) {
    if (!src) return;
    const lb = document.createElement('div');
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:300;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    lb.innerHTML = `<img src="${src}" style="max-width:90vw;max-height:90vh;border-radius:6px;object-fit:contain" />`;
    lb.onclick = () => document.body.removeChild(lb);
    document.body.appendChild(lb);
  }

  function delImg(ci, ii) {
    _memo.cards[ci].images.splice(ii, 1);
    renderCards(); scheduleSave();
  }

  async function save() {
    await doSave();
    showToast('저장됨');
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, save, openLightbox, delImg };
})();