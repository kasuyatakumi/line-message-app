# LINE文面作成アプリ — 開発ガイド（Claude Code用）

このファイルは、Claude Code がこのプロジェクトで作業するときに毎回読む「仕様書兼ルール」です。
仕様の原本は claude.ai 上の2つのドキュメント（要件定義書・設計書）で、本ファイルはその要約です。食い違いがあれば本ファイルを優先し、変更したら本ファイルも更新すること。

---

## 1. プロダクト概要

人材紹介エージェント（ユーザー＝たくみさん）が、求職者へ**個人LINE**で送る文面を作るためのスマホ向けアプリ。

- 送りたい内容を「ざっくり」入力（箇条書き・話し言葉・キーボードの音声入力）→ 求職者のレベルに合ったLINE文面を2案生成 → ワンタップでコピーしてLINEに貼り付ける
- 求職者から届いたLINEを貼り付けると、返信案を2案生成する
- 求職者の大半は若手・就業経験少なめ。中堅・ハイクラスもたまにいるため、**5段階のレベル**で書き分ける
- 利用者は当面ユーザー1人。将来CAメンバーに展開できる作りにする
- 個人情報（求職者の氏名等）をAIに送ることはユーザー承認済み

## 2. 技術構成（確定）

```
[スマホ/PC ブラウザ]
  画面: PWA（HTML/CSS/JS、ビルドなし）… GitHub Pages（公開リポジトリ）で配信
  スマホ内保存: localStorage（トークン・前回データ・入力途中の内容・未送信キュー）
        │  POST（Content-Type: text/plain）＋トークン
        ▼
[GAS Webアプリ]（スプレッドシートにコンテナバインド、実行ユーザー=自分、アクセス=全員）
  ログイン確認 / API振り分け / Claude API 呼び出し / スプシ読み書き
  スクリプトプロパティ: ANTHROPIC_API_KEY, PASSCODE_HASH, PASSCODE_SALT
        │                         │
        ▼                         ▼
[Googleスプレッドシート 7シート]   [Claude API]
```

- **画面側のコードに秘密情報を絶対に入れない**（公開リポジトリのため）。GASのURLは `web/config.js` に置く（公開されてもトークンが無ければ何もできない設計）
- GAS は `doPost` 1本で全APIを受け、`action` で振り分け。`doGet` は稼働確認用に `{ok:true}` を返すだけ
- フロントからの fetch は `Content-Type: text/plain;charset=utf-8`（CORSのプリフライトを避ける）、`redirect: 'follow'`
- GAS のレスポンスは `ContentService.createTextOutput(JSON.stringify(...)).setMimeType(ContentService.MimeType.JSON)`
- フレームワークは使わない（Vanilla JS）。外部ライブラリが必要な場合も CDN 1本程度に留める
- AIモデル: 既定 `claude-haiku-5-5`（速さ重視）、設定で `claude-sonnet-5-5`（品質重視）に切替
  - エンドポイント `https://api.anthropic.com/v1/messages`、ヘッダ `x-api-key` / `anthropic-version: 2023-06-01`
  - GAS からは `UrlFetchApp.fetch(..., {muteHttpExceptions: true})`
- タイムゾーンは `Asia/Tokyo`。日時は `yyyy-MM-dd HH:mm` 形式の文字列で保存

## 3. ディレクトリ構成（作る予定）

```
/
├─ CLAUDE.md            … このファイル
├─ KICKOFF.md           … 最初にClaude Codeへ渡す指示
├─ gas/
│   ├─ appsscript.json
│   ├─ Main.gs          … doPost/doGet、ルーティング、レスポンス整形
│   ├─ Auth.gs          … ログイン、トークン、ロック
│   ├─ Sheets.gs        … シート読み書きの共通処理、ID採番
│   ├─ Api.gs           … 各actionの処理
│   ├─ Prompt.gs        … 指示書の組み立て、Claude API呼び出し、出力の検証
│   ├─ Setup.gs         … 初期設定（シート作成・初期データ投入・メニュー・パスコード/APIキー設定）
│   └─ SeedData.gs      … scenes / levels / settings の初期データ
├─ web/
│   ├─ index.html
│   ├─ style.css
│   ├─ app.js           … 画面制御（必要なら複数ファイルに分割）
│   ├─ api.js           … GAS呼び出し・キャッシュ・未送信キュー
│   ├─ config.js        … GAS_URL（ユーザーが書き換える）
│   ├─ manifest.webmanifest
│   ├─ sw.js            … Service Worker（画面ファイルのキャッシュ）
│   └─ icons/           … 192px / 512px / apple-touch-icon
├─ tests/               … GASロジックのNodeテスト（モックでSpreadsheetApp等を差し替え）
└─ docs/
    └─ SETUP.md         … ユーザー向け設置手順書（日本語・画面操作ベース）
```

