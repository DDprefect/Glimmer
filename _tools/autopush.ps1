# =============================================================================
#  autopush.ps1 —— 一键「暂存 → 提交 → 推送」
#
#  用法（在项目根目录的 PowerShell 里执行）：
#     .\autopush.ps1                          # 用默认提交信息
#     .\autopush.ps1 -Message "修复秒位滚动"   # 指定提交信息
#     .\autopush.ps1 -Message "更新作品" -Branch dev -Remote upstream
#     $env:GIT_COMMIT_MESSAGE="来自环境变量"; .\autopush.ps1    # 环境变量也可以
#     .\autopush.ps1 -DryRun                  # 只预演，不真正提交/推送
#
#  依赖 / 权限 / 说明见本文件末尾的「使用说明」段，或运行 .\autopush.ps1 -Help
#
#  退出码：0 = 成功或无可提交；非 0 = 失败（分类见脚本内 $Exit* 常量）
# =============================================================================

[CmdletBinding()]
param(
    # 提交信息。优先级：-Message > $env:GIT_COMMIT_MESSAGE > 默认值
    [string]$Message = "",

    # 远程名，默认 origin（可用 $env:GIT_REMOTE 覆盖）
    [string]$Remote = "",

    # 分支名，默认当前所在分支（可用 $env:GIT_BRANCH 覆盖）
    [string]$Branch = "",

    # 指定要纳入本次提交的路径；不传则用 `git add -A` 暂存全部变更
    [string[]]$Path = @(),

    # 只预演：打印将要执行的动作，不实际 add/commit/push
    [switch]$DryRun,

    # 允许对「本次提交只含未跟踪文件」这类情况继续（默认也允许，仅作显式声明）
    [switch]$AllowNewFiles,

    # 显示帮助后退出
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# 控制台编码修正
#   脚本本身与 git 的输出都是 UTF-8，而 Windows PowerShell 5.1 默认按系统 ANSI
#   （简体中文 = GBK）处理外部命令输出与部分控制台写入，中文会变乱码。
#   这里把输入输出编码统一为 UTF-8，并把控制台代码页切到 65001。
# ---------------------------------------------------------------------------
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
    $OutputEncoding           = [System.Text.Encoding]::UTF8
} catch { <# 极少数宿主不允许改编码，忽略即可 #> }
try {
    if ($env:OS -eq "Windows_NT" -and -not $env:GIT_AUTOPUSH_NO_CHCP) {
        # 只在交互式控制台里改代码页；重定向到文件时跳过，避免多余输出
        if (-not [Console]::IsOutputRedirected) { & chcp.com 65001 | Out-Null }
    }
} catch { }

# ---------------------------------------------------------------------------
# 退出码约定（便于被其它脚本/CI 判断具体失败原因）
# ---------------------------------------------------------------------------
$ExitOK          = 0     # 成功（含「无可提交」的正常退出）
$ExitBadArgs     = 2     # 参数不合法
$ExitNotRepo     = 3     # 当前目录不是 Git 仓库
$ExitNoGit       = 4     # 找不到 git 可执行文件
$ExitNoUser      = 5     # 未配置 user.name / user.email
$ExitCommitFail  = 6     # 提交失败（含 pre-commit 钩子拦截）
$ExitNoRemote    = 7     # 远程不存在
$ExitNoPerm      = 8     # 无推送权限 / 认证失败
$ExitConflict    = 9     # 远端有新提交，需先 pull/rebase
$ExitPushFail    = 10    # 其它推送失败

# ---------------------------------------------------------------------------
# 输出与日志：既打印到控制台，也（可选）追加到文件
#   $env:GIT_AUTOPUSH_LOG = "路径" 可开启文件日志
# ---------------------------------------------------------------------------
$script:LogFile = $env:GIT_AUTOPUSH_LOG

function Write-Step  { param([string]$m) $line = "[步骤] $m"; Write-Host $line -ForegroundColor Cyan;    Add-Log $line }
function Write-Ok    { param([string]$m) $line = "[完成] $m"; Write-Host $line -ForegroundColor Green;   Add-Log $line }
function Write-Warn2 { param([string]$m) $line = "[注意] $m"; Write-Host $line -ForegroundColor Yellow;  Add-Log $line }
function Write-Err   { param([string]$m) $line = "[错误] $m"; Write-Host $line -ForegroundColor Red;     Add-Log $line }
function Write-Info  { param([string]$m) Write-Host "       $m" -ForegroundColor DarkGray; Add-Log "       $m" }

function Add-Log {
    param([string]$m)
    if (-not $script:LogFile) { return }
    try {
        $stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        Add-Content -LiteralPath $script:LogFile -Value "$stamp  $m" -Encoding UTF8
    } catch { <# 日志写不进去不应影响主流程 #> }
}

# ---------------------------------------------------------------------------
# 帮助
# ---------------------------------------------------------------------------
function Show-Help {
    Write-Host ""
    Write-Host "autopush.ps1 —— 暂存 → 提交 → 推送" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "参数：" -ForegroundColor White
    Write-Host "  -Message [文本]     提交信息（也可用环境变量 GIT_COMMIT_MESSAGE）"
    Write-Host "  -Remote  [名称]     远程名，默认 origin（也可用 GIT_REMOTE）"
    Write-Host "  -Branch  [名称]     分支名，默认当前分支（也可用 GIT_BRANCH）"
    Write-Host "  -Path    [路径...]  只提交指定路径，默认全部变更"
    Write-Host "  -DryRun             只预演，不实际提交与推送"
    Write-Host "  -Help               显示本帮助"
    Write-Host ""
    Write-Host "环境变量：" -ForegroundColor White
    Write-Host "  GIT_EXE             指定 git.exe 路径（默认自动查找）"
    Write-Host "  GIT_COMMIT_MESSAGE  提交信息"
    Write-Host "  GIT_REMOTE          远程名"
    Write-Host "  GIT_BRANCH          分支名"
    Write-Host "  GIT_AUTOPUSH_LOG    日志文件路径，设置后追加写日志"
    Write-Host ""
    Write-Host "退出码：" -ForegroundColor White
    Write-Host "  0 成功  2 参数错  3 非仓库  4 无 git  5 未配用户信息"
    Write-Host "  6 提交失败  7 远程不存在  8 无权限  9 远端有新提交  10 推送失败"
    Write-Host ""
    exit $ExitOK
}

if ($Help) { Show-Help }

# ---------------------------------------------------------------------------
# 0. 定位 git.exe
#    Windows 上 git 未必在 PATH（便携版就是这种情况），所以按序探测：
#      1) $env:GIT_EXE 显式指定
#      2) PATH 里的 git
#      3) WorkBuddy 自带 PortableGit（取版本号最大的那个）
#      4) 常见的系统安装位置
# ---------------------------------------------------------------------------
function Resolve-Git {
    if ($env:GIT_EXE -and (Test-Path -LiteralPath $env:GIT_EXE)) { return $env:GIT_EXE }

    $onPath = Get-Command git -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    $portableRoot = Join-Path $env:USERPROFILE ".workbuddy\binaries\PortableGit\versions"
    if (Test-Path -LiteralPath $portableRoot) {
        $cand = Get-ChildItem -LiteralPath $portableRoot -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending |
                ForEach-Object { Join-Path $_.FullName "mingw64\bin\git.exe" } |
                Where-Object { Test-Path -LiteralPath $_ } |
                Select-Object -First 1
        if ($cand) { return $cand }
    }

    $fixed = @(
        "$env:ProgramFiles\Git\cmd\git.exe",
        "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
        "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
    )
    foreach ($f in $fixed) { if (Test-Path -LiteralPath $f) { return $f } }

    return $null
}

$git = Resolve-Git
if (-not $git) {
    Write-Err "找不到 git。请安装 Git，或用 `$env:GIT_EXE` 指定 git.exe 的完整路径。"
    exit $ExitNoGit
}
Write-Info "git: $git"

# 统一的 git 调用封装：捕获输出与退出码，同时把命令本身写进日志（便于排查）
#   PS 5.1 用 ANSI 解码外部命令输出，中文路径会变成乱码，所以把每行按
#   Latin-1 → UTF-8 还原一遍（仅当该行确实不是合法 UTF-8 时才动手）。
function Repair-Encoding {
    param([string]$s)
    if ($null -eq $s) { return $s }
    try {
        $bytes = [System.Text.Encoding]::GetEncoding(28591).GetBytes($s)   # Latin-1
        $fixed = [System.Text.Encoding]::UTF8.GetString($bytes)
        # 还原后若出现替换字符（U+FFFD）说明原本就不是 UTF-8，保留原样
        if ($fixed -notmatch "\uFFFD") { return $fixed }
    } catch { }
    return $s
}

function Invoke-Git {
    param(
        # 两种写法都支持：
        #   Invoke-Git status --porcelain           （位置参数）
        #   Invoke-Git -GitArgs @("-c","x","y")     （数组，用于以 - 开头的 git 选项）
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$GitArgs,
        [switch]$Quiet       # 静默：不把 stdout 打到控制台
    )
    Add-Log ("  `$ git " + ($GitArgs -join " "))
    # git 会把 warning（例如 LF/CRLF 提示）写到 stderr。在 $ErrorActionPreference="Stop"
    # 下，2>&1 合并进来的这些行会被 PowerShell 当成 ErrorRecord 并升级为终止错误，
    # 于是脚本在「只是有个 warning」的情况下直接退出。这里临时切到 Continue，
    # 把输出当纯文本收下来，判定成功与否只看退出码。
    $prevEA = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $raw = & $git @GitArgs 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEA
    }
    Add-Log ("  -> exit " + $code)
    $out = @($raw | ForEach-Object { Repair-Encoding($_.ToString()) })
    if (-not $Quiet -and $out) {
        $out | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray; Add-Log "       $_" }
    }
    return @{ Output = $out; Code = $code }
}

