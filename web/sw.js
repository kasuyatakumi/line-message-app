/**
 * sw.js — Service Worker
 * 画面ファイルをキャッシュしてオフラインでも起動できるようにする。
 * 更新はキャッシュ名のバージョンを上げると次回起動時に反映される。
 * （GASへの通信結果はキャッシュしない。画面の見た目ファイルだけ。）
 */
const CACHE_VERSION = 'v2';
const CACHE_NAME = 'line-app-' + CACHE_VERSION;
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './api.js',
  './config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // GAS（script.google.com）などへの通信は素通し（キャッシュしない）
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  // 画面ファイルはキャッシュ優先、無ければ取得してキャッシュ
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