GAS への反映は、可能なら `@google/clasp` を使う（`gas/` を push）。ユーザーが clasp にログインできない場合は、各 .gs を手でコピペする手順を SETUP.md に書く。

## 4. 画面仕様

画面下に4タブ：**作成／返信／履歴／設定**（求職者タブ S05/S06 はユーザー要望で非表示。求職者の選択・新規登録は作成/返信の求職者欄＝M02で行う。candidates シート・自動登録・saveCandidate 等のバックエンドは残している）。スマホ片手操作前提。見た目は一般的なスマホアプリ同等（下部タブ、大きめボタン、生成中アニメーション、ダークモード対応）。PWAとしてホーム画面から全画面（standalone）で起動できること。

| ID | 画面 | 仕様 |
| --- | --- | --- |
| S01 | ログイン | パスコード入力（表示切替つき）。5回連続失敗で10分ロック。成功でトークンを保存しS02へ |
| S02 | 作成（ホーム） | レベル Lv1〜5 のボタン／シーン（フェーズごとに見出し＋チップを折り返し表示。横スクロールしない。初期値「自由入力」）／内容入力（複数行、シーンごとの入力例を placeholder 表示、キーボード音声入力で入力可。**アプリ独自の音声ボタンは作らない**）／お気に入りボタン（M01）／生成ボタン（内容が空なら無効）。入力途中の内容は localStorage に一時保存。※求職者機能は全面廃止。作成はレベル＋シーン＋内容だけで生成する（名前は内容に書く運用） |
| S03 | 結果 | 生成した案（作成・返信とも2案）をカードで縦並び。各カードに特徴ラベル。複数吹き出しの案はLINE風吹き出しで分けて表示し、吹き出しごとにコピー。カード下部「全部コピー」「お気に入り」「手直し」。手直しボタン：短く／丁寧に／くだけて／絵文字なし／絵文字多め／分ける／まとめる＋自由入力。本文タップで直接編集可。コピー時「コピーしました」トースト＋裏で markCopied。「作り直す」で同条件再生成 |
| S04 | 返信 | レベル Lv1〜5 ／「届いたLINE」大きめ貼り付け欄（長押しで貼り付け。※専用の貼り付けボタンはユーザー要望で削除）／「どう返したいか」（任意。空ならAIが返し方も提案）→ S03へ。※求職者欄は廃止 |
| S05 | 求職者一覧（**廃止**） | ユーザー要望で求職者機能を全面廃止。画面・バインドともに削除済み |
| S06 | 求職者詳細（**廃止**） | 同上（S05とセットで廃止） |
| S07 | 履歴 | キーワード検索（本文・入力内容・求職者名）、絞り込み（求職者、シーン、レベル、期間：今日/7日/30日/すべて、お気に入りのみ）。1件タップで本文表示・コピー・「これをもとに作る」（S02に内容を入れて開く）・お気に入り登録 |
| S08 | 設定 | 署名・名乗り方、文体ルール、NG表現（自由記述）／AIモデル（品質重視/速さ重視）／シーンの表示・並び替え・追加／ログイン保持期間／ログアウト／「スプレッドシートを開く」リンク |
| M01 | お気に入り（小窓） | 定型文一覧（シーンで絞り込み）→ 選ぶと内容欄に挿入 |
| M02 | 求職者選択（**廃止**） | 求職者機能の廃止に伴い削除 |

**求職者機能は廃止**。作成・返信とも求職者に紐づけず、レベル＋シーン＋内容（返信は届いたLINE）だけで生成する。名前を入れたいときは入力内容に直接書く。candidates シートと saveCandidate 等のバックエンドは残置だが未使用（generate からも参照しない）。

## 5. 求職者レベル（5段階）

