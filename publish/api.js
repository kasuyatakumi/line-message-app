/**
 * api.js
 * GAS（サーバー）との通信、ログイントークンの保管、
 * 起動データのキャッシュ、コピー記録の未送信キューを扱う。
 */
const Store = {
  TOKEN: 'lma_token',
  BOOTSTRAP: 'lma_bootstrap',
  DRAFT: 'lma_draft',
  QUEUE: 'lma_queue',
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
};

/** サーバーエラーを表すクラス（code と日本語メッセージを持つ）。 */
class ApiError extends Error {
  constructor(code, message) {
    super(message || 'エラーが発生しました');
    this.code = code || 'SERVER_ERROR';
  }
}

const Api = {
  token() { return Store.get(Store.TOKEN, ''); },
  setToken(t) { Store.set(Store.TOKEN, t); },
  clearToken() { Store.remove(Store.TOKEN); },

  /**
   * GAS に1回 POST する。成功で data を返し、失敗で ApiError を投げる。
   * タイムアウト（既定40秒）も考慮する。
   */
  async call(action, data, opts) {
    opts = opts || {};
    if (!GAS_URL || GAS_URL.indexOf('http') !== 0) {
      throw new ApiError('SERVER_ERROR', 'アプリの接続先が未設定です（config.js）');
    }
    const body = JSON.stringify({ action, token: this.token(), data: data || {} });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 40000);
    let res;
    try {
      res = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
        redirect: 'follow',
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new ApiError('TIMEOUT', '時間がかかっています。もう一度お試しください');
      throw new ApiError('NETWORK', '電波の良いところで再度お試しください');
    }
    clearTimeout(timer);

    let json;
    try { json = JSON.parse(await res.text()); }
    catch (e) { throw new ApiError('SERVER_ERROR', 'エラーが発生しました。もう一度お試しください'); }

    if (!json.ok) {
      const err = json.error || {};
      if (err.code === 'AUTH_REQUIRED') this.clearToken();
      throw new ApiError(err.code, err.message);
    }
    return json.data;
  },

  // ---- 認証 ----
  async login(passcode, device) {
    const data = await this.call('login', { passcode, device });
    this.setToken(data.token);
    return data;
  },
  async logout() {
    try { await this.call('logout', {}); } catch (e) {}
    this.clearToken();
    Store.remove(Store.BOOTSTRAP);
  },

  // ---- 起動データ（キャッシュ付き） ----
  cachedBootstrap() { return Store.get(Store.BOOTSTRAP, null); },
  async bootstrap() {
    const data = await this.call('bootstrap', {});
    Store.set(Store.BOOTSTRAP, data);
    return data;
  },

  // ---- 生成系 ----
  generate(data) { return this.call('generate', data, { timeoutMs: 40000 }); },
  revise(data) { return this.call('revise', data, { timeoutMs: 40000 }); },

  // ---- コピー記録（失敗時は未送信キューへ） ----
  async markCopied(historyId, finalText) {
    try {
      await this.call('markCopied', { historyId, finalText });
    } catch (e) {
      const q = Store.get(Store.QUEUE, []);
      q.push({ historyId, finalText });
      Store.set(Store.QUEUE, q);
    }
  },
  /** 起動時に未送信のコピー記録を再送する。 */
  async flushQueue() {
    const q = Store.get(Store.QUEUE, []);
    if (!q.length) return;
    const rest = [];
    for (const item of q) {
      try { await this.call('markCopied', item); }
      catch (e) { rest.push(item); }
    }
    Store.set(Store.QUEUE, rest);
  },

  // ---- 各種保存 ----
  saveCandidate(data) { return this.call('saveCandidate', data); },
  saveFavorite(data) { return this.call('saveFavorite', data); },
  deleteFavorite(id) { return this.call('deleteFavorite', { id }); },
  searchHistory(data) { return this.call('searchHistory', data); },
  saveSettings(data) { return this.call('saveSettings', data); }
};