# ---------------------------------------------------------------------------
# 1. 参数解析：命令行 > 环境变量 > 默认值
# ---------------------------------------------------------------------------
if (-not $Message) { $Message = $env:GIT_COMMIT_MESSAGE }
if (-not $Remote)  { $Remote  = if ($env:GIT_REMOTE) { $env:GIT_REMOTE } else { "origin" } }
if (-not $Branch)  { $Branch  = $env:GIT_BRANCH }   # 留空 = 稍后取当前分支

Write-Host ""
Write-Step "检查仓库状态"

# ---------------------------------------------------------------------------
# 2. 是不是 Git 仓库
# ---------------------------------------------------------------------------
$probe = Invoke-Git rev-parse --is-inside-work-tree -Quiet
if ($probe.Code -ne 0 -or ($probe.Output -join "").Trim() -ne "true") {
    Write-Err "当前目录不是 Git 仓库（$(Get-Location)）。请先 cd 到项目目录，或执行 git init。"
    exit $ExitNotRepo
}

# ---------------------------------------------------------------------------
# 3. 分支名：未指定则取当前分支；仓库处于 detached HEAD 时给出明确提示
# ---------------------------------------------------------------------------
if (-not $Branch) {
    $cur = Invoke-Git rev-parse --abbrev-ref HEAD -Quiet
    $Branch = ($cur.Output -join "").Trim()
    if ($Branch -eq "HEAD" -or -not $Branch) {
        Write-Err "当前处于 detached HEAD（未在任何分支上）。请用 -Branch 指定分支名，或先 git checkout 一个分支。"
        exit $ExitBadArgs
    }
}
Write-Info "远程: $Remote"
Write-Info "分支: $Branch"

