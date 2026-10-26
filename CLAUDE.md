# LINE文面作成アプリ — 開発ガイド（Claude Code用）

このファイルは、Claude Code がこのプロジェクトで作業するときに毎回読む「仕様書兼ルール」です。
仕様の原本は claude.ai 上の2つのドキュメント（要件定義書・設計書）で、本ファイルはその要約です。食い違いがあれば本ファイルを優先し、変更したら本ファイルも更新すること。

---

## 1. プロダクト概要

人材紹介エージェント（ユーザー＝たくみさん）が、求職者へ**個人LINE**で送る文面を作るためのスマホ向けアプリ。

- 送りたい内容を「ざっくり」入力（箇条書き・話し言葉・キーボードの音声入力）→ 求職者のレベルに合ったLINE文面を3案生成 → ワンタップでコピーしてLINEに貼り付ける
- 求職者から届いたLINEを貼り付けると、返信案を3案生成する
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
- AIモデル: 標準 `claude-sonnet-5-5`（品質重視）、設定で `claude-haiku-5-5`（速さ重視）に切替
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

画面下に5タブ：**作成／返信／求職者／履歴／設定**。スマホ片手操作前提。見た目は一般的なスマホアプリ同等（下部タブ、大きめボタン、生成中アニメーション、ダークモード対応）。PWAとしてホーム画面から全画面（standalone）で起動できること。

| ID | 画面 | 仕様 |
| --- | --- | --- |
| S01 | ログイン | パスコード入力（表示切替つき）。5回連続失敗で10分ロック。成功でトークンを保存しS02へ |
| S02 | 作成（ホーム） | 求職者欄（タップでM02。未選択は「指定なし」。選ぶとレベル・呼び方を自動セット）／レベル Lv1〜5 のボタン（手動変更はその回だけ）／シーン（フェーズ別の横スクロールボタン、初期値「自由入力」）／内容入力（複数行、シーンごとの入力例を placeholder 表示、キーボード音声入力で入力可。**アプリ独自の音声ボタンは作らない**）／お気に入りボタン（M01）／生成ボタン（内容が空なら無効）。入力途中の内容は localStorage に一時保存 |
| S03 | 結果 | 3案をカードで縦並び。各カードに特徴ラベル。複数吹き出しの案はLINE風吹き出しで分けて表示し、吹き出しごとにコピー。カード下部「全部コピー」「お気に入り」「手直し」。手直しボタン：短く／丁寧に／くだけて／絵文字なし／絵文字多め／分ける／まとめる＋自由入力。本文タップで直接編集可。コピー時「コピーしました」トースト＋裏で markCopied。「作り直す」で同条件再生成 |
| S04 | 返信 | 求職者欄・レベル（S02と同じ）／「届いたLINE」大きめ貼り付け欄＋「貼り付け」ボタン（Clipboard API）／「どう返したいか」（任意。空ならAIが返し方も提案）→ S03へ |
| S05 | 求職者一覧 | 名前検索、選考状況で絞り込み。最終連絡日の新しい順。1行：名前、レベル、選考状況、最終連絡日 |
| S06 | 求職者詳細 | 基本情報（タップで編集）／「この人に送る」「この人に返信」（S02/S04を選択済みで開く）／やり取り履歴をLINE風に時系列表示（受け取ったLINE＝左、コピーした文面＝右） |
| S07 | 履歴 | キーワード検索（本文・入力内容・求職者名）、絞り込み（求職者、シーン、レベル、期間：今日/7日/30日/すべて、お気に入りのみ）。1件タップで本文表示・コピー・「これをもとに作る」（S02に内容を入れて開く）・お気に入り登録 |
| S08 | 設定 | 署名・名乗り方、文体ルール、NG表現（自由記述）／AIモデル（品質重視/速さ重視）／シーンの表示・並び替え・追加／ログイン保持期間／ログアウト／「スプレッドシートを開く」リンク |
| M01 | お気に入り（小窓） | 定型文一覧（シーンで絞り込み）→ 選ぶと内容欄に挿入 |
| M02 | 求職者選択（小窓） | 検索して選ぶ／新しい名前を入力（generate時に自動登録される） |