| 項目 | Lv1 とてもやさしく | Lv2 やさしく | Lv3 標準 | Lv4 ビジネス | Lv5 ハイクラス |
| --- | --- | --- | --- | --- | --- |
| 想定 | 社会人経験ほぼなし、文章を読むのが苦手 | 若手・経験浅め（大半） | 社会人経験数年 | 経験豊富な中堅層 | 管理職・専門職・高年収層 |
| 文の長さ | 1文20字前後、1文1つのこと | 1文30字前後 | 普通 | やや長めも可 | 簡潔で要点重視 |
| 言葉 | 話し言葉寄りの丁寧語、専門用語なし | 丁寧語、専門用語は言い換え | 一般的な敬語 | ビジネス敬語 | 格式あるビジネス敬語 |
| 絵文字 | 多め（2〜3個） | 適度（1〜2個） | 少し（0〜1個） | 使わない | 使わない |
| 構成 | してほしいことを最初に、期限を明記 | 用件→お願い→期限 | 用件→詳細→お願い | 結論→詳細→提案 | 結論→根拠→提案 |
| 1通の長さ | 3〜5行、長ければ2〜3通に分割 | 5行前後、必要なら分割 | 1〜2通 | 1通 | 1通 |
| 返信のしやすさ | 選択肢やYES/NOで返せる聞き方 | 選択肢を添える | 必要に応じて | 相手の判断に委ねる | 相手の判断に委ねる |

この内容を `levels` シートの初期値（rules 列に文章化）として投入する。example 列は空でよい（良い文例が集まったらユーザーが追加）。

## 6. シーン（scenes 初期データ）

| フェーズ | シーン |
| --- | --- |
| 初回接触 | 初回のあいさつ／面談日程の調整／面談前日・当日のリマインド |
| 面談後 | 面談のお礼／求人の紹介／応募の意思確認／書類（履歴書・職務経歴書）の提出依頼 |
| 選考中 | 書類選考の結果（通過）／書類選考の結果（見送り）／面接日程の調整／面接前のリマインド・対策案内／面接後の感想ヒアリング |
| 結果 | 面接の結果（合格）／面接の結果（不合格）／内定・条件の連絡／入社日の調整 |
| フォロー | 辞退された方へのフォロー／連絡が途絶えた方への掘り起こし／入社後のフォロー |
| その他 | 自由入力 |

各シーンに `hint`（入力欄の薄い例。例：「日時、場所、持ち物、服装」）と `guide`（AIへの説明。例：「必ず日時・場所・持ち物を入れ、前向きな一言で締める」）を用意する。不合格・見送りは「相手を否定しない／次の提案につなげる」を guide に入れる。

## 7. スプレッドシート（7シート、1行目＝英字の列名）

ID は自動採番（C0001 / H000001 / F001 / SC01）。setup 時に全列を書式「書式なしテキスト(@)」にして自動変換を防ぎ、読み込み時も Date 型が来たら文字列に正規化する。

- **candidates**: id, name, call_name, level, age, experience, desired_job, status, memo, last_contact_at, created_at, updated_at
  - 必須: name, call_name, level。call_name 未入力なら「姓＋さん」（スペース区切りの先頭。スペースが無ければ name＋さん）
  - status 候補: 面談前／求人提案中／選考中／内定／入社／辞退・休止
- **history**: id, created_at, type(create|reply), candidate_id, candidate_name, level, scene_id, input_text, received_text, variants_json, final_text, copied_at, revise_count, favorite(TRUE/FALSE), model
- **favorites**: id, title, scene_id, level, body（差し替え箇所は【名前】【日時】）, use_count, created_at
- **scenes**: id, phase, name, hint, guide, order, active
- **levels**: level, label, rules, example
- **settings**（key/value の2列）: signature, style_rules, ng_words, model(sonnet|haiku、初期 haiku), session_days(初期30)
- **sessions**: token, created_at, expires_at, last_used_at, device

## 8. API（GAS doPost）

- 送る: `{ "action": "...", "token": "...", "data": { ... } }`
- 返る: 成功 `{ "ok": true, "data": {...} }` ／ 失敗 `{ "ok": false, "error": { "code": "...", "message": "画面に出す日本語" } }`
- エラーコード: `AUTH_REQUIRED` / `LOCKED` / `AI_ERROR` / `BAD_REQUEST` / `SERVER_ERROR`
- `login` 以外はトークン必須。トークン検証は CacheService で短時間キャッシュして高速化してよい
- 書き込み系は `LockService.getScriptLock()` で排他（ID採番の重複防止）

