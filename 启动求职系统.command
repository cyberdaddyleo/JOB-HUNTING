#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "赛博老爸·求职系统 · 本版本为开源版本，禁止商用"
if ! command -v node >/dev/null 2>&1; then
  JOBPILOT_RUNTIME="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
  if [ -x "$JOBPILOT_RUNTIME/node/bin/node" ]; then
    export PATH="$JOBPILOT_RUNTIME/node/bin:$JOBPILOT_RUNTIME/bin/fallback:$PATH"
  else
    echo "请先从 https://nodejs.org 安装 Node.js 22 或更新的 LTS 版本，再重新打开此文件。"
    read -r -p "按回车关闭…" _
    exit 1
  fi
fi
node -e 'if(Number(process.versions.node.split(".")[0])<22){console.error("需要 Node.js 22 或更新版本");process.exit(1)}'
if [ ! -d node_modules ]; then
  echo "首次运行：正在安装项目依赖…"
  if command -v pnpm >/dev/null 2>&1; then pnpm install --frozen-lockfile; else npm install; fi
fi
if [ ! -f dist/index.html ]; then
  if command -v pnpm >/dev/null 2>&1; then pnpm run build; else npm run build; fi
fi
node scripts/launch.mjs
