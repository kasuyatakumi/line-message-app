/**
 * make-icons.js
 * アプリアイコン（LINE風の緑背景＋白い吹き出し）のPNGを生成する。
 * 使い方: node web/icons/make-icons.js
 * 外部ライブラリ不要（Node標準のzlibだけ使用）。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32（PNGチャンク用）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** size×size の RGBA を描いて PNG バッファを返す。 */
function makePng(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  // 色
  const green = [6, 199, 85];
  const white = [255, 255, 255];

  // 吹き出しの矩形（中央やや上）＋ しっぽ
  const bx0 = size * 0.22, bx1 = size * 0.78;
  const by0 = size * 0.24, by1 = size * 0.62;
  const br = size * 0.10; // 角丸
  const tailX = size * 0.36, tailY = by1; // しっぽ基点

  const inRounded = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
  };
  const inTail = (x, y) => {
    // 下向きの三角のしっぽ
    if (y < tailY || y > tailY + size * 0.14) return false;
    const t = (y - tailY) / (size * 0.14);
    const left = tailX, right = tailX + size * 0.12 * (1 - t);
    return x >= left && x <= right;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRounded(x, y, bx0, by0, bx1, by1, br) || inTail(x, y)) {
        set(x, y, white[0], white[1], white[2], 255);
      } else {
        set(x, y, green[0], green[1], green[2], 255);
      }
    }
  }

  // スキャンラインにフィルタバイト0を付ける
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const out = __dirname;
const files = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180]
];
files.forEach(([name, size]) => {
  fs.writeFileSync(path.join(out, name), makePng(size));
  console.log('generated', name, size + 'px');
});