| action | data | 返り値 data |
| --- | --- | --- |
| login | passcode, device | token, expiresAt |
| logout | なし | なし |
| bootstrap | なし | candidates, scenes, levels, favorites, settings, recentHistory（直近50件）, spreadsheetUrl |
| generate | type(create/reply), level, sceneId, inputText, receivedText | historyId, variants（作成・返信とも2案）。※求職者機能廃止により candidate は返さない |
| revise | historyId, variantIndex, currentMessages, instruction | variant（1案） |
| markCopied | historyId, finalText | なし（history.final_text/copied_at、candidates.last_contact_at を更新） |
| searchHistory | keyword, candidateId, sceneId, level, period(today/7d/30d/all), favoriteOnly, page | items（20件ずつ、新しい順）, hasMore |
| saveCandidate | 各項目（id無し=新規） | candidate |
| saveFavorite | title, sceneId, level, body または historyId | favorite（historyId指定時は history.favorite=TRUE も） |
| deleteFavorite | id | なし |
| saveSettings | settings, scenes | settings, scenes |

**generate の処理順**: トークン確認 → 指示書を組み立てて Claude API（レベル＋シーン＋内容のみ。求職者には紐づけない）→ 出力形式を検証（崩れていれば1回だけ再生成）→ history に1行追加（copied_at は空、candidate_id/candidate_name は空）→ 案を返す（作成・返信とも2案）。

## 9. プロンプト設計

`buildSystemPrompt_(levelRow, sceneRow, settings, type)` の `type` は `create` / `reply` / `revise`。type によって返信時の注意や出力形式を出し分ける（revise のときは出力形式を system に入れず user 側で指定する）。

**system に入れるもの**（順に）
1. 役割：人材紹介エージェント「澤井」本人に代わって個人LINE文面を書くアシスタント（澤井になりきる）
2. 文体ルール（最優先。レベルの絵文字指定より優先）
   - 明るく丁寧で少し腰が低い。感謝と気づかいを欠かさない
   - 文末は「！」を基本に、あたたかく（付けすぎない。1文に1つ程度）
   - 頻出フレーズ:「お世話になっております！」「本日はありがとうございました！」「承知いたしました！」「とんでもございません！」「恐れ入りますが」「お手数をおかけいたしますが」「〜いただけますと幸いです！」「引き続きよろしくお願いいたします！」
   - お願いは「恐れ入りますが、〜いただけますと幸いです！」の形。お詫び・恐縮はやや手厚く（例「申し訳ございません。。。」）
   - 絵文字は求職者レベルの指定に従う（Lv1多め〜Lv4・5は使わない）。相手を否定せず前向きに背中を押す
   - 見出し・箇条書き記号・太字などの装飾は使わない（LINEで崩れる）。区切りは改行
3. あいさつと締め：書き出しは原則「お世話になっております！」。初回や名乗り直後だけ「MISAWA GROUPの澤井です！」と名乗る（毎回は名乗らない）。面談・面接・電話の後は「本日は貴重なお時間を〜」。締めは「引き続きよろしくお願いいたします！」など前向きに
4. 事実と引用の扱い
   - 入力にない事実（日時・社名・金額・URL・会議ID・パスコードなど）は作らない。必要なのに不明なものは【日時】のように空欄で残す
   - **企業から届いた案内文（面接案内・日程詳細・求人票・条件通知・提出物の案内・適性検査の案内など）は書き換え・要約・整形せず原文のまま載せる**。URL・会議ID・パスコード・日時・社名・フォームのリンク・区切り線は一字一句変えない。役割は前後に澤井のあいさつ・ひとことの案内・締めを添えることだけ
   - 日付は「10/28（火）14:00」の形。曜日は必ず下の日付早見表から取る。呼びかけは求職者の「呼び方」。指定なしなら「〇〇さん」
5. レベルのルール（levels 該当行の label / rules）＝文の長さ・敬語の硬さ・絵文字の量・1通にまとめるか分けるかの目安として使う（レベルの指定に従う）
6. シーンの説明（scenes 該当行の name / guide）
7. 返信時（type=reply）の注意：届いたLINEをよく読み相手の質問・依頼にすべて答える／不安・恐縮している点に一言寄り添う／お礼や報告はまず受け止めて感謝し、必要なら次の一歩を案内
8. ユーザー個別設定（settings の signature / style_rules / ng_words。あれば優先）
9. 日付早見表：今日から30日分の「M/D（曜）」＋現在日時
10. 出力形式（revise 以外。下記JSONのみ。前後に説明文やコードブロック記号は付けない）

**user メッセージに入れるもの**: 今回の入力（ざっくり内容、返信案なら届いたLINE＋返したい方向性。方向性が空なら「適切な返し方を提案」）。※求職者機能は廃止したため、求職者情報・直近のやり取りは送らない（buildUserPrompt_ は求職者情報が空ならそのブロックごと省略する）。

