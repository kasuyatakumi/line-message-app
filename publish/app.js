/**
 * app.js — 画面制御
 * 4タブ（作成/返信/履歴/設定）と、結果・2つの小窓を操作する。
 * （求職者の選択・自動登録は「作成/返信」の求職者欄＝M02で行う。一覧タブは非表示。）
 */
'use strict';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const state = {
  data: null,
  create: { level: '2', sceneId: '' },
  reply: { level: '2' },
  result: null,      // { type, historyId, variants, request }
  history: { page: 0, hasMore: false, items: [] }
};

/* ============ 共通UI ============ */
let toastTimer = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 1800);
}
function showLoading(text, onRetry) {
  $('loading-text').textContent = text || '処理しています…';
  const r = $('loading-retry');
  if (onRetry) { r.classList.remove('hidden'); r.onclick = onRetry; } else { r.classList.add('hidden'); r.onclick = null; }
  $('loading').classList.remove('hidden');
}
function hideLoading() { $('loading').classList.add('hidden'); }

/** APIエラーを画面向けメッセージにして表示。認証切れならログインへ。 */
function handleError(e, retry) {
  if (e && e.code === 'AUTH_REQUIRED') { toast('ログインが切れました'); showLogin(); hideLoading(); return; }
  const msg = (e && e.message) ? e.message : 'エラーが発生しました';
  if (retry) showLoading(msg, retry); else { hideLoading(); toast(msg); }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta); return true;
    } catch (e2) { return false; }
  }
}

/* ============ 画面遷移 ============ */
function showLogin() { $('screen-login').classList.remove('hidden'); $('app').classList.add('hidden'); }
function showApp() { $('screen-login').classList.add('hidden'); $('app').classList.remove('hidden'); }

const TAB_TITLE = { create: '作成', reply: '返信', history: '履歴', settings: '設定' };
function showTab(name) {
  ['create', 'reply', 'history', 'settings'].forEach((t) => {
    $('tab-' + t).classList.toggle('hidden', t !== name);
  });
  document.querySelectorAll('.tabbar-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('header-title').textContent = TAB_TITLE[name];
  if (name === 'history') { state.history.page = 0; runHistorySearch(true); }
}

/* ============ 起動 ============ */
async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  bindLogin();
  bindTabs();
  bindCreate();
  bindReply();
  bindHistory();
  bindSettings();
  bindModals();
  bindResult();

  // 入力途中の下書きを戻す
  const draft = Store.get(Store.DRAFT, null);
  if (draft && draft.input) $('create-input').value = draft.input;

  if (!Api.token()) { showLogin(); return; }

  // キャッシュで即表示 → 裏で最新取得
  const cached = Api.cachedBootstrap();
  if (cached) { state.data = cached; applyData(); showApp(); showTab('create'); }
  refreshBootstrap();
}

async function refreshBootstrap() {
  try {
    await Api.flushQueue();
    const data = await Api.bootstrap();
    state.data = data; applyData();
    if ($('app').classList.contains('hidden')) { showApp(); showTab('create'); }
  } catch (e) {
    if (e.code === 'AUTH_REQUIRED') { showLogin(); return; }
    if (!state.data) toast(e.message || '読み込みに失敗しました');
  }
}

/** bootstrap のデータを各画面に反映。 */
function applyData() {
  renderLevelButtons('create-levels', 'create');
  renderLevelButtons('reply-levels', 'reply');
  renderSceneButtons();
  fillHistoryLevelFilter();
  fillSceneFilter();
  applySettingsToForm();
  updateGenerateEnabled();
}

/* ============ S01 ログイン ============ */
function bindLogin() {
  $('passcode-toggle').onclick = () => {
    const p = $('passcode'); p.type = p.type === 'password' ? 'text' : 'password';
    $('passcode-toggle').textContent = p.type === 'password' ? '表示' : '隠す';
  };
  $('login-btn').onclick = doLogin;
  $('passcode').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}
