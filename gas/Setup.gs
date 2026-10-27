/**
 * Setup.gs
 * スプレッドシートのメニューからの初期設定。
 * シート作成・初期データ投入・APIキー/パスコード設定・接続テスト。
 */

/** スプレッドシートを開いたときにメニューを出す。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LINE文面アプリ')
    .addItem('初期設定（シート作成）', 'setupSheets')
    .addSeparator()
    .addItem('Claude APIキーを設定', 'setApiKey')
    .addItem('パスコードを設定', 'setPasscode')
    .addSeparator()
    .addItem('接続テスト', 'testConnection')
    .addToUi();
}

/**
 * 7シートを作成し、初期データを投入する。
 * 既存シートがあればスキップ（データは消さない）。全列を書式「書式なしテキスト(@)」にする。
 */
function setupSheets() {
  var ss = getSS_();
  var created = [];
  Object.keys(SHEET_DEFS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet) return; // 既にあればスキップ
    sheet = ss.insertSheet(name);
    var headers = SHEET_DEFS[name];
    // 全列を書式なしテキスト(@)にして自動変換を防ぐ
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    created.push(name);
  });

  // 初期データ投入（空のときだけ）
  seedScenesIfEmpty_();
  seedLevelsIfEmpty_();
  seedSettingsIfEmpty_();

  // 既定シート「シート1」が残っていて空なら消す
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) {
    ss.deleteSheet(def);
  }

  SpreadsheetApp.getUi().alert(
    created.length
      ? '初期設定が完了しました。\n作成したシート: ' + created.join(', ')
      : 'シートはすでに作成済みです。初期データを確認しました。'
  );
}

/** scenes が空なら初期データを入れる。 */
function seedScenesIfEmpty_() {
  if (readAll_('scenes').length > 0) return;
  SEED_SCENES.forEach(function (s, i) {
    appendRecord_('scenes', {
      id: nextId_('scenes'),
      phase: s.phase,
      name: s.name,
      hint: s.hint,
      guide: s.guide,
      order: String(i + 1),
      active: 'TRUE'
    });
  });
}

/** levels が空なら初期データを入れる。 */
function seedLevelsIfEmpty_() {
  if (readAll_('levels').length > 0) return;
  SEED_LEVELS.forEach(function (lv) {
    appendRecord_('levels', {
      level: lv.level,
      label: lv.label,
      rules: lv.rules,
      example: lv.example
    });
  });
}

/** settings が空なら初期値を入れる。 */
function seedSettingsIfEmpty_() {
  if (readAll_('settings').length > 0) return;
  writeSettings_(SEED_SETTINGS);
}

/** Claude APIキーを設定する。 */
function setApiKey() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Claude APIキーを設定', 'APIキー（sk-ant-...）を貼り付けてください。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var key = res.getResponseText().trim();
  if (!key) { ui.alert('入力が空でした。設定していません。'); return; }
  props_().setProperty(PROP_API_KEY, key);
  ui.alert('APIキーを保存しました。');
}

/** パスコードを設定する（8文字以上、salt付きハッシュで保存）。 */
function setPasscode() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('パスコードを設定', 'ログイン用パスコード（8文字以上）を入力してください。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var pass = res.getResponseText();
  if (!pass || pass.length < 8) { ui.alert('8文字以上で入力してください。設定していません。'); return; }
  var salt = Utilities.getUuid();
  var hash = sha256Hex_(salt + pass);
  var p = props_();
  p.setProperty(PROP_SALT, salt);
  p.setProperty(PROP_HASH, hash);
  // 失敗カウント・ロックも解除
  p.deleteProperty(PROP_FAIL_COUNT);
  p.deleteProperty(PROP_LOCK_UNTIL);
  ui.alert('パスコードを保存しました。');
}

/** Claude API に短い問い合わせをして疎通を確認する。 */
function testConnection() {
  var ui = SpreadsheetApp.getUi();
  try {
    var text = callClaude_('あなたはテスト応答を返すアシスタントです。', 'OKとだけ返してください。', 'haiku');
    ui.alert('接続成功。\nAIの応答: ' + (text || '(空)'));
  } catch (e) {
    ui.alert('接続に失敗しました。\n' + (e && e.message ? e.message : e));
  }
}
