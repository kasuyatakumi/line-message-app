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