**求職者の事前登録は不要**。S02/S04で新しい名前を入力して生成すると自動で candidates に登録される（同名がいればその人を使う）。

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
- **settings**（key/value の2列）: signature, style_rules, ng_words, model(sonnet|haiku), session_days(初期30)
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
| generate | type(create/reply), candidateId または newName, level, sceneId, inputText, receivedText | historyId, variants（3案）, candidate（自動登録した場合） |
| revise | historyId, variantIndex, currentMessages, instruction | variant（1案） |
| markCopied | historyId, finalText | なし（history.final_text/copied_at、candidates.last_contact_at を更新） |
| searchHistory | keyword, candidateId, sceneId, level, period(today/7d/30d/all), favoriteOnly, page | items（20件ずつ、新しい順）, hasMore |
| saveCandidate | 各項目（id無し=新規） | candidate |
| saveFavorite | title, sceneId, level, body または historyId | favorite（historyId指定時は history.favorite=TRUE も） |
| deleteFavorite | id | なし |
| saveSettings | settings, scenes | settings, scenes |

**generate の処理順**: トークン確認 → newName があれば candidates に追加（同名は流用）→ 指示書を組み立てて Claude API → 出力形式を検証（崩れていれば1回だけ再生成）→ history に1行追加（copied_at は空）→ 3案を返す。

## 9. プロンプト設計

**system に入れるもの**（順に）
1. 役割：人材紹介エージェントが個人LINEで求職者に送る文面を書くアシスタント
2. 共通ルール
   - 入力にない事実（日時・社名・金額など）は作らない。必要なのに不明な情報は【日時】のように空欄で残す
   - 見出し・箇条書き記号・太字などの装飾は使わない（LINEで崩れる）。区切りは改行
   - 日付は「10/28（火）14:00」の形。曜日は必ず下の日付早見表から取る
   - 呼びかけは求職者の「呼び方」。指定なしなら「〇〇さん」
   - 名乗りは初回のあいさつなど必要な場面だけ
   - NG表現は使わない。文体ルールに従う
   - 3案は「簡潔」「丁寧」「背中を押す」など性格の違う案にする
   - 返信案では相手の質問すべてに答え、不安そうな点に一言触れる
3. レベルのルール（levels シート該当行の label / rules / example）
4. シーンの説明（scenes 該当行の name / guide）
5. 名乗り方・文体ルール・NG表現（settings）
6. 日付早見表：今日から30日分の「M/D（曜）」＋現在日時
7. 出力形式（下記JSONのみ。前後に説明文を付けない）

**user メッセージに入れるもの**: 求職者情報（名前・呼び方・経験・希望・選考状況・メモ）、直近のやり取り（その求職者の history 直近5件：受け取ったLINE と final_text）、今回の入力（ざっくり内容、返信案なら届いたLINE＋返したい方向性。方向性が空なら「適切な返し方を提案」）。

**出力形式**
```json
{
  "variants": [
    { "label": "簡潔", "messages": ["山田さん、こんばんは😊", "明日10/28（火）14:00から面接です！\n持ち物は履歴書です。10分前には着くようにしましょう👍"] },
    { "label": "丁寧", "messages": ["…"] },
    { "label": "背中を押す", "messages": ["…"] }
  ]
}
```
- messages の1要素＝LINEの吹き出し1つ。Lv1〜2は必要に応じ2〜3要素、Lv4〜5は原則1要素
- 応答テキストから最初の `{` 〜最後の `}` を取り出して JSON.parse。variants が1件以上・各 messages が空でない文字列配列であることを検証。3件超は切り捨て

**手直し**: 「次の文面を、指示に従って直してください。指示されていない部分は変えない」＋選んだ案の messages＋修正指示（＋元のレベル・シーンのルール）。返すのは `{"variant": {"label": "...", "messages": [...]}}` の1案。history.revise_count を+1。

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
