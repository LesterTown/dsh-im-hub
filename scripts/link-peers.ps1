# 把 profile node_modules 里的 peer 依赖 junction 到插件自己的 node_modules/。
# Windows 上 symlink 需要管理员权限，junction 不需要，所以用 junction。
# 解决 `dsh plugin add <本地目录>` 用 link: 安装时，Node 从插件真实路径解析 import
# 而报 ERR_MODULE_NOT_FOUND 的问题（@deepseek-ai/schemastery 等）。
param(
  [string]$DSH_PROFILE_DIR = "$env:USERPROFILE\.dsh\profiles\desktop"
)
$ErrorActionPreference = "Stop"
$selfDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nodeModules = Join-Path $selfDir "node_modules"

function Link-Peer([string]$srcRel, [string]$dstRel) {
  $src = Join-Path $DSH_PROFILE_DIR ("node_modules\" + ($srcRel -replace "/", "\"))
  $dst = Join-Path $nodeModules ($dstRel -replace "/", "\")
  if (-not (Test-Path $src)) {
    Write-Warning "找不到 peer 依赖: $srcRel（请先确认 profile 里装了这个包）"
    return
  }
  if (Test-Path $dst) {
    Write-Host "skip (exists) $dstRel"
    return
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  New-Item -ItemType Junction -Path $dst -Target $src | Out-Null
  Write-Host "linked $dstRel -> $srcRel"
}

Link-Peer "@deepseek-ai/schemastery" "@deepseek-ai/schemastery"
Link-Peer "@deepseek-ai/cosmokit" "@deepseek-ai/cosmokit"
Link-Peer "@standard-schema/spec" "@standard-schema/spec"

Write-Host "完成。若你的 profile 不是 desktop，用 .\link-peers.ps1 -DSH_PROFILE_DIR <路径>"