# 分支名合法性（避免注入奇怪参数或写错时远程报一堆看不懂的错）
if ($Branch -notmatch '^[A-Za-z0-9._/][A-Za-z0-9._/-]*$' -or $Branch -match '\.\.') {
    Write-Err "分支名 '$Branch' 看起来不合法。"
    exit $ExitBadArgs
}

# ---------------------------------------------------------------------------
# 4. 用户信息：没配 user.name/email 时 git commit 会直接失败，提前拦住更好懂
# ---------------------------------------------------------------------------
$un = (Invoke-Git config user.name  -Quiet).Output -join ""
$ue = (Invoke-Git config user.email -Quiet).Output -join ""
if (-not $un.Trim() -or -not $ue.Trim()) {
    Write-Err "未配置提交者信息，git 无法提交。请先执行（--global 可选）："
    Write-Info 'git config --global user.name  "你的名字"'
    Write-Info 'git config --global user.email "你的邮箱"'
    exit $ExitNoUser
}
Write-Info "提交者: $($un.Trim()) [$($ue.Trim())]"

# ---------------------------------------------------------------------------
# 5. 远程是否存在
#    注意别只看 get-url 的输出：远程不存在时 git 会把 "error: No such remote"
#    写到 stderr，被 2>&1 合并后会被误当成一个「非空的 URL」。所以先用
#    git remote 列表做权威判断，再取 URL。
# ---------------------------------------------------------------------------
$remotes = @((& $git remote 2>$null) | Where-Object { $_.Trim() })
if ($remotes -notcontains $Remote) {
    Write-Err "远程 '$Remote' 不存在。当前已配置的远程："
    Write-Info ($(if ($remotes.Count) { $remotes -join ", " } else { "(无)" }))
    Write-Info "可用：git remote add $Remote [仓库地址]"
    exit $ExitNoRemote
}