async function doLogin() {
  const pass = $('passcode').value;
  if (!pass) { $('login-msg').textContent = 'パスコードを入力してください'; return; }
  $('login-msg').textContent = '';
  $('login-btn').disabled = true;
  try {
    await Api.login(pass, navigator.userAgent.slice(0, 60));
    $('passcode').value = '';
    await refreshBootstrap();
    showApp(); showTab('create');
  } catch (e) {
    $('login-msg').textContent = e.message || 'ログインに失敗しました';
  } finally { $('login-btn').disabled = false; }
}

/* ============ タブ ============ */
function bindTabs() {
  document.querySelectorAll('.tabbar-btn').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
}

/* ============ レベル・シーン描画 ============ */
function levelList() {
  const lv = (state.data && state.data.levels) || [];
  return lv.slice().sort((a, b) => Number(a.level) - Number(b.level));
}
function renderLevelButtons(containerId, which) {
  const box = $(containerId); box.innerHTML = '';
  levelList().forEach((lv) => {
    const b = el('button', 'level-btn');
    b.type = 'button';
    b.innerHTML = '<span class="lv-num">Lv' + lv.level + '</span>' + (lv.label || '');
    if (String(state[which].level) === String(lv.level)) b.classList.add('active');
    b.onclick = () => { state[which].level = String(lv.level); renderLevelButtons(containerId, which); };
    box.appendChild(b);
  });
}
function renderSceneButtons() {
  const box = $('create-scenes'); box.innerHTML = '';
  const scenes = ((state.data && state.data.scenes) || [])
    .filter((s) => String(s.active).toUpperCase() !== 'FALSE')
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  if (!state.create.sceneId) {
    const free = scenes.find((s) => s.name === '自由入力');
    if (free) state.create.sceneId = free.id;
  }
  // フェーズごとにまとめ、チップは折り返して表示（横スクロールしない）
  const groups = [];
  scenes.forEach((s) => {
    const phase = s.phase || '';
    let g = groups.find((x) => x.phase === phase);
    if (!g) { g = { phase, items: [] }; groups.push(g); }
    g.items.push(s);
  });
  groups.forEach((g) => {
    const grp = el('div', 'scene-group');
    if (g.phase) grp.appendChild(el('div', 'scene-phase-head', g.phase));
    const chips = el('div', 'scene-chips');
    g.items.forEach((s) => {
      const b = el('button', 'scene-btn', s.name);
      b.type = 'button';
      if (String(state.create.sceneId) === String(s.id)) b.classList.add('active');
      b.onclick = () => { state.create.sceneId = s.id; renderSceneButtons(); applySceneHint(s); };
      chips.appendChild(b);
    });
    grp.appendChild(chips);
    box.appendChild(grp);
  });
  const cur = scenes.find((s) => String(s.id) === String(state.create.sceneId));
  if (cur) applySceneHint(cur);
}
function applySceneHint(scene) {
  $('create-input').placeholder = scene && scene.hint ? scene.hint : '伝えたいことをざっくり入力';
}

/* ============ S02 作成 ============ */
function bindCreate() {
  $('create-input').addEventListener('input', () => { Store.set(Store.DRAFT, { input: $('create-input').value }); updateGenerateEnabled(); });
  $('create-fav').onclick = () => openFavorites();
  $('create-generate').onclick = () => doGenerate('create');
}
function updateGenerateEnabled() {
  $('create-generate').disabled = $('create-input').value.trim() === '';
  $('reply-generate').disabled = $('reply-received').value.trim() === '';
}

/* ============ S04 返信 ============ */
function bindReply() {
  $('reply-received').addEventListener('input', updateGenerateEnabled);
  $('reply-generate').onclick = () => doGenerate('reply');
}

/* ============ 生成 ============ */
function buildGenerateRequest(which) {
  const st = state[which];
  const req = { type: which === 'reply' ? 'reply' : 'create', level: st.level, sceneId: which === 'create' ? state.create.sceneId : '' };
  if (which === 'create') req.inputText = $('create-input').value.trim();
  else { req.receivedText = $('reply-received').value.trim(); req.inputText = $('reply-input').value.trim(); }
  return req;
}
async function doGenerate(which) {
  const req = buildGenerateRequest(which);
  showLoading(which === 'reply' ? '返信を考えています…' : '文面を考えています…');
  try {
    const data = await Api.generate(req);
    hideLoading();
    state.result = { type: req.type, historyId: data.historyId, variants: data.variants, request: req };
    renderResult();
    if (which === 'create') { $('create-input').value = ''; Store.remove(Store.DRAFT); updateGenerateEnabled(); }
  } catch (e) {
    handleError(e, () => { hideLoading(); doGenerate(which); });
  }
}

