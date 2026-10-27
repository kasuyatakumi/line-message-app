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
