'use strict';
/**
 * harness.js
 * GASの .gs ファイルを Node 上で読み込んで検証するための「土台」。
 * SpreadsheetApp / UrlFetchApp / PropertiesService / CacheService /
 * LockService / Utilities / ContentService をメモリ上のモックに差し替える。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const GAS_DIR = path.join(__dirname, '..', 'gas');
// 読み込む順番（定数を先に）
const GAS_FILES = ['Sheets.gs', 'SeedData.gs', 'Auth.gs', 'Prompt.gs', 'Api.gs', 'Main.gs', 'Setup.gs'];

/** 2次元配列を持つシートのモック。行・列は1始まりでアクセスする。 */
class MockSheet {
  constructor(name) {
    this.name = name;
    this.data = []; // data[r][c]（0始まり）
    this.frozenRows = 0;
  }
  _ensure(rows, cols) {
    while (this.data.length < rows) this.data.push([]);
    for (const row of this.data) while (row.length < cols) row.push('');
  }
  getMaxRows() { return Math.max(this.data.length, 1000); }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  setFrozenRows(n) { this.frozenRows = n; }
  appendRow(arr) { this.data.push(arr.slice()); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  deleteRows(r, count) { this.data.splice(r - 1, count); }
  getDataRange() { return this.getRange(1, 1, Math.max(this.data.length, 1), Math.max(this.getLastColumn(), 1)); }
  getRange(row, col, numRows, numCols) {
    const sheet = this;
    numRows = numRows || 1;
    numCols = numCols || 1;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) {
            const rr = sheet.data[row - 1 + r];
            line.push(rr && rr[col - 1 + c] !== undefined ? rr[col - 1 + c] : '');
          }
          out.push(line);
        }
        return out;
      },
      setValue(v) {
        sheet._ensure(row, col);
        sheet.data[row - 1][col - 1] = v;
        return this;
      },
      setValues(vals) {
        sheet._ensure(row - 1 + vals.length, col - 1 + (vals[0] ? vals[0].length : 0));
        for (let r = 0; r < vals.length; r++) {
          for (let c = 0; c < vals[r].length; c++) {
            sheet.data[row - 1 + r][col - 1 + c] = vals[r][c];
          }
        }
        return this;
      },
      setNumberFormat() { return this; },
      setFontWeight() { return this; }
    };
  }
}

/** Utilities.formatDate 相当（'yyyy-MM-dd HH:mm' などに対応）。 */
function formatDate(date, tz, fmt) {
  const p = (n) => String(n).padStart(2, '0');
  return fmt
    .replace('yyyy', date.getFullYear())
    .replace('MM', p(date.getMonth() + 1))
    .replace('dd', p(date.getDate()))
    .replace('HH', p(date.getHours()))
    .replace('mm', p(date.getMinutes()));
}

/**
 * ハーネスを作る。返り値の sandbox から GAS のグローバル関数を呼べる。
 * options.fetch: UrlFetchApp.fetch の挙動を差し替える関数（url, options)=>response
 */
function createHarness(options = {}) {
  // 関数で渡された場合は fetch モックとして扱う
  if (typeof options === 'function') options = { fetch: options };
  options = options || {};
  const sheets = {}; // name -> MockSheet
  let ssUrl = 'https://docs.google.com/spreadsheets/d/MOCK/edit';

  const spreadsheet = {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => { sheets[name] = new MockSheet(name); return sheets[name]; },
    getSheets: () => Object.values(sheets),
    deleteSheet: (sheet) => { delete sheets[sheet.name]; },
    getUrl: () => ssUrl
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => spreadsheet,
    getUi: () => ({
      createMenu: () => { const m = { addItem: () => m, addSeparator: () => m, addToUi: () => m }; return m; },
      alert: () => {},
      prompt: () => ({ getSelectedButton: () => 'CANCEL', getResponseText: () => '' }),
      Button: { OK: 'OK', CANCEL: 'CANCEL' },
      ButtonSet: { OK_CANCEL: 'OK_CANCEL' }
    })
  };

  const scriptProps = {};
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in scriptProps ? scriptProps[k] : null),
      setProperty: (k, v) => { scriptProps[k] = String(v); },
      deleteProperty: (k) => { delete scriptProps[k]; }
    })
  };

  const cacheStore = {};
  const CacheService = {
    getScriptCache: () => ({
      get: (k) => (k in cacheStore ? cacheStore[k] : null),
      put: (k, v) => { cacheStore[k] = v; },
      remove: (k) => { delete cacheStore[k]; }
    })
  };

  const LockService = {
    getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {}, tryLock: () => true })
  };

  let fetchCalls = 0;
  const defaultFetch = () => ({ getResponseCode: () => 200, getContentText: () => '{}' });
  const UrlFetchApp = {
    fetch: (url, opts) => {
      fetchCalls++;
      const fn = options.fetch || defaultFetch;
      return fn(url, opts, fetchCalls);
    }
  };

  const Utilities = {
    formatDate,
    getUuid: () => crypto.randomUUID(),
    sleep: () => {},
    computeDigest: (algo, str) => {
      const buf = crypto.createHash('sha256').update(String(str), 'utf8').digest();
      return Array.from(buf); // 0..255 の配列
    },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' }
  };

  const ContentService = {
    createTextOutput: (text) => ({ _text: text, setMimeType() { return this; }, getContent() { return this._text; } }),
    MimeType: { JSON: 'application/json' }
  };

  const sandbox = {
    SpreadsheetApp, PropertiesService, CacheService, LockService,
    UrlFetchApp, Utilities, ContentService,
    console, Logger: { log: () => {} },
    JSON, Date, Math, String, Number, Array, Object, parseInt, parseFloat, isNaN, RegExp, Error
  };
  vm.createContext(sandbox);

  for (const f of GAS_FILES) {
    const src = fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
    vm.runInContext(src, sandbox, { filename: f });
  }

  // 補助: 列定義どおりにヘッダ付きシートを作る
  function initSheets() {
    const defs = sandbox.SHEET_DEFS;
    Object.keys(defs).forEach((name) => {
      const sheet = new MockSheet(name);
      sheet.appendRow(defs[name].slice());
      sheets[name] = sheet;
    });
  }

  // 補助: オブジェクト配列をそのシートに追記（列定義順）
  function seed(name, rows) {
    const defs = sandbox.SHEET_DEFS[name];
    rows.forEach((obj) => {
      sheets[name].appendRow(defs.map((h) => (obj[h] === undefined || obj[h] === null ? '' : String(obj[h]))));
    });
  }

  // 補助: 生データ（ヘッダ除く）を取り出す
  function rows(name) { return sandbox.readAll_(name); }

  return {
    sandbox, sheets, spreadsheet, scriptProps, cacheStore,
    initSheets, seed, rows,
    get fetchCalls() { return fetchCalls; },
    setUrl: (u) => { ssUrl = u; }
  };
}

module.exports = { createHarness, MockSheet, formatDate };
