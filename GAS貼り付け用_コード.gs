/**
 * ★ Apps Script 貼り付け用（全部まとめ）★
 * このファイルの中身をすべてコピーして、Apps Scriptエディタの
 * 「コード.gs」（または Code.gs）に貼り付けてください。これ1つでOKです。
 * （元は gas/ 内の7ファイル。順番に結合したもの。中身は同じです）
 *
 * 貼り付けたら保存し、スプレッドシートを再読み込みすると
 * メニュー「LINE文面アプリ」が出ます。
 *
 * ※このファイルは自動生成です。コードを直すときは gas/ 側を編集し、
 *   tools/build-combined.sh で作り直してください。
 */


/* ===================== Sheets.gs ===================== */

/**
 * Sheets.gs
 * スプレッドシート読み書きの共通処理と、ID自動採番。
 * すべての .gs ファイルはグローバルスコープを共有する。
 */

// タイムゾーン・日時フォーマット（仕様: Asia/Tokyo, 'yyyy-MM-dd HH:mm'）
var TZ = 'Asia/Tokyo';
var DT_FORMAT = 'yyyy-MM-dd HH:mm';

// 7シートの名前と、1行目に入れる英字の列名（この順で保存・読み込みする）
var SHEET_DEFS = {
  candidates: ['id', 'name', 'call_name', 'level', 'age', 'experience', 'desired_job', 'status', 'memo', 'last_contact_at', 'created_at', 'updated_at'],
  history: ['id', 'created_at', 'type', 'candidate_id', 'candidate_name', 'level', 'scene_id', 'input_text', 'received_text', 'variants_json', 'final_text', 'copied_at', 'revise_count', 'favorite', 'model'],
  favorites: ['id', 'title', 'scene_id', 'level', 'body', 'use_count', 'created_at'],
  scenes: ['id', 'phase', 'name', 'hint', 'guide', 'order', 'active'],
  levels: ['level', 'label', 'rules', 'example'],
  settings: ['key', 'value'],
  sessions: ['token', 'created_at', 'expires_at', 'last_used_at', 'device']
};

// ID採番のルール（接頭辞と桁数）。該当列は全て 'id'。
var ID_RULES = {
  candidates: { prefix: 'C', width: 4 },   // C0001
  history: { prefix: 'H', width: 6 },      // H000001
  favorites: { prefix: 'F', width: 3 },    // F001
  scenes: { prefix: 'SC', width: 2 }       // SC01
};

/** 現在のスプレッドシート。 */
function getSS_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** 名前でシートを取得（無ければ null）。 */
function getSheet_(name) {
  return getSS_().getSheetByName(name);
}

/** 現在時刻を 'yyyy-MM-dd HH:mm' の文字列で返す。 */
function nowStr_() {
  return Utilities.formatDate(new Date(), TZ, DT_FORMAT);
}

/**
 * セルの値を文字列に正規化する。
 * 自動変換などで Date 型が来た場合も 'yyyy-MM-dd HH:mm' の文字列へ直す。
 */
function normalizeCell_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TZ, DT_FORMAT);
  }
  return String(v);
}

/**
 * シート全体を「列名をキーにしたオブジェクトの配列」で読み出す。
 * 1行目は列名。データが無ければ空配列。
 */
function readAll_(name) {
  var sheet = getSheet_(name);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    // 完全な空行は飛ばす
    var allEmpty = row.every(function (c) { return c === '' || c === null; });
    if (allEmpty) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = normalizeCell_(row[c]);
    }
    obj.__row = r + 1; // 実シート上の行番号（1始まり）
    rows.push(obj);
  }
  return rows;
}

/**
 * settings シート（key/value の2列）をオブジェクトとして読む。
 */
function readSettings_() {
  var rows = readAll_('settings');
  var out = {};
  rows.forEach(function (row) {
    if (row.key !== '') out[row.key] = row.value;
  });
  return out;
}

/**
 * settings シートに値を書き込む（既存キーは更新、無ければ追加）。
 * patch は { key: value, ... } のオブジェクト。
 */
function writeSettings_(patch) {
  var sheet = getSheet_('settings');
  var values = sheet.getDataRange().getValues();
  var keyRow = {}; // key -> 行番号(1始まり)
  for (var r = 1; r < values.length; r++) {
    var k = String(values[r][0]);
    if (k !== '') keyRow[k] = r + 1;
  }
  Object.keys(patch).forEach(function (key) {
    var val = patch[key] === null || patch[key] === undefined ? '' : String(patch[key]);
    if (keyRow[key]) {
      sheet.getRange(keyRow[key], 2).setValue(val);
    } else {
      sheet.appendRow([key, val]);
    }
  });
}

/**
 * 指定シートの次のIDを採番する（例: candidates → C0001）。
 * 既存IDの数字部分の最大値 + 1。
 * 重複防止のため、呼び出し側は LockService で排他すること。
 */
function nextId_(name) {
  var rule = ID_RULES[name];
  if (!rule) throw new Error('ID採番ルールが未定義: ' + name);
  var rows = readAll_(name);
  var max = 0;
  rows.forEach(function (row) {
    var id = String(row.id || '');
    if (id.indexOf(rule.prefix) === 0) {
      var num = parseInt(id.substring(rule.prefix.length), 10);
      if (!isNaN(num) && num > max) max = num;
    }
  });
  var next = max + 1;
  var digits = String(next);
  while (digits.length < rule.width) digits = '0' + digits;
  return rule.prefix + digits;
}

/**
 * オブジェクトを1行として追記する。列順は SHEET_DEFS に従う。
 * 返り値は書き込んだオブジェクト（列定義に沿って整形済み）。
 */
function appendRecord_(name, obj) {
  var sheet = getSheet_(name);
  var headers = SHEET_DEFS[name];
  var row = headers.map(function (h) {
    var v = obj[h];
    return v === null || v === undefined ? '' : String(v);
  });
  sheet.appendRow(row);
  var out = {};
  headers.forEach(function (h, i) { out[h] = row[i]; });
  return out;
}

/**
 * idField === idValue の行を探し、patch の各列を更新する。
 * 見つかった行オブジェクト（更新後）を返す。無ければ null。
 */