$remoteUrl = (((& $git remote get-url $Remote 2>$null) -join "").Trim())
if (-not $remoteUrl) {
    Write-Err "远程 '$Remote' 没有可用的地址，请检查 git remote -v。"
    exit $ExitNoRemote
}
Write-Info "远程地址: $remoteUrl"

# 工作目录固定为仓库根，避免在子目录执行时 add 到意外路径。
# 这里刻意不用 `rev-parse --show-toplevel`：它返回绝对路径，含中文时会被
# Windows PowerShell 5.1 按 ANSI 解码成乱码。改从脚本自身位置推导 ——
# 脚本固定在 <仓库根>/_tools/ 下，向上一级即仓库根，全程不依赖 git 输出。
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$candidateRoot = Split-Path -Parent $scriptDir
if ($candidateRoot -and (Test-Path -LiteralPath $candidateRoot) -and
    (Test-Path -LiteralPath (Join-Path $candidateRoot ".git"))) {
    Set-Location -LiteralPath $candidateRoot
    Write-Info "仓库根: $candidateRoot"
} else {
    Write-Info "仓库根: $(Get-Location)（脚本未置于 _tools/ 下，沿用当前目录）"
}

# ---------------------------------------------------------------------------
# 6. 工作区状态：有没有可提交的内容
#    注意要分别看「已跟踪文件的改动」和「未跟踪文件」——
#    git diff --quiet 只反映前者，仓库里全是新文件时它也会说「干净」。
# ---------------------------------------------------------------------------
$allStatus = (Invoke-Git -GitArgs @("status", "--porcelain") -Quiet).Output -join "`n"

if (-not $allStatus.Trim()) {
    Write-Ok "工作区干净，没有需要提交的变更。"
    # 顺手提示是否有未推送的历史提交，避免「以为推过了」
    $ahead = (Invoke-Git rev-list --count "$Remote/$Branch..HEAD" -Quiet).Output -join ""
    if ($ahead -and [int]$ahead -gt 0) {
        Write-Warn2 "不过本地领先 $Remote/$Branch $ahead 个提交尚未推送。"
        Write-Info "如需只推送这些提交，把它加入白名单：git push $Remote $Branch"
    }
    exit $ExitOK
}

Write-Info "检测到以下变更："
$allStatus -split "`n" | Where-Object { $_.Trim() } | ForEach-Object { Write-Info "  $_" }

# ---------------------------------------------------------------------------
# 7. 暂存
# ---------------------------------------------------------------------------
Write-Host ""
Write-Step "暂存变更"

