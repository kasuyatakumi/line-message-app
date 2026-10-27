'use strict';
/**
 * gas.test.js
 * GASロジックのテスト（Node標準の node:test / node:assert、追加インストール不要）。
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { createHarness, formatDate } = require('./harness');

/** 標準の初期データ（levels/scenes/settings）を入れたハーネスを作る。 */
function freshWithSeed(options) {
  const h = createHarness(options);
  h.initSheets();
  h.scriptProps.ANTHROPIC_API_KEY = 'sk-test';
  h.seed('levels', [
    { level: '1', label: 'とてもやさしく', rules: 'r1', example: '' },
    { level: '2', label: 'やさしく', rules: 'r2', example: '' },
    { level: '3', label: '標準', rules: 'r3', example: '' }
  ]);
  h.seed('scenes', [
    { id: 'SC01', phase: '初回接触', name: '初回のあいさつ', hint: 'h', guide: 'g', order: '1', active: 'TRUE' }
  ]);
  h.seed('settings', [
    { key: 'model', value: 'sonnet' },
    { key: 'session_days', value: '30' }
  ]);
  return h;
}

/** 正しい variants JSON を返す fetch モック。 */
function goodFetch() {
  const body = {
    content: [{ type: 'text', text: JSON.stringify({
      variants: [
        { label: '簡潔', messages: ['こんにちは'] },
        { label: '丁寧', messages: ['お世話になります', '詳細です'] },
        { label: '背中を押す', messages: ['ぜひ！'] }
      ]
    }) }]
  };
  return () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(body) });
}

// ---- ID採番 ----
test('nextId_: 空なら先頭ID、連番で採番し桁を揃える', () => {
  const h = freshWithSeed();
  assert.strictEqual(h.sandbox.nextId_('candidates'), 'C0001');
  assert.strictEqual(h.sandbox.nextId_('history'), 'H000001');
  h.seed('candidates', [{ id: 'C0001' }, { id: 'C0002' }]);
  assert.strictEqual(h.sandbox.nextId_('candidates'), 'C0003');
  h.seed('scenes', [{ id: 'SC09' }]);
  assert.strictEqual(h.sandbox.nextId_('scenes'), 'SC10');
});

// ---- トークン検証 ----
test('verifyToken_: 有効なら true を返し last_used_at を更新する', () => {
  const h = freshWithSeed();
  const future = formatDate(new Date(Date.now() + 86400000), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  h.seed('sessions', [{ token: 'tok-ok', created_at: '2020-01-01 00:00', expires_at: future, last_used_at: '2020-01-01 00:00', device: 'x' }]);
  assert.strictEqual(h.sandbox.verifyToken_('tok-ok'), true);
  const s = h.rows('sessions')[0];
  assert.notStrictEqual(s.last_used_at, '2020-01-01 00:00');
});

test('verifyToken_: 無いトークンは AUTH_REQUIRED', () => {
  const h = freshWithSeed();
  assert.throws(() => h.sandbox.verifyToken_('nope'), (e) => e.appCode === 'AUTH_REQUIRED');
});

test('verifyToken_: 期限切れは AUTH_REQUIRED', () => {
  const h = freshWithSeed();
  h.seed('sessions', [{ token: 'tok-old', created_at: '2020-01-01 00:00', expires_at: '2020-01-02 00:00', last_used_at: '2020-01-01 00:00', device: 'x' }]);
  assert.throws(() => h.sandbox.verifyToken_('tok-old'), (e) => e.appCode === 'AUTH_REQUIRED');
});

// ---- ログイン・ロック ----
test('login_: 正しいパスコードでトークン発行、失敗カウント解除', () => {
  const h = freshWithSeed();
  h.scriptProps.PASSCODE_SALT = 'salt';
  h.scriptProps.PASSCODE_HASH = crypto.createHash('sha256').update('saltpassword1', 'utf8').digest('hex');
  const res = h.sandbox.login_('password1', 'iPhone');
  assert.ok(res.token && res.token.length >= 32);
  assert.ok(res.expiresAt);
  assert.strictEqual(h.rows('sessions').length, 1);
});

test('login_: 5回失敗でロック（6回目は LOCKED）', () => {
  const h = freshWithSeed();
  h.scriptProps.PASSCODE_SALT = 'salt';
  h.scriptProps.PASSCODE_HASH = crypto.createHash('sha256').update('saltpassword1', 'utf8').digest('hex');
  for (let i = 0; i < 5; i++) {
    assert.throws(() => h.sandbox.login_('wrong', 'd'), (e) => e.appCode === 'AUTH_REQUIRED');
  }
  assert.throws(() => h.sandbox.login_('password1', 'd'), (e) => e.appCode === 'LOCKED');
});

// ---- generate 自動登録 ----
test('apiGenerate_: 新しい名前で求職者を自動登録し、履歴を1行追加', () => {
  const h = freshWithSeed(goodFetch());
  const out = h.sandbox.apiGenerate_({ type: 'create', newName: '山田太郎', level: '2', sceneId: 'SC01', inputText: '面接のリマインド' });
  assert.strictEqual(out.variants.length, 3);
  assert.ok(out.historyId.startsWith('H'));
  assert.ok(out.candidate, '自動登録された求職者が返る');
  assert.strictEqual(out.candidate.call_name, '山田太郎さん');
  assert.strictEqual(h.rows('candidates').length, 1);
  assert.strictEqual(h.rows('history').length, 1);
  assert.strictEqual(h.rows('history')[0].copied_at, '');
});

test('apiGenerate_: 同名は流用して重複登録しない', () => {
  const h = freshWithSeed(goodFetch());
  h.sandbox.apiGenerate_({ type: 'create', newName: '鈴木一郎', level: '2', inputText: 'あいさつ' });
  const out2 = h.sandbox.apiGenerate_({ type: 'create', newName: '鈴木一郎', level: '2', inputText: '再度' });
  assert.strictEqual(h.rows('candidates').length, 1, '同名は増えない');
  assert.strictEqual(out2.candidate, undefined, '既存流用時は candidate を返さない');
});

// ---- AI出力の検証と再生成 ----
test('generateVariants_: 1回目が崩れても2回目で成功する', () => {
  let n = 0;
  const h = freshWithSeed((url, opts, call) => {
    n = call;
    if (call === 1) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ type: 'text', text: 'ごめんなさい、JSONじゃない文章' }] }) };
    return goodFetch()();
  });
  const v = h.sandbox.generateVariants_('sys', 'user', 'sonnet');
  assert.strictEqual(v.length, 3);
  assert.strictEqual(h.fetchCalls, 2);
});

