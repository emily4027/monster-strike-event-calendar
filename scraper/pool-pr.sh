#!/usr/bin/env bash
# 把卡池資料套用到 pools.json，在 pools-update 分支開 (或更新) PR 給管理員確認。GitHub Actions 用。
#
# 用法：bash scraper/pool-pr.sh <卡池資料.json> <PR 標題> [append|replace]
#   append (每天的爬蟲，預設)：已經有開著的卡池 PR 時接在那個分支後面，PR 說明加上這次的內容
#   replace (歷史回補)：已經有開著的卡池 PR 時，從最新的 main 重做整個分支，PR 標題和說明換成這次的內容
#   沒有開著的 PR：從 main 重新建立分支 (被關掉的 PR 裡的變動不會跑回來)
#   pools.json 沒變動、但有需要手動處理的事：開一個 issue
# 需要環境變數 GH_TOKEN，以及 repo 設定「Allow GitHub Actions to create and approve pull requests」
set -euo pipefail

ITEMS="$1"
TITLE="$2"
MODE="${3:-append}"
BRANCH="pools-update"
TODAY="$(TZ=Asia/Taipei date +%F)"
REPORT="${RUNNER_TEMP:-/tmp}/pool-report.md"
BODY="${RUNNER_TEMP:-/tmp}/pool-body.md"

if [ ! -s "$ITEMS" ]; then
  echo "沒有卡池資料"
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git fetch origin main

PR="$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number // empty')"
if [ -n "$PR" ] && [ "$MODE" = "append" ]; then
  git fetch origin "$BRANCH"
  git checkout -B "$BRANCH" "origin/$BRANCH"
  git merge --no-edit origin/main
else
  git checkout -B "$BRANCH" origin/main
fi

node scraper/apply-pools.js "$ITEMS" "$REPORT"
if [ ! -s "$REPORT" ]; then
  echo "卡池沒有變動"
  exit 0
fi

if git diff --quiet -- pools.json && [ -z "$(git status --porcelain -- elements.json)" ]; then
  {
    echo "爬蟲讀到的公告裡，有些卡池沒辦法自動更新，請確認後手動處理（可以把這個 issue 的內容貼給 Claude）。"
    echo
    cat "$REPORT"
  } > "$BODY"
  gh issue create --title "卡池需要手動處理 ($TODAY)" --body-file "$BODY"
  exit 0
fi

git add pools.json elements.json
git commit -m "卡池：依官網公告更新 ($TODAY)"
git push --force origin "$BRANCH"   # 分支只有爬蟲在用

new_body() {
  echo "爬蟲從官網公告整理出的卡池變動。請看過下面的內容和 Files changed，沒問題就按 **Merge pull request**；有錯就關掉這個 PR，或在下面留言。"
  echo
  echo "- 祭典等本家轉蛋：公告的「限定角色」與「轉出對象期間限定角色」，每個版本只用在它自己那個月"
  echo "- 合作活動：轉蛋段落角色表裡「★6（獸神化前）」的角色"
  echo "- 合作祭典：本家限定另外列；公告沒寫時沿用那個卡池之前最近一期的名單"
  echo
  echo "## $TODAY"
  echo
  cat "$REPORT"
}

if [ -n "$PR" ] && [ "$MODE" = "append" ]; then
  {
    gh pr view "$PR" --json body --jq .body
    echo
    echo "---"
    echo
    echo "## $TODAY"
    echo
    cat "$REPORT"
  } > "$BODY"
  gh pr edit "$PR" --body-file "$BODY"
elif [ -n "$PR" ]; then
  new_body > "$BODY"
  gh pr edit "$PR" --title "$TITLE" --body-file "$BODY"
else
  new_body > "$BODY"
  gh pr create --base main --head "$BRANCH" --title "$TITLE" --body-file "$BODY"
fi