**出力形式**（type で出し分け）
- 作成（create）＝2案（1案目は標準、2案目はより前向きに背中を押す）
```json
{ "variants": [ { "label": "標準", "messages": ["吹き出し1", "吹き出し2"] }, { "label": "背中を押す", "messages": ["…"] } ] }
```
- 返信（reply）＝2案（1案目は標準、2案目はより丁寧・やわらかめ）
```json
{ "variants": [ { "label": "標準", "messages": ["吹き出し1"] }, { "label": "やわらかめ", "messages": ["吹き出し1", "吹き出し2"] } ] }
```
- messages の1要素＝LINEの吹き出し1つ。Lv1〜2は必要に応じ2〜3要素、Lv4〜5は原則1要素
- 応答テキストから最初の `{` 〜最後の `}` を取り出して JSON.parse。variants が1件以上・各 messages が空でない文字列配列であることを検証。3件超は切り捨て

**手直し（revise）**: 「次の文面を、指示に従って直してください。指示されていない部分は変えない」＋選んだ案の messages＋修正指示（＋元のレベル・シーンのルール）。system は上記の文体ルール等を入れつつ出力形式は入れず、user 側で `{"variant": {"label": "...", "messages": [...]}}` の1案を指定。history.revise_count を+1。

## 10. ログイン・キャッシュ・エラー処理

**ログイン**
- パスコードは `SHA-256(salt + passcode)` のハッシュを PASSCODE_HASH に保存（平文保存しない）
- 成功でランダムトークン（Utilities.getUuid を2つ連結など）を発行 → sessions に保存、期限 = session_days 日
- 毎回トークン確認、期限内なら last_used_at 更新。期限切れは AUTH_REQUIRED
- 失敗回数を ScriptProperties で記録、5回で10分ロック（LOCKED）

**キャッシュ（待たせない）**
- 起動時：localStorage の前回データで即表示 → 裏で bootstrap → 届いたら差し替え
- 求職者・お気に入り・設定の変更：画面と localStorage を先に更新 → 裏で保存、失敗したらトーストで知らせて元に戻す
- コピー時：即「コピーしました」→ 裏で markCopied。失敗したら未送信キューに貯めて次回起動時に再送
- Service Worker で画面ファイルをキャッシュ。更新は次回起動時に反映（キャッシュ名にバージョンを入れる）

**エラー表示**
| 状況 | 表示・動き |
| --- | --- |
| 通信できない | 「電波の良いところで再度お試しください」。入力内容は残す |
| ログイン切れ | S01へ。ログイン後、入力中の内容を戻す |
| AIが30秒超 | 「時間がかかっています。もう一度お試しください」＋再試行ボタン |
| AI出力の形が崩れている | GASで1回自動再生成 → だめなら再試行ボタン |
| AI側の混雑（429/5xx/529） | GASで1回自動再試行（1.5秒待つ）→ だめならエラー表示 |
| 想定外エラー | 「エラーが発生しました」＋再試行ボタン。詳細は console.error（GASのログ） |

## 11. 初期設定の流れ（Setup.gs）

スプレッドシートを開くとメニュー「LINE文面アプリ」が出る（onOpen）。
1. 「初期設定（シート作成）」… 7シートを作成し、scenes / levels / settings の初期データを投入（既存データは消さない。シートがあればスキップ）
2. 「Claude APIキーを設定」… ui.prompt で入力 → ANTHROPIC_API_KEY に保存
3. 「パスコードを設定」… ui.prompt で入力（8文字以上）→ salt生成・ハッシュ化して保存
4. 「接続テスト」… Claude API に短い問い合わせをして結果を表示

## 12. 開発ルール

- 回答・コメント・UI文言はすべて日本語。ユーザーは非エンジニアなので、報告は専門用語を避けて平易に
- GASのロジックは `tests/` に Node のテストを書き、SpreadsheetApp / UrlFetchApp / PropertiesService / CacheService / LockService / Utilities / ContentService をモックして検証する（特に：トークン検証、ID採番、generate の自動登録、AI出力の検証と再生成、searchHistory の絞り込み）
- 画面はスマホ幅（375px）で崩れないこと、ダークモードで読めることを確認
- 秘密情報（APIキー・パスコード）をコード・リポジトリ・ログに出さない
- 仕様を変えたら本ファイルを更新する
- 不明点は勝手に決めずユーザーに確認する。ただし軽微なUIの判断は合理的に決めて、決めた内容を報告する
