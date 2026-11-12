#!/usr/bin/env bash
# 把 profile node_modules 里的 peer 依赖软链到插件自己的 node_modules/。
# 解决 `dsh plugin add <本地目录>` 用 link: 安装时，Node 从插件真实路径解析 import
# 而报 ERR_MODULE_NOT_FOUND 的问题（@deepseek-ai/schemastery 等）。
set -euo pipefail

DSH_PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MODULES="$SELF_DIR/node_modules"

link() { # $1=profile 内 node_modules 相对路径  $2=插件内 node_modules 相对路径
  local src="$DSH_PROFILE_DIR/node_modules/$1"
  local dst="$NODE_MODULES/$2"
  if [ ! -e "$src" ]; then
    echo "!! 找不到 peer 依赖: $1（请先确认 profile 里装了这个包）" >&2
    return
  fi
  if [ -e "$dst" ]; then
    echo "skip (exists) $2"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  echo "linked $2 -> $1"
}

link "@deepseek-ai/schemastery" "@deepseek-ai/schemastery"
link "@deepseek-ai/cosmokit" "@deepseek-ai/cosmokit"
link "@standard-schema/spec" "@standard-schema/spec"

echo "完成。若你的 profile 不是 desktop，用 DSH_PROFILE_DIR=... $0"