/* ============ S03 結果 ============ */
const REVISE_OPTS = [
  { k: '短く', t: 'もっと短くしてください' },
  { k: '丁寧に', t: 'もっと丁寧にしてください' },
  { k: 'くだけて', t: 'もっとくだけた感じにしてください' },
  { k: '絵文字なし', t: '絵文字を使わないでください' },
  { k: '絵文字多め', t: '絵文字を少し多めにしてください' },
  { k: '分ける', t: '複数の吹き出しに分けてください' },
  { k: 'まとめる', t: '1つの吹き出しにまとめてください' }
];
function bindResult() {
  $('result-back').onclick = () => $('screen-result').classList.add('hidden');
  $('result-regen').onclick = regenerate;
}
function renderResult() {
  const box = $('result-cards'); box.innerHTML = '';
  state.result.variants.forEach((v, idx) => box.appendChild(renderCard(v, idx)));
  $('screen-result').classList.remove('hidden');
  $('screen-result').scrollTop = 0;
}
function renderCard(variant, idx) {
  const card = el('div', 'rcard');
  card.appendChild(el('span', 'rcard-label', variant.label || ('案' + (idx + 1))));

  const bubbles = el('div', 'bubbles');
  variant.messages.forEach((m, bi) => {
    const b = el('div', 'bubble');
    const span = el('div'); span.contentEditable = 'true'; span.textContent = m;
    span.addEventListener('input', () => { state.result.variants[idx].messages[bi] = span.textContent; });
    const cp = el('button', 'bubble-copy', 'コピー'); cp.type = 'button';
    cp.onclick = () => doCopy(span.textContent, idx);
    b.appendChild(cp); b.appendChild(span);
    bubbles.appendChild(b);
  });
  card.appendChild(bubbles);

  const actions = el('div', 'rcard-actions');
  const all = el('button', 'ghost-btn', '全部コピー'); all.type = 'button';
  all.onclick = () => doCopy(state.result.variants[idx].messages.join('\n'), idx);
  const fav = el('button', 'ghost-btn', 'お気に入り'); fav.type = 'button';
  fav.onclick = () => saveVariantAsFavorite(idx);
  const rv = el('button', 'ghost-btn', '手直し'); rv.type = 'button';
  const reviseBox = el('div');
  rv.onclick = () => reviseBox.classList.toggle('open') || renderReviseRow(reviseBox, idx);
  actions.appendChild(all); actions.appendChild(fav); actions.appendChild(rv);
  card.appendChild(actions);
  card.appendChild(reviseBox);
  return card;
}
function renderReviseRow(box, idx) {
  if (box.dataset.ready) { box.style.display = box.style.display === 'none' ? '' : 'none'; return; }
  box.dataset.ready = '1';
  const row = el('div', 'revise-row');
  REVISE_OPTS.forEach((o) => {
    const c = el('button', 'revise-chip', o.k); c.type = 'button';
    c.onclick = () => doRevise(idx, o.t);
    row.appendChild(c);
  });
  box.appendChild(row);
  const custom = el('div', 'revise-custom');
  const inp = el('input'); inp.placeholder = '自由に指示（例：日程を2案にして）';
  const go = el('button', 'ghost-btn', '直す'); go.type = 'button';
  go.onclick = () => { if (inp.value.trim()) doRevise(idx, inp.value.trim()); };
  custom.appendChild(inp); custom.appendChild(go);
  box.appendChild(custom);
}
async function doRevise(idx, instruction) {
  showLoading('手直ししています…');
  try {
    const data = await Api.revise({
      historyId: state.result.historyId,
      variantIndex: idx,
      currentMessages: state.result.variants[idx].messages,
      instruction
    });
    hideLoading();
    state.result.variants[idx] = data.variant;
    renderResult();
  } catch (e) { handleError(e, () => { hideLoading(); doRevise(idx, instruction); }); }
}
async function doCopy(text, idx) {
  const ok = await copyText(text);
  if (!ok) { toast('コピーできませんでした'); return; }
  toast('コピーしました');
  // 裏でコピー記録（失敗時はキューへ）
  Api.markCopied(state.result.historyId, state.result.variants[idx].messages.join('\n'));
}
function regenerate() {
  $('screen-result').classList.add('hidden');
  doGenerate(state.result.type === 'reply' ? 'reply' : 'create');
}
async function saveVariantAsFavorite(idx) {
  try {
    const fav = await Api.saveFavorite({
      historyId: state.result.historyId,
      body: state.result.variants[idx].messages.join('\n'),
      title: (state.result.variants[idx].label || '定型文')
    });
    state.data.favorites.push(fav.favorite); Store.set(Store.BOOTSTRAP, state.data);
    toast('お気に入りに追加しました');
  } catch (e) { handleError(e); }
}

