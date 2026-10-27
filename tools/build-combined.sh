#!/usr/bin/env bash
# gas/ の7ファイルを1つにまとめて「GAS貼り付け用_コード.gs」を作り直す。
# 使い方: bash tools/build-combined.sh
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="GAS貼り付け用_コード.gs"
{
cat <<'HEAD'
/**
 * ★ Apps Script 貼り付け用（全部まとめ）★
 * このファイルの中身をすべてコピーして、Apps Scriptエディタの
 * 「コード.gs」（または Code.gs）に貼り付けてください。これ1つでOKです。
 * （元は gas/ 内の7ファイル。順番に結合したもの。中身は同じです）
 *
 * 貼り付けたら保存し、スプレッドシートを再読み込みすると
 * メニュー「LINE文面アプリ」が出ます。
 *
 * ※このファイルは自動生成です。コードを直すときは gas/ 側を編集し、
 *   tools/build-combined.sh で作り直してください。
 */

HEAD
for f in Sheets.gs SeedData.gs Auth.gs Prompt.gs Api.gs Main.gs Setup.gs; do
  echo ""
  echo "/* ===================== $f ===================== */"
  echo ""
  cat "gas/$f"
done
} > "$OUT"
echo "作成: $OUT"
