#!/bin/sh
# 用法：tests/unit/run.sh 测试文件.ts [参数...]
# 把测试和它引用的项目代码打成一个文件再用 node 跑。打包用 esbuild（第一次会由 npx 自动下载）。
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
W="${TEST_WORK:-$ROOT/tests/.work}"
mkdir -p "$W/unit"
T="$1"; shift
npx --yes esbuild@0.24.2 "$HERE/$T" --bundle --platform=node --format=cjs --log-level=warning \
  --alias:@="$ROOT" --external:pdf-lib --outfile="$W/unit/$(basename "$T" .ts).cjs"
NODE_PATH="$ROOT/node_modules" node "$W/unit/$(basename "$T" .ts).cjs" "$@"