function updateRecord_(name, idField, idValue, patch) {
  var sheet = getSheet_(name);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;
  var headers = values[0].map(function (h) { return String(h); });
  var idCol = headers.indexOf(idField);
  if (idCol < 0) return null;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(idValue)) {
      Object.keys(patch).forEach(function (key) {
        var col = headers.indexOf(key);
        if (col >= 0) {
          var val = patch[key] === null || patch[key] === undefined ? '' : String(patch[key]);
          sheet.getRange(r + 1, col + 1).setValue(val);
          values[r][col] = val;
        }
      });
      var out = {};
      headers.forEach(function (h, i) { out[h] = normalizeCell_(values[r][i]); });
      return out;
    }
  }
  return null;
}

/**
 * idField === idValue の行を削除する。消せたら true。
 */
function deleteRecord_(name, idField, idValue) {
  var sheet = getSheet_(name);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return false;
  var headers = values[0].map(function (h) { return String(h); });
  var idCol = headers.indexOf(idField);
  if (idCol < 0) return false;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(idValue)) {
      sheet.deleteRow(r + 1);
      return true;
    }
  }
  return false;
}

/* ===================== SeedData.gs ===================== */

/**
 * SeedData.gs
 * scenes / levels / settings の初期データ。
 * 初期設定（setupSheets）のときだけ投入する。
 */

/** シーン初期データ（order は表示順）。 */
var SEED_SCENES = [
  // 初回接触
  { phase: '初回接触', name: '初回のあいさつ', hint: '自己紹介、連絡した経緯、お願いしたいこと', guide: '初めての連絡なので簡単に名乗る。警戒されないよう丁寧かつ前向きに。次の一歩（面談など）を提案して返信しやすくする。' },
  { phase: '初回接触', name: '面談日程の調整', hint: '候補日時、オンライン/対面、所要時間', guide: '候補日時を複数提示し、相手が選びやすい聞き方にする。所要時間や形式も明記する。' },
  { phase: '初回接触', name: '面談前日・当日のリマインド', hint: '日時、場所またはURL、持ち物', guide: '必ず日時・場所（またはURL）を入れる。前向きな一言で締める。' },
  // 面談後
  { phase: '面談後', name: '面談のお礼', hint: '面談で話した内容、次のステップ', guide: '時間をもらったお礼を述べ、次に何をするかを一言添える。' },
  { phase: '面談後', name: '求人の紹介', hint: '社名や職種、魅力、年収、勤務地', guide: '入力された求人情報だけを使う。魅力が伝わるように書き、興味を確認する聞き方で締める。不明な条件は作らない。' },
  { phase: '面談後', name: '応募の意思確認', hint: '対象の求人、応募期限', guide: '応募するかどうかを無理なく確認する。YES/NOや選択肢で返せる聞き方にする。' },
  { phase: '面談後', name: '書類（履歴書・職務経歴書）の提出依頼', hint: '必要書類、提出期限、提出方法', guide: '必要書類・期限・提出方法を明確にする。負担を減らす一言を添える。' },
  // 選考中
  { phase: '選考中', name: '書類選考の結果（通過）', hint: '次の選考、日程調整の有無', guide: '通過を前向きに伝え、次のステップを案内する。' },
  { phase: '選考中', name: '書類選考の結果（見送り）', hint: '次に提案したい求人があれば', guide: '相手を否定しない表現にする。残念な気持ちに配慮しつつ、次の提案につなげて前を向ける締めにする。' },
  { phase: '選考中', name: '面接日程の調整', hint: '候補日時、形式、場所またはURL', guide: '候補日時を複数提示し、形式・場所も明記する。' },
  { phase: '選考中', name: '面接前のリマインド・対策案内', hint: '日時、場所/URL、よく聞かれること', guide: '日時と場所を再確認し、簡単な準備のアドバイスで安心させる。' },
  { phase: '選考中', name: '面接後の感想ヒアリング', hint: '手応え、気になった点', guide: '面接の感想を気軽に聞く。answer しやすい聞き方にし、不安な点に寄り添う。' },
  // 結果
  { phase: '結果', name: '面接の結果（合格）', hint: '次のステップ、喜びの一言', guide: '合格を一緒に喜ぶ気持ちを伝え、次の案内につなげる。' },
  { phase: '結果', name: '面接の結果（不合格）', hint: '次に提案したい求人があれば', guide: '相手を否定しない。落ち込みに配慮し、次のチャンスにつなげる前向きな締めにする。' },
  { phase: '結果', name: '内定・条件の連絡', hint: '年収、入社日、回答期限など条件', guide: '入力された条件だけを正確に伝える。不明な条件は作らず【　】で空欄にする。' },
  { phase: '結果', name: '入社日の調整', hint: '候補の入社日、必要な準備', guide: '候補日を提示し、相手の都合を確認する。' },
  // フォロー
  { phase: 'フォロー', name: '辞退された方へのフォロー', hint: '今後の関係、次の機会', guide: '辞退を尊重し、責めない。今後も力になれることを伝え、縁をつなぐ。' },
  { phase: 'フォロー', name: '連絡が途絶えた方への掘り起こし', hint: '前回の内容、改めての提案', guide: 'しつこくならないよう軽い調子で再connectする。状況確認の聞き方にする。' },
  { phase: 'フォロー', name: '入社後のフォロー', hint: '入社からの経過、困りごと', guide: '入社後の様子を気遣う。相談しやすい雰囲気で締める。' },
  // その他
  { phase: 'その他', name: '自由入力', hint: '伝えたいことを自由に', guide: '入力内容に沿って、適切なLINE文面を作る。' }
];

