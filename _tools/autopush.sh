#!/usr/bin/env bash
# =============================================================================
#  autopush.sh —— 一键「暂存 → 提交 → 推送」（Git Bash / Linux / macOS）
#
#  用法：
#     ./autopush.sh -m "修复秒位滚动"
#     ./autopush.sh -m "更新作品" -r origin -b main
#     GIT_COMMIT_MESSAGE="来自环境变量" ./autopush.sh
#     ./autopush.sh -m "试一下" -n          # -n = dry-run，只预演
#
#  退出码：0 成功/无可提交  2 参数错  3 非仓库  4 无 git  5 未配用户信息
#          6 提交失败  7 远程不存在  8 无权限  9 远端有新提交  10 推送失败
# =============================================================================
set -uo pipefail

EXIT_OK=0; EXIT_BADARGS=2; EXIT_NOTREPO=3; EXIT_NOGIT=4; EXIT_NOUSER=5
EXIT_COMMIT=6; EXIT_NOREMOTE=7; EXIT_NOPERM=8; EXIT_CONFLICT=9; EXIT_PUSH=10

MSG="${GIT_COMMIT_MESSAGE:-}"
REMOTE="${GIT_REMOTE:-origin}"
BRANCH="${GIT_BRANCH:-}"
DRY=0
PATHS=()

while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message) MSG="$2"; shift 2 ;;
    -r|--remote)  REMOTE="$2"; shift 2 ;;
    -b|--branch)  BRANCH="$2"; shift 2 ;;
    -n|--dry-run) DRY=1; shift ;;
    -h|--help)    sed -n '2,16p' "$0"; exit $EXIT_OK ;;
    --) shift; while [ $# -gt 0 ]; do PATHS+=("$1"); shift; done ;;
    -*) echo "[错误] 未知参数：$1" >&2; exit $EXIT_BADARGS ;;
    *)  PATHS+=("$1"); shift ;;
  esac
done

# ---- 日志：控制台彩色 + 可选文件（$GIT_AUTOPUSH_LOG） ----
LOG="${GIT_AUTOPUSH_LOG:-}"
_log() { [ -n "$LOG" ] && printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; return 0; }
step() { echo -e "\033[36m[步骤] $1\033[0m"; _log "[步骤] $1"; }
ok()   { echo -e "\033[32m[完成] $1\033[0m"; _log "[完成] $1"; }
warn() { echo -e "\033[33m[注意] $1\033[0m"; _log "[注意] $1"; }
err()  { echo -e "\033[31m[错误] $1\033[0m"; _log "[错误] $1"; }
info() { echo -e "\033[90m       $1\033[0m"; _log "       $1"; }

# ---- 定位 git（Windows 便携版不在 PATH 的情况） ----
if [ -n "${GIT_EXE:-}" ] && [ -x "$GIT_EXE" ]; then
  GIT="$GIT_EXE"
elif command -v git >/dev/null 2>&1; then
  GIT="$(command -v git)"
