#!/bin/sh
# 把当前代码发布到服务器：同步代码 → 安装依赖 → 构建 → 重启。
# 用法：deploy/deploy.sh [服务器地址]    密钥默认 ~/.ssh/diy-key.pem
set -e
HOST="${1:-ubuntu@3.14.73.66}"
KEY="${DIY_KEY:-$HOME/.ssh/diy-key.pem}"
cd "$(dirname "$0")/.."

rsync -az --delete -e "ssh -i $KEY -o BatchMode=yes" \
  --exclude node_modules --exclude .next --exclude .git --exclude data \
  --exclude '*.pem' --exclude '*.pdf' --exclude image.png \
  --exclude '.env*.local' --exclude '*.tsbuildinfo' \
  ./ "$HOST:/srv/diy-immigration/"

ssh -i "$KEY" -o BatchMode=yes "$HOST" '
  set -e
  cd /srv/diy-immigration
  npm ci --no-audit --no-fund >/dev/null
  npx next build | grep -E "Compiled|rror|Failed"
  sudo systemctl restart diy-immigration
  sleep 5
  systemctl is-active diy-immigration
  curl -s -o /dev/null -w "http %{http_code}\n" http://127.0.0.1:3001/
'