/** レベル初期データ（rules に書き分けの指針を文章化）。 */
var SEED_LEVELS = [
  {
    level: '1', label: 'とてもやさしく',
    rules: '社会人経験ほぼなし、文章を読むのが苦手な方向け。1文は20字前後で1文1つのことだけ書く。話し言葉寄りの丁寧語で専門用語は使わない。絵文字は多め（2〜3個）。してほしいことを最初に書き、期限を明記する。1通3〜5行、長ければ2〜3通に分ける。選択肢やYES/NOで返せる聞き方にする。',
    example: ''
  },
  {
    level: '2', label: 'やさしく',
    rules: '若手・経験浅めの方向け（大半）。1文は30字前後。丁寧語で、専門用語は言い換える。絵文字は適度（1〜2個）。用件→お願い→期限の順。5行前後、必要なら分ける。選択肢を添えて返しやすくする。',
    example: ''
  },
  {
    level: '3', label: '標準',
    rules: '社会人経験数年の方向け。文の長さは普通。一般的な敬語。絵文字は少し（0〜1個）。用件→詳細→お願いの順。1〜2通。必要に応じて返しやすい聞き方にする。',
    example: ''
  },
  {
    level: '4', label: 'ビジネス',
    rules: '経験豊富な中堅層向け。やや長めの文も可。ビジネス敬語。絵文字は使わない。結論→詳細→提案の順。原則1通。相手の判断に委ねる書き方にする。',
    example: ''
  },
  {
    level: '5', label: 'ハイクラス',
    rules: '管理職・専門職・高年収層向け。簡潔で要点重視。格式あるビジネス敬語。絵文字は使わない。結論→根拠→提案の順。原則1通。相手の判断に委ねる書き方にする。',
    example: ''
  }
];

/** 設定の初期値。 */
var SEED_SETTINGS = {
  signature: '',
  style_rules: '',
  ng_words: '',
  model: 'haiku', // 速さ優先。品質を上げたいときは設定でsonnetに切り替え
  session_days: '30'
};

/* ===================== Auth.gs ===================== */

/**
 * Auth.gs
 * ログイン（パスコード照合）、トークンの発行・検証、ログイン失敗ロック。
 * パスコードは平文保存せず、SHA-256(salt + passcode) のハッシュで照合する。
 */

// スクリプトプロパティのキー
var PROP_API_KEY = 'ANTHROPIC_API_KEY';
var PROP_HASH = 'PASSCODE_HASH';
var PROP_SALT = 'PASSCODE_SALT';
var PROP_FAIL_COUNT = 'LOGIN_FAIL_COUNT';
var PROP_LOCK_UNTIL = 'LOGIN_LOCK_UNTIL';

var MAX_FAIL = 5;            // この回数連続で失敗するとロック
var LOCK_MINUTES = 10;       // ロック時間（分）
var TOKEN_CACHE_SEC = 300;   // トークン検証のキャッシュ秒数

/** スクリプトプロパティの取得ヘルパ。 */
function props_() {
  return PropertiesService.getScriptProperties();
}

/** 文字列を SHA-256 の16進文字列にする。 */
function sha256Hex_(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    var h = b.toString(16);
    if (h.length < 2) h = '0' + h;
    hex += h;
  }
  return hex;
}

/** ランダムなトークンを作る（UUID 2つ連結）。 */
function makeToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

/**
 * 現在ロック中かを確認する。ロック中なら LOCKED エラーを投げる。
 */
function checkNotLocked_() {
  var until = props_().getProperty(PROP_LOCK_UNTIL);
  if (until) {
    var untilMs = parseInt(until, 10);
    if (!isNaN(untilMs) && Date.now() < untilMs) {
      throw appError_('LOCKED', 'ログインが一時的にロックされています。しばらくしてからお試しください');
    }
  }
}

/** ログイン失敗を記録する。規定回数で一定時間ロックする。 */
function recordFail_() {
  var p = props_();
  var count = parseInt(p.getProperty(PROP_FAIL_COUNT) || '0', 10) + 1;
  p.setProperty(PROP_FAIL_COUNT, String(count));
  if (count >= MAX_FAIL) {
    var until = Date.now() + LOCK_MINUTES * 60 * 1000;
    p.setProperty(PROP_LOCK_UNTIL, String(until));
    p.setProperty(PROP_FAIL_COUNT, '0');
  }
}

/** ログイン成功時に失敗カウント・ロックを解除する。 */
function clearFail_() {
  var p = props_();
  p.deleteProperty(PROP_FAIL_COUNT);
  p.deleteProperty(PROP_LOCK_UNTIL);
}

/** session_days を settings から取得（既定30）。 */
function sessionDays_() {
  var s = readSettings_();
  var n = parseInt(s.session_days, 10);
  return isNaN(n) || n <= 0 ? 30 : n;
}

/** 'yyyy-MM-dd HH:mm' の文字列を Date に戻す（Asia/Tokyo前提の簡易パース）。 */
function parseDtStr_(str) {
  if (!str) return null;
  var m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  // タイムゾーン差を厳密に扱わず、比較用途に十分な精度でローカルDateを作る
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0);
}

/**
 * ログイン処理。
 * 成功で { token, expiresAt } を返す。失敗・ロック時はエラーを投げる。
 */
function login_(passcode, device) {
  checkNotLocked_();
  var p = props_();
  var hash = p.getProperty(PROP_HASH);
  var salt = p.getProperty(PROP_SALT);
  if (!hash || !salt) {
    throw appError_('SERVER_ERROR', 'パスコードが未設定です。スプレッドシートのメニューから設定してください');
  }
  var inputHash = sha256Hex_(salt + String(passcode || ''));
  if (inputHash !== hash) {
    recordFail_();
    throw appError_('AUTH_REQUIRED', 'パスコードが違います');
  }
  clearFail_();

  // トークン発行 → sessions に保存
  var token = makeToken_();
  var now = new Date();
  var expires = new Date(now.getTime() + sessionDays_() * 24 * 60 * 60 * 1000);
  var nowS = Utilities.formatDate(now, TZ, DT_FORMAT);
  var expS = Utilities.formatDate(expires, TZ, DT_FORMAT);
  appendRecord_('sessions', {
    token: token,
    created_at: nowS,
    expires_at: expS,
    last_used_at: nowS,
    device: device || ''
  });
  return { token: token, expiresAt: expS };
}

/**
 * トークンを検証する。有効なら last_used_at を更新する。
 * 無効・期限切れなら AUTH_REQUIRED を投げる。
 */