/* ============ M01 お気に入り ============ */
function openFavorites() {
  fillSceneFilter();
  renderFavList('');
  $('modal-fav').classList.remove('hidden');
}
function renderFavList(sceneId) {
  const box = $('fav-list'); box.innerHTML = '';
  const list = (state.data.favorites || []).filter((f) => !sceneId || String(f.scene_id) === String(sceneId));
  if (!list.length) { box.appendChild(el('p', 'muted small', 'お気に入りはまだありません（結果画面の「お気に入り」で追加できます）')); return; }
  list.forEach((f) => {
    const item = el('div', 'list-item');
    const top = el('div', 'li-top');
    top.appendChild(el('span', 'li-name', f.title || '定型文'));
    const del = el('button', 'bubble-copy', '削除'); del.type = 'button'; del.style.position = 'static';
    del.onclick = (ev) => { ev.stopPropagation(); deleteFav(f.id); };
    top.appendChild(del);
    item.appendChild(top);
    item.appendChild(el('div', 'li-body', f.body || ''));
    item.onclick = () => { insertFavorite(f.body || ''); closeModal('modal-fav'); };
    box.appendChild(item);
  });
}
function insertFavorite(body) {
  const ta = $('create-input');
  ta.value = ta.value ? (ta.value + '\n' + body) : body;
  Store.set(Store.DRAFT, { input: ta.value });
  updateGenerateEnabled();
  showTab('create');
}
async function deleteFav(id) {
  try {
    await Api.deleteFavorite(id);
    state.data.favorites = state.data.favorites.filter((f) => f.id !== id);
    Store.set(Store.BOOTSTRAP, state.data);
    renderFavList($('fav-scene-filter').value);
  } catch (e) { handleError(e); }
}

