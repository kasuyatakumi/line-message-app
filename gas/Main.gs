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