function verifyToken_(token) {
  if (!token) throw appError_('AUTH_REQUIRED', 'ログインが必要です');

  // 短時間キャッシュで高速化
  var cache = CacheService.getScriptCache();
  var cached = cache.get('tok_' + token);
  if (cached === 'ok') return true;

  var rows = readAll_('sessions');
  var found = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].token) === String(token)) { found = rows[i]; break; }
  }
  if (!found) throw appError_('AUTH_REQUIRED', 'ログインが必要です');

  var exp = parseDtStr_(found.expires_at);
  if (exp && Date.now() > exp.getTime()) {
    throw appError_('AUTH_REQUIRED', 'ログインの有効期限が切れました。もう一度ログインしてください');
  }

  updateRecord_('sessions', 'token', token, { last_used_at: nowStr_() });
  cache.put('tok_' + token, 'ok', TOKEN_CACHE_SEC);
  return true;
}

/** ログアウト（sessions から削除）。 */
function logout_(token) {
  if (!token) return;
  deleteRecord_('sessions', 'token', token);
  CacheService.getScriptCache().remove('tok_' + token);
}

/* ===================== Prompt.gs ===================== */

/**
 * Prompt.gs
 * Claude への指示書（system / user）の組み立て、API呼び出し、出力JSONの検証。
 */

var ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
var ANTHROPIC_VERSION = '2023-06-01';
var MODEL_MAP = {
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5'
};
var MAX_TOKENS = 1500;

/** model設定（'sonnet'|'haiku'）から実際のモデルIDを返す。既定は sonnet。 */
function resolveModel_(modelKey) {
  return MODEL_MAP[modelKey] || MODEL_MAP.sonnet;
}

/** 曜日の日本語1文字。 */
var WEEK_JP = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 今日から30日分の日付早見表を作る（例: 10/28（火））。
 * 先頭に現在日時も付ける。
 */
function dateTable_() {
  var now = new Date();
  var lines = [];
  lines.push('現在日時: ' + Utilities.formatDate(now, TZ, DT_FORMAT));
  for (var i = 0; i < 30; i++) {
    var d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    var md = (d.getMonth() + 1) + '/' + d.getDate();
    lines.push(md + '（' + WEEK_JP[d.getDay()] + '）');
  }
  return lines.join('\n');
}

/**
 * system プロンプトを組み立てる。
 * levelRow: levels の該当行 / sceneRow: scenes の該当行 / settings: 設定オブジェクト
 * type: 'create' | 'reply' | 'revise'
 */
function buildSystemPrompt_(levelRow, sceneRow, settings, type) {
  var isReply = (type === 'reply');
  var isRevise = (type === 'revise');
  var parts = [];

  // 1. 役割
  parts.push('あなたは、人材紹介エージェント「澤井」が求職者へ個人LINEで送る文面を、本人に代わって書くアシスタントです。澤井本人になりきり、下の文体で自然に書いてください。');

  // 2. 文体ルール
  parts.push([
    '【文体ルール】',
    '・明るく、丁寧で、少し腰が低い。相手への感謝と気づかいを欠かさない。',
    '・文末は「！」を基本に、あたたかく。ただし付けすぎて軽薄にならないよう1文に1つ程度。',
    '・よく使う言い回し:「お世話になっております！」「本日はありがとうございました！」「承知いたしました！」「とんでもございません！」「恐れ入りますが」「お手数をおかけいたしますが」「〜いただけますと幸いです！」「引き続きよろしくお願いいたします！」。',
    '・お願いごとは「恐れ入りますが、〜いただけますと幸いです！」の形でやわらかく頼む。',
    '・お詫び・恐縮はやや手厚く（例:「申し訳ございません。。。」）。ただし大げさすぎない。',
    '・絵文字は、下の【求職者レベル】の指定に従う（Lv1は多め、Lv2は適度、Lv3は少し、Lv4・Lv5は使わない）。使う場合も相手に合わせて自然な範囲にする。',
    '・相手を否定せず、常に前向きに背中を押す。',
    '・LINEなので見出し・箇条書き記号（・や■）・太字などの装飾は使わない。区切りや列挙は改行で行う（ただし企業から届いた案内文を引用する部分は、その原文の体裁をそのまま残す）。'
  ].join('\n'));

  // 3. あいさつと締め
  parts.push([
    '【あいさつと締め】',
    '・書き出しは原則「お世話になっております！」。初回の連絡や相手が名乗ってきた直後だけ「MISAWA GROUPの澤井です！」と名乗る（毎回は名乗らない）。',
    '・面談・面接・電話のあとは「本日は貴重なお時間をいただきありがとうございました！」から始めると自然。',
    '・締めは「引き続きよろしくお願いいたします！」など前向きな一言で終える。'
  ].join('\n'));

  // 4. 事実と引用の扱い（重要）
  parts.push([
    '【事実と引用の扱い】',
    '・入力に無い事実（日時・社名・金額・URL・会議ID・パスコードなど）は絶対に作らない。必要なのに不明なものは【日時】のように空欄で残す。',
    '・入力に企業から届いた案内文（面接案内・日程詳細・求人票・条件通知・提出物の案内・適性検査の案内など）が含まれる場合は、その本文を書き換え・要約・整形しない。原文のまま載せる。URL・会議ID・パスコード・日時・社名・フォームのリンク・区切り線は一字一句変えない。あなたの仕事は、その前後に澤井のあいさつ・ひとことの案内・締めを添えることだけ。',
    '・日付は「10/28（火）14:00」の形。曜日は必ず下の日付早見表から取る。',
    '・呼びかけは求職者の「呼び方」を使う。指定が無ければ「〇〇さん」。'
  ].join('\n'));

  // 5. レベルのルール（長さ・硬さの目安として使う）
  if (levelRow) {
    var lv = ['【求職者レベル】Lv' + levelRow.level + ' ' + (levelRow.label || '')];
    lv.push('※文の長さ・敬語の硬さ・絵文字の量・1通にまとめるか分けるかの目安。下の「目安」に従う。');
    if (levelRow.rules) lv.push('目安: ' + levelRow.rules);
    parts.push(lv.join('\n'));
  }

  // 6. シーンの説明
  if (sceneRow) {
    var sc = ['【今回のシーン】' + (sceneRow.name || '')];
    if (sceneRow.guide) sc.push('書き方の指針: ' + sceneRow.guide);
    parts.push(sc.join('\n'));
  }

  // 7. 返信時の追加指針
  if (isReply) {
    parts.push([
      '【返信を作るときの注意】',
      '・「届いたLINE」をよく読み、相手の質問・依頼にはすべて答える。',
      '・相手が不安そうな点、恐縮している点には一言寄り添う。',
      '・相手がお礼や報告をくれたら、まず受け止めて感謝し、必要なら次の一歩を案内する。'
    ].join('\n'));
  }

  // 8. ユーザー個別設定（あれば上書き）
  var cfg = [];
  if (settings && settings.signature) cfg.push('名乗り方・署名: ' + settings.signature);
  if (settings && settings.style_rules) cfg.push('追加の文体ルール: ' + settings.style_rules);
  if (settings && settings.ng_words) cfg.push('NG表現（使わない）: ' + settings.ng_words);
  if (cfg.length) parts.push('【ユーザー個別設定（あれば優先）】\n' + cfg.join('\n'));

  // 9. 日付早見表
  parts.push('【日付早見表】\n' + dateTable_());

  // 10. 出力形式（手直しのときは user 側で指定するので付けない）
  if (!isRevise) {
    if (isReply) {
      parts.push([
        '【出力形式】次のJSONだけを出力する。前後に説明文やコードブロック記号（```）を付けない。',
        '{"variants":[{"label":"標準","messages":["吹き出し1"]},{"label":"やわらかめ","messages":["吹き出し1","吹き出し2"]}]}',
        '・返信案は2案。1案目はそのまま使える標準の返し、2案目はより丁寧・やわらかめ。',
        '・messagesの1要素＝LINEの吹き出し1つ。短い返信は1要素でよい。'
      ].join('\n'));
    } else {
      parts.push([
        '【出力形式】次のJSONだけを出力する。前後に説明文やコードブロック記号（```）を付けない。',
        '{"variants":[{"label":"標準","messages":["吹き出し1","吹き出し2"]},{"label":"背中を押す","messages":["..."]}]}',
        '・2案を、性格を変えて作る（1案目は標準、2案目はより前向きに背中を押す）。',
        '・messagesの1要素＝LINEの吹き出し1つ。',
        '・Lv1〜2は必要に応じて2〜3要素に分ける。Lv4〜5は原則1要素。'
      ].join('\n'));
    }
  }

  return parts.join('\n\n');
}