test('generateVariants_: 2回とも崩れたら AI_ERROR', () => {
  const h = freshWithSeed(() => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ type: 'text', text: '壊れた' }] }) }));
  assert.throws(() => h.sandbox.generateVariants_('s', 'u', 'sonnet'), (e) => e.appCode === 'AI_ERROR');
});

test('validateVariants_: 3件を超えたら切り捨て、空messagesは不正', () => {
  const h = freshWithSeed();
  const ok = h.sandbox.validateVariants_({ variants: [
    { label: 'a', messages: ['x'] }, { label: 'b', messages: ['y'] },
    { label: 'c', messages: ['z'] }, { label: 'd', messages: ['w'] }
  ] });
  assert.strictEqual(ok.length, 3);
  assert.strictEqual(h.sandbox.validateVariants_({ variants: [{ label: 'a', messages: [''] }] }), null);
  assert.strictEqual(h.sandbox.validateVariants_({ variants: [] }), null);
});

test('callClaude_: 429のとき1回だけ再試行して成功する', () => {
  const h = freshWithSeed((url, opts, call) => {
    if (call === 1) return { getResponseCode: () => 429, getContentText: () => 'busy' };
    return goodFetch()();
  });
  h.scriptProps.ANTHROPIC_API_KEY = 'sk-test';
  const text = h.sandbox.callClaude_('s', 'u', 'sonnet');
  assert.ok(text.indexOf('variants') >= 0);
  assert.strictEqual(h.fetchCalls, 2);
});

test('extractJson_: 前後に文章があっても最初の{から最後の}を取り出す', () => {
  const h = freshWithSeed();
  const obj = h.sandbox.extractJson_('説明\n{"variants":[{"label":"a","messages":["x"]}]}\nおわり');
  assert.ok(obj.variants);
});

// ---- searchHistory 絞り込み ----
test('apiSearchHistory_: キーワード・求職者・レベル・お気に入り・ページングで絞る', () => {
  const h = freshWithSeed();
  const nowS = formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  const histRows = [];
  for (let i = 1; i <= 25; i++) {
    histRows.push({
      id: 'H' + String(i).padStart(6, '0'),
      created_at: '2026-01-' + String(i).padStart(2, '0') + ' 10:00',
      type: 'create', candidate_id: 'C0001', candidate_name: '田中',
      level: '2', scene_id: 'SC01', input_text: 'テスト' + i,
      received_text: '', variants_json: '[]', final_text: '本文' + i,
      copied_at: '', revise_count: '0', favorite: i === 3 ? 'TRUE' : 'FALSE', model: 'sonnet'
    });
  }
  histRows.push({ id: 'H000099', created_at: nowS, type: 'create', candidate_id: 'C0002', candidate_name: '佐藤', level: '4', scene_id: 'SC01', input_text: '面接', received_text: '', variants_json: '[]', final_text: '特別な本文', copied_at: '', revise_count: '0', favorite: 'FALSE', model: 'sonnet' });
  h.seed('history', histRows);

  // キーワード
  const byKeyword = h.sandbox.apiSearchHistory_({ keyword: '特別な', period: 'all', page: 0 });
  assert.strictEqual(byKeyword.items.length, 1);
  assert.strictEqual(byKeyword.items[0].candidate_name, '佐藤');

  // 求職者絞り込み + ページング（C0001は25件 → 20件 + hasMore）
  const p0 = h.sandbox.apiSearchHistory_({ candidateId: 'C0001', period: 'all', page: 0 });
  assert.strictEqual(p0.items.length, 20);
  assert.strictEqual(p0.hasMore, true);
  const p1 = h.sandbox.apiSearchHistory_({ candidateId: 'C0001', period: 'all', page: 1 });
  assert.strictEqual(p1.items.length, 5);
  assert.strictEqual(p1.hasMore, false);

  // レベル
  assert.strictEqual(h.sandbox.apiSearchHistory_({ level: '4', period: 'all', page: 0 }).items.length, 1);

  // お気に入りのみ
  assert.strictEqual(h.sandbox.apiSearchHistory_({ favoriteOnly: true, period: 'all', page: 0 }).items.length, 1);

  // 新しい順（先頭が最新のH000099）
  assert.strictEqual(h.sandbox.apiSearchHistory_({ period: 'all', page: 0 }).items[0].id, 'H000099');
});

