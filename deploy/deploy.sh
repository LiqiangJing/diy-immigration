#!/bin/sh
# 把当前代码发布到服务器：同步代码 → 安装依赖 → 构建 → 重启。
# 用法：deploy/deploy.sh [服务器地址]    密钥默认 ~/.ssh/diy-key.pem
set -e
HOST="${1:-ubuntu@18.118.124.44}"
KEY="${DIY_KEY:-$HOME/.ssh/diy-key.pem}"
cd "$(dirname "$0")/.."

rsync -az --delete -e "ssh -i $KEY -o BatchMode=yes" \
  --exclude node_modules --exclude .next --exclude .git --exclude /data \
  --exclude '*.pem' --exclude '*.pdf' --exclude '*.docx' --exclude 'IMG_*' --exclude image.png \
  --exclude '.env*.local' --exclude '*.tsbuildinfo' --exclude 'tests/.work' --exclude '__pycache__' \
  ./ "$HOST:/srv/diy-immigration/"

ssh -i "$KEY" -o BatchMode=yes "$HOST" '
  set -e
  cd /srv/diy-immigration
  # 依赖没变就不重装：重装时 node_modules 会先被清空，正在运行的站点这段时间可能出错
  SUM=$(sha256sum package-lock.json | cut -d" " -f1)
  if [ "$(cat node_modules/.lock-sum 2>/dev/null)" != "$SUM" ]; then
    npm ci --no-audit --no-fund >/dev/null
    echo "$SUM" > node_modules/.lock-sum
  fi
  # 构建失败就停在这里，不重启。（以前把输出接给 grep，构建失败也会被当成成功，然后带着坏的构建重启）
  if ! npx next build > /tmp/diy-build.log 2>&1; then
    tail -40 /tmp/diy-build.log
    echo "构建失败，没有重启，线上还是原来的版本"
    exit 1
  fi
  grep -E "Compiled" /tmp/diy-build.log || true
  sudo systemctl restart diy-immigration
  sleep 5
  systemctl is-active diy-immigration
  curl -s -o /dev/null -w "http %{http_code}\n" http://127.0.0.1:3001/
'