/**
 * user プロンプトを組み立てる。
 * candidate: 求職者情報 / recent: 直近やり取り配列 / type: create|reply
 * inputText: ざっくり内容 / receivedText: 届いたLINE / direction: 返したい方向性
 */
function buildUserPrompt_(opts) {
  var lines = [];
  var c = opts.candidate || {};

  // 求職者情報は、入力があるものだけ載せる（無ければブロックごと省略）
  var info = [];
  if (c.name) info.push('名前: ' + c.name);
  if (c.call_name) info.push('呼び方: ' + c.call_name);
  if (c.experience) info.push('経験: ' + c.experience);
  if (c.desired_job) info.push('希望: ' + c.desired_job);
  if (c.status) info.push('選考状況: ' + c.status);
  if (c.memo) info.push('メモ: ' + c.memo);
  if (info.length) lines.push('【求職者情報】\n' + info.join('\n'));

  if (opts.recent && opts.recent.length) {
    var hist = ['【直近のやり取り（古い順）】'];
    opts.recent.forEach(function (h) {
      if (h.received_text) hist.push('相手から: ' + h.received_text);
      if (h.final_text) hist.push('自分が送った: ' + h.final_text);
    });
    lines.push(hist.join('\n'));
  }

  if (opts.type === 'reply') {
    lines.push('【届いたLINE】\n' + (opts.receivedText || ''));
    var dir = opts.inputText && opts.inputText.trim()
      ? '【返したい方向性】\n' + opts.inputText
      : '【返したい方向性】\n指定なし。適切な返し方を提案してください。';
    lines.push(dir);
  } else {
    lines.push('【今回送りたい内容（ざっくり）】\n' + (opts.inputText || ''));
  }

  return lines.join('\n\n');
}

/**
 * 手直し用の user プロンプト。
 */
function buildRevisePrompt_(currentMessages, instruction, levelRow, sceneRow) {
  var lines = [];
  lines.push('次の文面を、指示に従って直してください。指示されていない部分は変えないでください。');
  lines.push('【今の文面（吹き出しごと）】\n' + JSON.stringify(currentMessages));
  lines.push('【修正指示】\n' + instruction);
  if (levelRow && levelRow.rules) lines.push('【元のレベルのルール】\n' + levelRow.rules);
  if (sceneRow && sceneRow.guide) lines.push('【元のシーンの指針】\n' + sceneRow.guide);
  lines.push('【出力形式】次のJSONだけを出力する。前後に説明文を付けない。\n{"variant":{"label":"...","messages":["..."]}}');
  return lines.join('\n\n');
}

/**
 * Claude API を1回呼ぶ。応答テキスト（本文）を返す。
 * 混雑（429/5xx/529）のときは1回だけ1.5秒待って再試行する。
 */
function callClaude_(systemText, userText, modelKey) {
  var apiKey = props_().getProperty(PROP_API_KEY);
  if (!apiKey) throw appError_('SERVER_ERROR', 'APIキーが未設定です。スプレッドシートのメニューから設定してください');

  var payload = {
    model: resolveModel_(modelKey),
    max_tokens: MAX_TOKENS,
    system: systemText,
    messages: [{ role: 'user', content: userText }]
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var attempts = 0;
  while (true) {
    attempts++;
    var res = UrlFetchApp.fetch(ANTHROPIC_URL, options);
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code >= 200 && code < 300) {
      var body = JSON.parse(text);
      // content は配列。text タイプを連結する
      var out = '';
      if (body && body.content) {
        body.content.forEach(function (b) { if (b.type === 'text') out += b.text; });
      }
      return out;
    }
    var busy = (code === 429 || code === 529 || (code >= 500 && code < 600));
    if (busy && attempts < 2) {
      Utilities.sleep(1500);
      continue;
    }
    throw appError_('AI_ERROR', 'AIの呼び出しに失敗しました（しばらくして再度お試しください）');
  }
}

/**
 * 応答テキストから最初の { 〜 最後の } を取り出して JSON.parse する。
 * 失敗したら null。
 */
