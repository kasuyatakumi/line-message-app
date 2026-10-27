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
 */
function buildSystemPrompt_(levelRow, sceneRow, settings) {
  var parts = [];

  // 1. 役割
  parts.push('あなたは、人材紹介エージェントが求職者へ個人LINEで送る文面を書くアシスタントです。');

  // 2. 共通ルール
  parts.push([
    '【共通ルール】',
    '・入力に無い事実（日時・社名・金額など）は作らない。必要なのに不明な情報は【日時】のように空欄で残す。',
    '・見出し・箇条書き記号・太字などの装飾は使わない（LINEで崩れるため）。区切りは改行で行う。',
    '・日付は「10/28（火）14:00」の形。曜日は必ず下の日付早見表から取る。',
    '・呼びかけは求職者の「呼び方」を使う。指定が無ければ「〇〇さん」。',
    '・名乗りは初回のあいさつなど必要な場面だけにする。',
    '・NG表現は使わない。文体ルールに従う。',
    '・3案は「簡潔」「丁寧」「背中を押す」など、性格の違う案にする。',
    '・返信案では相手の質問すべてに答え、不安そうな点に一言触れる。'
  ].join('\n'));

  // 3. レベルのルール
  if (levelRow) {
    var lv = ['【求職者レベル】Lv' + levelRow.level + ' ' + (levelRow.label || '')];
    if (levelRow.rules) lv.push('ルール: ' + levelRow.rules);
    if (levelRow.example) lv.push('良い文例: ' + levelRow.example);
    parts.push(lv.join('\n'));
  }

  // 4. シーンの説明
  if (sceneRow) {
    var sc = ['【今回のシーン】' + (sceneRow.name || '')];
    if (sceneRow.guide) sc.push('書き方の指針: ' + sceneRow.guide);
    parts.push(sc.join('\n'));
  }

  // 5. 名乗り方・文体ルール・NG表現
  var cfg = [];
  if (settings && settings.signature) cfg.push('名乗り方・署名: ' + settings.signature);
  if (settings && settings.style_rules) cfg.push('文体ルール: ' + settings.style_rules);
  if (settings && settings.ng_words) cfg.push('NG表現（使わない）: ' + settings.ng_words);
  if (cfg.length) parts.push('【あなたの設定】\n' + cfg.join('\n'));

  // 6. 日付早見表
  parts.push('【日付早見表】\n' + dateTable_());

  // 7. 出力形式
  parts.push([
    '【出力形式】次のJSONだけを出力する。前後に説明文を付けない。',
    '{"variants":[{"label":"簡潔","messages":["吹き出し1","吹き出し2"]},{"label":"丁寧","messages":["..."]},{"label":"背中を押す","messages":["..."]}]}',
    '・messagesの1要素＝LINEの吹き出し1つ。',
    '・Lv1〜2は必要に応じて2〜3要素に分ける。Lv4〜5は原則1要素。'
  ].join('\n'));

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

  var info = ['【求職者情報】'];
  info.push('名前: ' + (c.name || '（不明）'));
  info.push('呼び方: ' + (c.call_name || '（指定なし）'));
  if (c.experience) info.push('経験: ' + c.experience);
  if (c.desired_job) info.push('希望: ' + c.desired_job);
  if (c.status) info.push('選考状況: ' + c.status);
  if (c.memo) info.push('メモ: ' + c.memo);
  lines.push(info.join('\n'));

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