# DryRun 不落地任何状态：只看「将会提交什么」，不真的 add（否则会污染暂存区）
if ($DryRun) {
    $planArgs = @("add", "--dry-run")
    if ($Path.Count -gt 0) { $planArgs += @("--") + $Path } else { $planArgs += "-A" }
    $plan = (Invoke-Git -GitArgs $planArgs -Quiet).Output
    Write-Info "本次计划暂存："
    $plan | Where-Object { $_.Trim() } | ForEach-Object { Write-Info "  $_" }
    Write-Host ""
    Write-Step "提交与推送（预演）"
    Write-Warn2 "DryRun 模式：以下动作不会真正执行，暂存区保持原样。"
    if (-not $Message) { $Message = 'chore: 更新站点内容 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
    Write-Info "git commit -m `"$Message`""
    Write-Info "git push $Remote $Branch"
    exit $ExitOK
}

if ($Path.Count -gt 0) {
    foreach ($p in $Path) {
        $r = Invoke-Git -GitArgs @("add", "--", $p)
        if ($r.Code -ne 0) { Write-Err "暂存 '$p' 失败。"; exit $ExitCommitFail }
    }
} else {
    $r = Invoke-Git -GitArgs @("add", "-A")
    if ($r.Code -ne 0) { Write-Err "暂存失败。"; exit $ExitCommitFail }
}

# 暂存后再确认一次：可能变更全被 .gitignore 忽略掉了
$staged = (Invoke-Git -GitArgs @("diff", "--cached", "--name-only") -Quiet).Output -join "`n"
if (-not $staged.Trim()) {
    Write-Warn2 "暂存区为空 —— 变更可能都被 .gitignore 忽略了。未做提交。"
    exit $ExitOK
}
Write-Info "本次将提交 $((($staged -split "`n") | Where-Object { $_.Trim() }).Count) 个文件"
($staged -split "`n") | Where-Object { $_.Trim() } | ForEach-Object { Write-Info "  + $_" }

# ---------------------------------------------------------------------------
# 8. 提交
# ---------------------------------------------------------------------------
Write-Host ""
Write-Step "提交"

# 提交信息兜底：带时间戳，避免一堆 "update" 无法回溯
if (-not $Message) {
    $Message = 'chore: 更新站点内容 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
    Write-Warn2 "未提供提交信息，使用默认值：$Message"
    Write-Info "（用 -Message \"...\" 或 `$env:GIT_COMMIT_MESSAGE 自定义）"
}

$c = Invoke-Git -GitArgs @("commit", "-m", $Message)
if ($c.Code -ne 0) {
    $txt = $c.Output -join "`n"
    Write-Err "提交失败。"
    if ($txt -match "pre-commit|husky|hook") {
        Write-Info "看起来是 Git 钩子（pre-commit）拦截了本次提交，请按上面的提示修复后重试。"
    } elseif ($txt -match "empty") {
        Write-Info "没有内容可提交。"
    }
    exit $ExitCommitFail
}
$head = ((Invoke-Git rev-parse --short HEAD -Quiet).Output -join "").Trim()
Write-Ok "已提交 $head"

# ---------------------------------------------------------------------------
# 9. 推送
# ---------------------------------------------------------------------------
Write-Host ""
Write-Step "推送到 $Remote/$Branch"

# 先探测远端分支是否存在，决定要不要 -u
$probeRemote = (Invoke-Git -GitArgs @("ls-remote", "--exit-code", "--heads", $Remote, $Branch) -Quiet)
$remoteBranchExists = ($probeRemote.Code -eq 0)

$pushArgs = @("push")
if (-not $remoteBranchExists) {
    $pushArgs += "-u"
    Write-Info "远端尚无 '$Branch' 分支，将新建并建立跟踪关系（-u）。"
}
$pushArgs += @($Remote, $Branch)

$p = Invoke-Git -GitArgs $pushArgs
if ($p.Code -eq 0) {
    Write-Ok "推送成功：$Remote/$Branch"
    exit $ExitOK
}

# --- 失败分类：把 git 的原始报错翻译成「人话 + 下一步怎么做」 ---
$err = ($p.Output -join "`n")
Write-Host ""
Write-Err "推送失败。"

if ($err -match "non-fast-forward|fetch first|rejected.*behind|Updates were rejected") {
    Write-Info "原因：远端已有你的本地没有的提交，直接推送被拒绝（需要先同步）。"
    Write-Info "下一步，二选一："
    Write-Info "  A. 变基（历史更整洁，推荐用于个人分支）：git pull --rebase $Remote $Branch"
    Write-Info "  B. 合并：git pull $Remote $Branch"
    Write-Info "解决冲突后重新运行本脚本即可。"
    exit $ExitConflict
}

if ($err -match "does not match any|does not appear to be a git repository|Could not read from remote") {
    Write-Info "原因：远程地址或分支名不对，或网络/代理不可达。"
    Write-Info "检查：git remote -v ；以及分支名是否拼写正确。"
    exit $ExitNoRemote
}

if ($err -match "Authentication failed|Permission denied|403|401|could not read Username|terminal prompts disabled|repository not found") {
    Write-Info "原因：认证失败或没有该仓库的推送权限。"
    Write-Info "常见处理："
    Write-Info "  1) 确认账号对 $remoteUrl 有写权限；"
    Write-Info "  2) HTTPS 方式：让 Git Credential Manager 重新弹窗登录——"
    Write-Info "     先执行 git credential-manager github login，或删掉旧凭据后重试；"
    Write-Info "  3) SSH 方式：确认已把公钥加到 GitHub，且 ssh -T git@github.com 可通。"
    exit $ExitNoPerm
}

if ($err -match "unable to access|Could not resolve host|Failed to connect|timed out|SSL") {
    Write-Info "原因：网络不可达（DNS / 代理 / 防火墙）。"
    Write-Info "检查网络，或配置代理：git config --global http.proxy http://127.0.0.1:[端口]"
    exit $ExitPushFail
}

Write-Info "原始报错已在上方输出，请据此排查。"
exit $ExitPushFail