function extractJson_(text) {
  if (!text) return null;
  var start = text.indexOf('{');
  var end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  var slice = text.substring(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    return null;
  }
}

/** messages が「空でない文字列の配列」かを判定。 */
function isValidMessages_(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return messages.every(function (m) {
    return typeof m === 'string' && m.trim() !== '';
  });
}

/**
 * variants を検証して整える。妥当でなければ null を返す。
 * - variants が1件以上
 * - 各 messages が空でない文字列配列
 * - 3件を超える分は切り捨て
 */
function validateVariants_(obj) {
  if (!obj || !Array.isArray(obj.variants) || obj.variants.length === 0) return null;
  var out = [];
  for (var i = 0; i < obj.variants.length && out.length < 3; i++) {
    var v = obj.variants[i];
    if (!v || !isValidMessages_(v.messages)) return null;
    out.push({
      label: typeof v.label === 'string' && v.label ? v.label : '案' + (out.length + 1),
      messages: v.messages.map(function (m) { return String(m); })
    });
  }
  if (out.length === 0) return null;
  return out;
}

/**
 * 1案（variant）を検証して整える。妥当でなければ null。
 */
function validateVariant_(obj) {
  if (!obj || !obj.variant || !isValidMessages_(obj.variant.messages)) return null;
  return {
    label: typeof obj.variant.label === 'string' && obj.variant.label ? obj.variant.label : '案',
    messages: obj.variant.messages.map(function (m) { return String(m); })
  };
}

/**
 * 3案を生成する。出力が崩れていたら1回だけ再生成する。
 * 返り値: variants 配列（検証済み）。
 */
function generateVariants_(systemText, userText, modelKey) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var text = callClaude_(systemText, userText, modelKey);
    var parsed = extractJson_(text);
    var variants = validateVariants_(parsed);
    if (variants) return variants;
  }
  throw appError_('AI_ERROR', 'AIの出力の形が崩れていました。もう一度お試しください');
}

/**
 * 手直しの1案を生成する。崩れていたら1回だけ再生成。
 */
function reviseVariant_(systemText, userText, modelKey) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var text = callClaude_(systemText, userText, modelKey);
    var parsed = extractJson_(text);
    var variant = validateVariant_(parsed);
    if (variant) return variant;
  }
  throw appError_('AI_ERROR', 'AIの出力の形が崩れていました。もう一度お試しください');
}

/* ===================== Api.gs ===================== */

/**
 * Api.gs
 * 各 action の本体。Main.gs の doPost から呼ばれる。
 * 書き込み系は Main.gs 側で LockService により排他される。
 */

/** levels から level に一致する行を返す（文字列化して比較）。 */
function findLevelRow_(level) {
  var rows = readAll_('levels');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].level) === String(level)) return rows[i];
  }
  return null;
}

/** scenes から id に一致する行を返す。 */
function findSceneRow_(sceneId) {
  if (!sceneId) return null;
  var rows = readAll_('scenes');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(sceneId)) return rows[i];
  }
  return null;
}

/** candidates から id に一致する行を返す。 */
function findCandidateById_(id) {
  if (!id) return null;
  var rows = readAll_('candidates');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(id)) return rows[i];
  }
  return null;
}

/** 同名の求職者を返す（name 完全一致）。 */
function findCandidateByName_(name) {
  if (!name) return null;
  var rows = readAll_('candidates');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].name) === String(name)) return rows[i];
  }
  return null;
}

/** 呼び方の既定値を作る（姓＋さん。スペース区切りの先頭）。 */
function defaultCallName_(name) {
  var n = String(name || '').trim();
  if (!n) return '';
  var head = n.split(/\s+/)[0];
  return (head || n) + 'さん';
}

/**
 * 新しい求職者を登録する（同名がいれば流用）。
 * 返り値: 求職者行オブジェクト。
 */
function registerCandidate_(name, level) {
  var existing = findCandidateByName_(name);
  if (existing) return existing;
  var now = nowStr_();
  var id = nextId_('candidates');
  var rec = {
    id: id,
    name: name,
    call_name: defaultCallName_(name),
    level: level || '2',
    age: '',
    experience: '',
    desired_job: '',
    status: '面談前',
    memo: '',
    last_contact_at: '',
    created_at: now,
    updated_at: now
  };
  appendRecord_('candidates', rec);
  return rec;
}

/** その求職者の直近 n 件のやり取りを古い順で返す。 */
function recentHistoryFor_(candidateId, n) {
  if (!candidateId) return [];
  var rows = readAll_('history').filter(function (h) {
    return String(h.candidate_id) === String(candidateId);
  });
  rows.sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? -1 : 1; });
  return rows.slice(Math.max(0, rows.length - n));
}

/** bootstrap: 起動時にまとめて返す。 */
function apiBootstrap_() {
  var history = readAll_('history');
  history.sort(function (a, b) { return String(a.created_at) > String(b.created_at) ? -1 : 1; });
  return {
    candidates: readAll_('candidates'),
    scenes: readAll_('scenes'),
    levels: readAll_('levels'),
    favorites: readAll_('favorites'),
    settings: readSettings_(),
    recentHistory: history.slice(0, 50),
    spreadsheetUrl: getSS_().getUrl()
  };
}

/**
 * generate: 文面を3案生成する。
 * 処理順: 新規名があれば登録 → 指示書組み立て → Claude → 検証/再生成 → history追記 → 3案を返す。
 */
