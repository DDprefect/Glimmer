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

# 同时接受两套写法：本脚本的短选项（-m/-r/-b/-n/-h）与 autopush.ps1 的长选项
# （-Message/-Remote/-Branch/-DryRun/-Help）。这样 autopush.bat 可以把参数
# 原样透传给本脚本，不必在 bat 里做选项名转换。
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message|-Message) MSG="$2"; shift 2 ;;
    -r|--remote|-Remote)   REMOTE="$2"; shift 2 ;;
    -b|--branch|-Branch)   BRANCH="$2"; shift 2 ;;
    -n|--dry-run|-DryRun)  DRY=1; shift ;;
    -h|--help|-Help)       sed -n '2,16p' "$0"; exit $EXIT_OK ;;
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

# ---- 补全 PATH：非交互启动时可能缺 MSYS 系统目录与 mingw64/bin ----
#   从 PowerShell/cmd 直接调 `bash.exe script.sh` 属于非登录、非交互 shell，
#   不会读 /etc/profile，于是 PATH 里既没有 /usr/bin（tr、grep、sed 等
#   coreutils）也没有 /mingw64/bin（git），脚本会半路炸在
#   "tr: command not found"。这里用 MSYS 的内部路径直接补齐 —— 它们是 bash
#   自己认的虚拟路径，不经过 Windows 路径转换，含中文的安装目录也不会坏。
#   —— 2026-10-01 实测踩坑，别删。
for _d in /mingw64/bin /usr/bin /bin; do
  case ":$PATH:" in
    *":$_d:"*) ;;
    *) [ -d "$_d" ] && PATH="$_d:$PATH" ;;
  esac
done
export PATH

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

# ---- 确保能找到 HTTPS 远程 helper（git-remote-https） ----
# 便携版 git 的默认 exec-path（libexec/git-core）只有 shell 脚本，没有
# git-remote-https.exe（它在 mingw64/bin）。缺它会让 `git push` 静默挂死。
# 若默认 exec-path 没有、但 git 同目录有，则用 Windows 路径显式指定
# GIT_EXEC_PATH —— 中文路径必须走 Windows 格式，PATH 回退会在 CJK 目录处坏掉。
if [ -z "${GIT_EXEC_PATH:-}" ]; then
  _gep="$("$GIT" --exec-path 2>/dev/null)"
  if [ -n "$_gep" ] && ! ls "$_gep"/git-remote-https* >/dev/null 2>&1; then
    _gdir="$(cd "$(dirname "$GIT")" && pwd)"
    if ls "$_gdir"/git-remote-https* >/dev/null 2>&1; then
      _gep_win="$(cygpath -w "$_gdir" 2>/dev/null)"
      [ -z "$_gep_win" ] && _gep_win="$_gdir"
      export GIT_EXEC_PATH="$_gep_win"
      info "GIT_EXEC_PATH 设为: $GIT_EXEC_PATH（默认 exec-path 缺 git-remote-https）"
    fi
  fi
fi

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
  case "$AHEAD" in ''|*[!0-9]*) AHEAD=0 ;; esac
  if [ "$AHEAD" -gt 0 ]; then
    echo
    step "检测到本地领先 $REMOTE/$BRANCH $AHEAD 个提交，自动补推"
    PUSH_ARGS=(push "$REMOTE" "$BRANCH")
    if OUT="$(GIT_CONFIG_NOSYSTEM=1 git_run "${PUSH_ARGS[@]}")"; then
      ok "推送成功：$REMOTE/$BRANCH"
    else
      err "推送失败。"
      printf '%s\n' "$OUT" | while IFS= read -r l; do [ -n "$l" ] && info "$l"; done
      info "可手动重试：GIT_CONFIG_NOSYSTEM=1 git push $REMOTE $BRANCH"
      exit $EXIT_PUSH
    fi
  fi
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
if ! GIT_CONFIG_NOSYSTEM=1 git_run ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
  PUSH_ARGS+=(-u)
  info "远端尚无 '$BRANCH' 分支，将新建并建立跟踪关系（-u）。"
fi
PUSH_ARGS+=("$REMOTE" "$BRANCH")

if OUT="$(GIT_CONFIG_NOSYSTEM=1 git_run "${PUSH_ARGS[@]}")"; then
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