else
  GIT=""
  for d in "$HOME"/.workbuddy/binaries/PortableGit/versions/*/mingw64/bin \
           "/c/Program Files/Git/cmd" "/c/Program Files (x86)/Git/cmd"; do
    [ -x "$d/git.exe" ] && { GIT="$d/git.exe"; break; }
  done
  [ -z "$GIT" ] && { err "找不到 git。请安装 Git，或用 GIT_EXE 指定路径。"; exit $EXIT_NOGIT; }
fi
info "git: $GIT"

# 统一的 git 调用封装：失败时保留输出供分类
git_run() { _log "  \$ git $*"; "$GIT" "$@" 2>&1; }

echo
step "检查仓库状态"

if [ "$(git_run rev-parse --is-inside-work-tree | tr -d '\r\n')" != "true" ]; then
  err "当前目录不是 Git 仓库（$(pwd)）。请先 cd 到项目目录，或执行 git init。"
  exit $EXIT_NOTREPO
fi

if [ -z "$BRANCH" ]; then
  BRANCH="$(git_run rev-parse --abbrev-ref HEAD | tr -d '\r\n')"
  if [ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ]; then
    err "当前处于 detached HEAD。请用 -b 指定分支名，或先 git checkout 一个分支。"
    exit $EXIT_BADARGS
  fi
fi
info "远程: $REMOTE"
info "分支: $BRANCH"

case "$BRANCH" in
  *..*|/*|*' '*) err "分支名 '$BRANCH' 看起来不合法。"; exit $EXIT_BADARGS ;;
esac

UN="$(git_run config user.name  | tr -d '\r\n')"
UE="$(git_run config user.email | tr -d '\r\n')"
if [ -z "$UN" ] || [ -z "$UE" ]; then
  err "未配置提交者信息，git 无法提交。请先执行："
  info 'git config --global user.name  "你的名字"'
  info 'git config --global user.email "你的邮箱"'
  exit $EXIT_NOUSER
fi
info "提交者: $UN <$UE>"

RURL="$(git_run remote get-url "$REMOTE" 2>/dev/null | tr -d '\r\n')"
# 注意：远程不存在时 git 会把 "error: No such remote" 写到 stderr，
# 上面的 2>/dev/null 把它挡掉，再用 remote 列表二次确认，避免把错误文本当成 URL。
if [ -z "$RURL" ] || ! git_run remote | tr -d '\r' | grep -qx -- "$REMOTE"; then
  err "远程 '$REMOTE' 不存在。已配置的远程：$(git_run remote | tr '\n' ' ')"
  info "可用：git remote add $REMOTE <仓库地址>"
  exit $EXIT_NOREMOTE
fi
info "远程地址: $RURL"

ROOT="$(git_run rev-parse --show-toplevel | tr -d '\r\n')"
[ -n "$ROOT" ] && cd "$ROOT"

# ---- 工作区是否有变更：未跟踪文件也要算进去 ----
STATUS="$(git_run status --porcelain)"
if [ -z "$STATUS" ]; then
  ok "工作区干净，没有需要提交的变更。"
  AHEAD="$(git_run rev-list --count "$REMOTE/$BRANCH..HEAD" 2>/dev/null | tr -d '\r\n')"
  case "$AHEAD" in ''|*[!0-9]*) ;; *) [ "$AHEAD" -gt 0 ] && {
      warn "不过本地领先 $REMOTE/$BRANCH $AHEAD 个提交尚未推送。"
      info "如需只推送这些提交：git push $REMOTE $BRANCH"; } ;;
  esac
  exit $EXIT_OK
fi
info "检测到以下变更："
printf '%s\n' "$STATUS" | while IFS= read -r l; do [ -n "$l" ] && info "  $l"; done

echo
step "暂存变更"
# DryRun 不落地任何状态：只看「将会提交什么」，不真的 add
if [ "$DRY" -eq 1 ]; then
  if [ ${#PATHS[@]} -gt 0 ]; then
    PLANNED="$(git_run add --dry-run -- "${PATHS[@]}")"
  else
    PLANNED="$(git_run add --dry-run -A)"
  fi
  info "本次计划暂存："
  printf '%s\n' "$PLANNED" | while IFS= read -r l; do [ -n "$l" ] && info "  $l"; done
  echo
  step "提交与推送（预演）"
  warn "DryRun 模式：以下动作不会真正执行，暂存区保持原样。"
  info "git commit -m \"${MSG:-<默认信息>}\""
  info "git push ${REMOTE} ${BRANCH}"
  exit $EXIT_OK
fi

if [ ${#PATHS[@]} -gt 0 ]; then
  for p in "${PATHS[@]}"; do
    git_run add -- "$p" >/dev/null || { err "暂存 '$p' 失败。"; exit $EXIT_COMMIT; }
  done
else
  git_run add -A >/dev/null || { err "暂存失败。"; exit $EXIT_COMMIT; }
fi

STAGED="$(git_run diff --cached --name-only)"
if [ -z "$STAGED" ]; then
  warn "暂存区为空 —— 变更可能都被 .gitignore 忽略了。未做提交。"
  exit $EXIT_OK
fi
info "本次将提交 $(printf '%s\n' "$STAGED" | grep -c .) 个文件"
printf '%s\n' "$STAGED" | while IFS= read -r f; do [ -n "$f" ] && info "  + $f"; done

echo
step "提交"
if [ -z "$MSG" ]; then
  MSG="chore: 更新站点内容 $(date '+%Y-%m-%d %H:%M')"
  warn "未提供提交信息，使用默认值：$MSG"
  info '（用 -m "..." 或 $GIT_COMMIT_MESSAGE 自定义）'
fi

if ! OUT="$(git_run commit -m "$MSG")"; then
  err "提交失败。"
  printf '%s\n' "$OUT" | while IFS= read -r l; do info "$l"; done
  case "$OUT" in
    *pre-commit*|*husky*|*hook*) info "看起来是 Git 钩子拦截了本次提交，请按上面提示修复后重试。" ;;
  esac
  exit $EXIT_COMMIT
fi
printf '%s\n' "$OUT" | while IFS= read -r l; do info "$l"; done
ok "已提交 $(git_run rev-parse --short HEAD | tr -d '\r\n')"

echo
step "推送到 $REMOTE/$BRANCH"
PUSH_ARGS=(push)
if ! git_run ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
  PUSH_ARGS+=(-u)
  info "远端尚无 '$BRANCH' 分支，将新建并建立跟踪关系（-u）。"
fi
PUSH_ARGS+=("$REMOTE" "$BRANCH")

if OUT="$(git_run "${PUSH_ARGS[@]}")"; then
  ok "推送成功：$REMOTE/$BRANCH"
  exit $EXIT_OK
fi

echo
err "推送失败。"
case "$OUT" in
  *"non-fast-forward"*|*"fetch first"*|*"Updates were rejected"*|*"behind"*)
    info "原因：远端已有你本地没有的提交，直接推送被拒绝（需要先同步）。"
    info "下一步，二选一："
    info "  A. 变基（历史更整洁）：git pull --rebase $REMOTE $BRANCH"
    info "  B. 合并：git pull $REMOTE $BRANCH"
    info "解决冲突后重新运行本脚本即可。"
    exit $EXIT_CONFLICT ;;
  *"does not match any"*|*"not appear to be a git repository"*|*"Could not read from remote"*)
    info "原因：远程地址或分支名不对。检查：git remote -v"
    exit $EXIT_NOREMOTE ;;
  *"Authentication failed"*|*"Permission denied"*|*403*|*401*|*"could not read Username"*|*"terminal prompts disabled"*|*"repository not found"*)
    info "原因：认证失败或没有该仓库的推送权限。"
    info "  1) 确认账号对 $RURL 有写权限；"
    info "  2) HTTPS：让凭据管理器重新登录（git credential-manager github login）；"
    info "  3) SSH：确认公钥已加到 GitHub，且 ssh -T git@github.com 可通。"
    exit $EXIT_NOPERM ;;
  *"unable to access"*|*"Could not resolve host"*|*"Failed to connect"*|*"timed out"*|*SSL*)
    info "原因：网络不可达（DNS / 代理 / 防火墙）。"
    info "如走代理：git config --global http.proxy http://127.0.0.1:<端口>"
    exit $EXIT_PUSH ;;
esac
printf '%s\n' "$OUT" | while IFS= read -r l; do info "$l"; done
exit $EXIT_PUSH