function apiGenerate_(data) {
  var type = data.type === 'reply' ? 'reply' : 'create';
  if (!data.inputText && type === 'create') {
    throw appError_('BAD_REQUEST', '送りたい内容を入力してください');
  }
  if (type === 'reply' && !data.receivedText) {
    throw appError_('BAD_REQUEST', '届いたLINEを貼り付けてください');
  }

  var settings = readSettings_();
  var modelKey = settings.model || 'haiku';

  // 求職者機能は廃止。レベル＋シーン＋入力内容だけで生成する。
  var level = data.level || '2';
  var levelRow = findLevelRow_(level);
  var sceneRow = findSceneRow_(data.sceneId);

  var systemText = buildSystemPrompt_(levelRow, sceneRow, settings, type);
  var userText = buildUserPrompt_({
    type: type,
    candidate: { name: '', call_name: '' },
    recent: [],
    inputText: data.inputText || '',
    receivedText: data.receivedText || ''
  });

  var variants = generateVariants_(systemText, userText, modelKey);

  // history に1行追加（copied_at は空。求職者には紐づけない）
  var historyId = nextId_('history');
  appendRecord_('history', {
    id: historyId,
    created_at: nowStr_(),
    type: type,
    candidate_id: '',
    candidate_name: '',
    level: level,
    scene_id: data.sceneId || '',
    input_text: data.inputText || '',
    received_text: data.receivedText || '',
    variants_json: JSON.stringify(variants),
    final_text: '',
    copied_at: '',
    revise_count: '0',
    favorite: 'FALSE',
    model: modelKey
  });

  return { historyId: historyId, variants: variants };
}

/**
 * revise: 選んだ案を指示に従って手直しする（1案返す）。
 */
function apiRevise_(data) {
  if (!data.historyId) throw appError_('BAD_REQUEST', '対象が指定されていません');
  if (!data.instruction) throw appError_('BAD_REQUEST', '手直しの指示を入力してください');
  if (!Array.isArray(data.currentMessages)) throw appError_('BAD_REQUEST', '手直し対象の文面がありません');

  var settings = readSettings_();
  var modelKey = settings.model || 'haiku';

  // history 行から level / scene を引く
  var hrows = readAll_('history');
  var hrow = null;
  for (var i = 0; i < hrows.length; i++) {
    if (String(hrows[i].id) === String(data.historyId)) { hrow = hrows[i]; break; }
  }
  var levelRow = hrow ? findLevelRow_(hrow.level) : null;
  var sceneRow = hrow ? findSceneRow_(hrow.scene_id) : null;

  var systemText = buildSystemPrompt_(levelRow, sceneRow, settings, 'revise');
  var userText = buildRevisePrompt_(data.currentMessages, data.instruction, levelRow, sceneRow);
  var variant = reviseVariant_(systemText, userText, modelKey);

  // revise_count を +1
  if (hrow) {
    var cnt = parseInt(hrow.revise_count || '0', 10) + 1;
    updateRecord_('history', 'id', data.historyId, { revise_count: String(cnt) });
  }
  return { variant: variant };
}

/**
 * markCopied: コピーした本文と時刻を記録。求職者の最終連絡日も更新。
 */
function apiMarkCopied_(data) {
  if (!data.historyId) throw appError_('BAD_REQUEST', '対象が指定されていません');
  var now = nowStr_();
  var updated = updateRecord_('history', 'id', data.historyId, {
    final_text: data.finalText || '',
    copied_at: now
  });
  if (updated && updated.candidate_id) {
    updateRecord_('candidates', 'id', updated.candidate_id, {
      last_contact_at: now,
      updated_at: now
    });
  }
  return {};
}

/**
 * searchHistory: 履歴を絞り込み・新しい順で20件ずつ返す。
 */
function apiSearchHistory_(data) {
  var rows = readAll_('history');
  var keyword = (data.keyword || '').trim();
  var period = data.period || 'all';
  var page = parseInt(data.page, 10);
  if (isNaN(page) || page < 0) page = 0;
  var pageSize = 20;

  // 期間しきい値
  var thresholdMs = null;
  var nowMs = Date.now();
  if (period === 'today') {
    var d = new Date(); d.setHours(0, 0, 0, 0); thresholdMs = d.getTime();
  } else if (period === '7d') {
    thresholdMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  } else if (period === '30d') {
    thresholdMs = nowMs - 30 * 24 * 60 * 60 * 1000;
  }

  var filtered = rows.filter(function (h) {
    if (data.candidateId && String(h.candidate_id) !== String(data.candidateId)) return false;
    if (data.sceneId && String(h.scene_id) !== String(data.sceneId)) return false;
    if (data.level && String(h.level) !== String(data.level)) return false;
    if (data.favoriteOnly && String(h.favorite).toUpperCase() !== 'TRUE') return false;
    if (thresholdMs !== null) {
      var created = parseDtStr_(h.created_at);
      if (!created || created.getTime() < thresholdMs) return false;
    }
    if (keyword) {
      var hay = [h.final_text, h.input_text, h.received_text, h.candidate_name].join('\n');
      if (hay.indexOf(keyword) < 0) return false;
    }
    return true;
  });

  filtered.sort(function (a, b) { return String(a.created_at) > String(b.created_at) ? -1 : 1; });

  var startIdx = page * pageSize;
  var items = filtered.slice(startIdx, startIdx + pageSize);
  var hasMore = filtered.length > startIdx + pageSize;
  return { items: items, hasMore: hasMore };
}

/**
 * saveCandidate: 求職者を保存（id無し=新規）。
 */
function apiSaveCandidate_(data) {
  if (!data.name) throw appError_('BAD_REQUEST', '名前を入力してください');
  var now = nowStr_();
  var callName = data.call_name && data.call_name.trim() ? data.call_name : defaultCallName_(data.name);
  var level = data.level || '2';

  if (data.id) {
    var patch = {
      name: data.name,
      call_name: callName,
      level: level,
      age: data.age || '',
      experience: data.experience || '',
      desired_job: data.desired_job || '',
      status: data.status || '',
      memo: data.memo || '',
      updated_at: now
    };
    var updated = updateRecord_('candidates', 'id', data.id, patch);
    if (!updated) throw appError_('BAD_REQUEST', '対象の求職者が見つかりません');
    return { candidate: updated };
  }

  var id = nextId_('candidates');
  var rec = {
    id: id,
    name: data.name,
    call_name: callName,
    level: level,
    age: data.age || '',
    experience: data.experience || '',
    desired_job: data.desired_job || '',
    status: data.status || '面談前',
    memo: data.memo || '',
    last_contact_at: '',
    created_at: now,
    updated_at: now
  };
  appendRecord_('candidates', rec);
  return { candidate: rec };
}

/**
 * saveFavorite: お気に入り（定型文）を保存。
 * historyId 指定時は、その履歴の本文から作り、history.favorite=TRUE にする。
 */