test('apiSearchHistory_: 期間7dは古いものを除外する', () => {
  const h = freshWithSeed();
  const nowS = formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  h.seed('history', [
    { id: 'H000001', created_at: '2000-01-01 00:00', candidate_name: '古い', final_text: '古', favorite: 'FALSE' },
    { id: 'H000002', created_at: nowS, candidate_name: '新しい', final_text: '新', favorite: 'FALSE' }
  ]);
  const r = h.sandbox.apiSearchHistory_({ period: '7d', page: 0 });
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].id, 'H000002');
});

// ---- markCopied ----
test('apiMarkCopied_: 履歴のfinal_text/copied_atと求職者の最終連絡日を更新', () => {
  const h = freshWithSeed();
  h.seed('candidates', [{ id: 'C0001', name: '田中', call_name: '田中さん', level: '2', status: '面談前', created_at: '2026-01-01 00:00', updated_at: '2026-01-01 00:00' }]);
  h.seed('history', [{ id: 'H000001', created_at: '2026-01-01 00:00', type: 'create', candidate_id: 'C0001', candidate_name: '田中', level: '2', scene_id: 'SC01', input_text: 'x', variants_json: '[]', final_text: '', copied_at: '', revise_count: '0', favorite: 'FALSE', model: 'sonnet' }]);
  h.sandbox.apiMarkCopied_({ historyId: 'H000001', finalText: '送った本文' });
  assert.strictEqual(h.rows('history')[0].final_text, '送った本文');
  assert.notStrictEqual(h.rows('history')[0].copied_at, '');
  assert.notStrictEqual(h.rows('candidates')[0].last_contact_at, '');
});

// ---- saveFavorite ----
test('apiSaveFavorite_: historyId指定で本文を引き継ぎ favorite=TRUE にする', () => {
  const h = freshWithSeed();
  h.seed('history', [{ id: 'H000001', created_at: '2026-01-01 00:00', candidate_name: '田中', level: '2', scene_id: 'SC01', variants_json: JSON.stringify([{ label: '簡潔', messages: ['やあ'] }]), final_text: '', favorite: 'FALSE' }]);
  const out = h.sandbox.apiSaveFavorite_({ historyId: 'H000001', title: 'テスト定型' });
  assert.ok(out.favorite.id.startsWith('F'));
  assert.strictEqual(out.favorite.body, 'やあ');
  assert.strictEqual(h.rows('history')[0].favorite, 'TRUE');
});

// ---- ルーティング（doPost） ----
test('doPost: login はトークン不要で成功レスポンス', () => {
  const h = freshWithSeed();
  h.scriptProps.PASSCODE_SALT = 'salt';
  h.scriptProps.PASSCODE_HASH = crypto.createHash('sha256').update('saltpassword1', 'utf8').digest('hex');
  const out = h.sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'login', data: { passcode: 'password1', device: 'd' } }) } });
  const res = JSON.parse(out.getContent());
  assert.strictEqual(res.ok, true);
  assert.ok(res.data.token);
});

test('doPost: token無しのbootstrapは AUTH_REQUIRED、未知actionは BAD_REQUEST', () => {
  const h = freshWithSeed();
  const noToken = JSON.parse(h.sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'bootstrap' }) } }).getContent());
  assert.strictEqual(noToken.ok, false);
  assert.strictEqual(noToken.error.code, 'AUTH_REQUIRED');

  const future = formatDate(new Date(Date.now() + 86400000), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  h.seed('sessions', [{ token: 't1', created_at: '2026-01-01 00:00', expires_at: future, last_used_at: '2026-01-01 00:00', device: 'd' }]);
  const unknown = JSON.parse(h.sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'nope', token: 't1' }) } }).getContent());
  assert.strictEqual(unknown.ok, false);
  assert.strictEqual(unknown.error.code, 'BAD_REQUEST');
});

test('doGet: 稼働確認で ok:true', () => {
  const h = freshWithSeed();
  assert.strictEqual(JSON.parse(h.sandbox.doGet().getContent()).ok, true);
});