/* ============ S07 履歴 ============ */
let histTimer = null;
function bindHistory() {
  $('hist-search').addEventListener('input', () => { clearTimeout(histTimer); histTimer = setTimeout(() => { state.history.page = 0; runHistorySearch(true); }, 300); });
  ['hist-period', 'hist-level'].forEach((id) => $(id).addEventListener('change', () => { state.history.page = 0; runHistorySearch(true); }));
  $('hist-fav').addEventListener('change', () => { state.history.page = 0; runHistorySearch(true); });
  $('hist-more').onclick = () => { state.history.page++; runHistorySearch(false); };
}
function historyQuery() {
  return {
    keyword: $('hist-search').value.trim(),
    period: $('hist-period').value,
    level: $('hist-level').value,
    favoriteOnly: $('hist-fav').checked,
    page: state.history.page
  };
}
async function runHistorySearch(reset) {
  try {
    const data = await Api.searchHistory(historyQuery());
    if (reset) state.history.items = [];
    state.history.items = state.history.items.concat(data.items);
    state.history.hasMore = data.hasMore;
    renderHistoryList();
  } catch (e) { handleError(e); }
}
function renderHistoryList() {
  const box = $('hist-list'); box.innerHTML = '';
  if (!state.history.items.length) { box.appendChild(el('p', 'muted small', '該当する履歴がありません')); }
  state.history.items.forEach((h) => {
    const item = el('div', 'list-item');
    const body = h.final_text || firstVariantText(h.variants_json) || h.input_text || '';
    item.innerHTML = '<div class="li-top"><span class="li-name">' + esc(h.candidate_name || '（指定なし）') + '</span><span class="li-badge">' + (h.type === 'reply' ? '返信' : '作成') + '</span></div>' +
      '<div class="li-sub">' + esc(h.created_at) + (String(h.favorite).toUpperCase() === 'TRUE' ? ' ★' : '') + '</div>' +
      '<div class="li-body">' + esc(body) + '</div>';
    item.onclick = () => openHistoryItem(h, body);
    box.appendChild(item);
  });
  $('hist-more').classList.toggle('hidden', !state.history.hasMore);
}
function firstVariantText(json) {
  try { const v = JSON.parse(json); return v && v[0] && v[0].messages ? v[0].messages.join('\n') : ''; } catch (e) { return ''; }
}
function openHistoryItem(h, body) {
  // 簡易アクション：コピー or これをもとに作る
  const choice = window.confirm('この文面をコピーしますか？\n（キャンセルで「これをもとに作る」）\n\n' + body);
  if (choice) { copyText(body).then((ok) => toast(ok ? 'コピーしました' : 'コピーできませんでした')); }
  else {
    $('create-input').value = h.input_text || body;
    Store.set(Store.DRAFT, { input: $('create-input').value });
    updateGenerateEnabled(); showTab('create');
  }
}

/* ============ S08 設定 ============ */
function bindSettings() {
  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.onclick = () => { document.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active')); b.classList.add('active'); };
  });
  $('set-save').onclick = saveSettings;
  $('set-logout').onclick = async () => { await Api.logout(); showLogin(); };
}
function applySettingsToForm() {
  const s = (state.data && state.data.settings) || {};
  $('set-signature').value = s.signature || '';
  $('set-style').value = s.style_rules || '';
  $('set-ng').value = s.ng_words || '';
  $('set-days').value = s.session_days || '30';
  const model = s.model === 'haiku' ? 'haiku' : 'sonnet';
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.model === model));
  if (state.data && state.data.spreadsheetUrl) $('set-open-sheet').href = state.data.spreadsheetUrl;
}
async function saveSettings() {
  const model = (document.querySelector('.seg-btn.active') || {}).dataset ? document.querySelector('.seg-btn.active').dataset.model : 'sonnet';
  const settings = {
    signature: $('set-signature').value,
    style_rules: $('set-style').value,
    ng_words: $('set-ng').value,
    model,
    session_days: $('set-days').value || '30'
  };
  try {
    const res = await Api.saveSettings({ settings });
    state.data.settings = res.settings; Store.set(Store.BOOTSTRAP, state.data);
    toast('設定を保存しました');
  } catch (e) { handleError(e); }
}

/* ============ フィルタ用セレクト ============ */
function fillHistoryLevelFilter() {
  $('hist-level').innerHTML = '<option value="">全レベル</option>' + levelList().map((lv) => '<option value="' + lv.level + '">Lv' + lv.level + ' ' + esc(lv.label || '') + '</option>').join('');
}
function fillSceneFilter() {
  const scenes = (state.data && state.data.scenes) || [];
  $('fav-scene-filter').innerHTML = '<option value="">すべてのシーン</option>' + scenes.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('');
  $('fav-scene-filter').onchange = () => renderFavList($('fav-scene-filter').value);
}

/* ============ モーダル・小物 ============ */
function bindModals() {
  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => closeModal(b.dataset.close); });
  document.querySelectorAll('.modal').forEach((m) => { m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }); });
}
function closeModal(id) { $(id).classList.add('hidden'); }
function closeOverlay(id) { $(id).classList.add('hidden'); }

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function nowStr() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

document.addEventListener('DOMContentLoaded', init);