function apiSaveFavorite_(data) {
  var now = nowStr_();
  var title = data.title || '';
  var sceneId = data.sceneId || '';
  var level = data.level || '';
  var body = data.body || '';

  if (data.historyId) {
    var hrows = readAll_('history');
    for (var i = 0; i < hrows.length; i++) {
      if (String(hrows[i].id) === String(data.historyId)) {
        var h = hrows[i];
        if (!body) {
          // final_text が無ければ1案目を使う
          body = h.final_text;
          if (!body && h.variants_json) {
            try {
              var vs = JSON.parse(h.variants_json);
              if (vs && vs[0] && vs[0].messages) body = vs[0].messages.join('\n');
            } catch (e) {}
          }
        }
        if (!sceneId) sceneId = h.scene_id;
        if (!level) level = h.level;
        if (!title) title = (h.candidate_name || '') + ' ' + (h.scene_id || '');
        break;
      }
    }
    updateRecord_('history', 'id', data.historyId, { favorite: 'TRUE' });
  }

  if (!body) throw appError_('BAD_REQUEST', '定型文の本文がありません');

  var id = nextId_('favorites');
  var rec = {
    id: id,
    title: title || '定型文',
    scene_id: sceneId,
    level: level,
    body: body,
    use_count: '0',
    created_at: now
  };
  appendRecord_('favorites', rec);
  return { favorite: rec };
}

/** deleteFavorite: お気に入り削除。 */
function apiDeleteFavorite_(data) {
  if (!data.id) throw appError_('BAD_REQUEST', '対象が指定されていません');
  deleteRecord_('favorites', 'id', data.id);
  return {};
}

/**
 * saveSettings: 設定とシーンを保存。
 * settings: key/value オブジェクト / scenes: シーン行の配列（表示・並び替え・追加）
 */
function apiSaveSettings_(data) {
  if (data.settings) {
    var allow = ['signature', 'style_rules', 'ng_words', 'model', 'session_days'];
    var patch = {};
    allow.forEach(function (k) {
      if (data.settings[k] !== undefined) patch[k] = data.settings[k];
    });
    if (Object.keys(patch).length) writeSettings_(patch);
  }

  if (Array.isArray(data.scenes)) {
    var sheet = getSheet_('scenes');
    // 全消し→書き直し（ヘッダは残す）
    var last = sheet.getLastRow();
    if (last > 1) sheet.deleteRows(2, last - 1);
    data.scenes.forEach(function (s) {
      var id = s.id || nextId_('scenes');
      appendRecord_('scenes', {
        id: id,
        phase: s.phase || '',
        name: s.name || '',
        hint: s.hint || '',
        guide: s.guide || '',
        order: s.order !== undefined ? s.order : '',
        active: s.active === false ? 'FALSE' : 'TRUE'
      });
    });
  }

  return { settings: readSettings_(), scenes: readAll_('scenes') };
}

/* ===================== Main.gs ===================== */

/**
 * Main.gs
 * doPost（全APIの入口）と doGet（稼働確認）、ルーティング、レスポンス整形。
 */

// 書き込みを伴う action（LockService で排他する）
var WRITE_ACTIONS = {
  login: true, logout: true, generate: true, revise: true, markCopied: true,
  saveCandidate: true, saveFavorite: true, deleteFavorite: true, saveSettings: true
};

// トークン不要の action
var PUBLIC_ACTIONS = { login: true };

/** 画面に出すエラーを作る（code と日本語メッセージ）。 */
function appError_(code, message) {
  var e = new Error(message);
  e.appCode = code;
  return e;
}

/** 成功レスポンスJSON文字列。 */
function okJson_(data) {
  return JSON.stringify({ ok: true, data: data || {} });
}

/** 失敗レスポンスJSON文字列。 */
function errJson_(code, message) {
  return JSON.stringify({ ok: false, error: { code: code || 'SERVER_ERROR', message: message || 'エラーが発生しました' } });
}

/** ContentService で JSON を返す。 */
function jsonOutput_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/** 稼働確認用。 */
function doGet() {
  return jsonOutput_(JSON.stringify({ ok: true }));
}

/** action を本体関数に振り分ける。 */
function dispatch_(action, token, data) {
  switch (action) {
    case 'login': return login_(data.passcode, data.device);
    case 'logout': logout_(token); return {};
    case 'bootstrap': return apiBootstrap_();
    case 'generate': return apiGenerate_(data);
    case 'revise': return apiRevise_(data);
    case 'markCopied': return apiMarkCopied_(data);
    case 'searchHistory': return apiSearchHistory_(data);
    case 'saveCandidate': return apiSaveCandidate_(data);
    case 'saveFavorite': return apiSaveFavorite_(data);
    case 'deleteFavorite': return apiDeleteFavorite_(data);
    case 'saveSettings': return apiSaveSettings_(data);
    default: throw appError_('BAD_REQUEST', '不明な操作です');
  }
}

/**
 * 全APIの入口。
 * 受け取り: { action, token, data }（Content-Type: text/plain でJSON文字列）
 */
function doPost(e) {
  var action = '';
  try {
    var req = {};
    if (e && e.postData && e.postData.contents) {
      req = JSON.parse(e.postData.contents);
    }
    action = req.action || '';
    var token = req.token || '';
    var data = req.data || {};

    if (!action) throw appError_('BAD_REQUEST', '操作が指定されていません');

    // login 以外はトークン必須
    if (!PUBLIC_ACTIONS[action]) {
      verifyToken_(token);
    }

    var result;
    if (WRITE_ACTIONS[action]) {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        result = dispatch_(action, token, data);
      } finally {
        lock.releaseLock();
      }
    } else {
      result = dispatch_(action, token, data);
    }

    return jsonOutput_(okJson_(result));
  } catch (err) {
    var code = err && err.appCode ? err.appCode : 'SERVER_ERROR';
    var msg = err && err.message ? err.message : 'エラーが発生しました';
    // 秘密情報を出さないよう、詳細はログのみ
    try { console.error('doPost error [' + action + ']: ' + (err && err.stack ? err.stack : msg)); } catch (ignore) {}
    if (code === 'SERVER_ERROR') msg = 'エラーが発生しました。もう一度お試しください';
    return jsonOutput_(errJson_(code, msg));
  }
}

/* ===================== Setup.gs ===================== */

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
