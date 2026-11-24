#!/bin/sh
# 把当前代码发布到服务器：同步代码 → 安装依赖 → 在另一个目录里构建 → 切换过去并重启 → 检查；起不来就自动换回上一个版本。
# 用法：deploy/deploy.sh [服务器地址]    密钥默认 ~/.ssh/diy-key.pem
set -e
HOST="${1:-ubuntu@18.118.124.44}"
KEY="${DIY_KEY:-$HOME/.ssh/diy-key.pem}"
cd "$(dirname "$0")/.."

rsync -az --delete -e "ssh -i $KEY -o BatchMode=yes" \
  --exclude node_modules --exclude .next --exclude '.next-*' --exclude .dist.env --exclude .git --exclude /data \
  --exclude '*.pem' --exclude '*.pdf' --exclude '*.docx' --exclude 'IMG_*' --exclude image.png \
  --exclude '.env*.local' --exclude '.env.local.bak-*' --exclude '*.tsbuildinfo' --exclude 'tests/.work' --exclude '__pycache__' \
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

  # 新版本建在另一个目录里（.next-a / .next-b 轮流用）。构建的这一分钟里，线上还在用原来那个目录，互不影响
  CUR=$(sed -n "s/^DIY_DIST_DIR=//p" .dist.env 2>/dev/null || true)
  if [ "$CUR" = ".next-a" ]; then NEW=.next-b; else NEW=.next-a; fi
  rm -rf "$NEW"
  # 构建失败就停在这里，不重启，线上还是原来的版本
  if ! DIY_DIST_DIR="$NEW" npx next build > /tmp/diy-build.log 2>&1; then
    tail -40 /tmp/diy-build.log
    rm -rf "$NEW"
    echo "构建失败，没有重启，线上还是原来的版本"
    exit 1
  fi
  grep -E "Compiled" /tmp/diy-build.log || true

  # 系统配置（服务、反向代理、备份脚本）和仓库里的不一样时，一并更新
  if ! cmp -s deploy/diy-immigration.service /etc/systemd/system/diy-immigration.service; then
    sudo install -m 644 deploy/diy-immigration.service /etc/systemd/system/diy-immigration.service
    sudo systemctl daemon-reload
    echo "更新了服务配置"
  fi
  if ! sudo cmp -s deploy/backup.sh /usr/local/bin/diy-backup; then
    sudo install -m 755 deploy/backup.sh /usr/local/bin/diy-backup
    echo "更新了备份脚本"
  fi
  if ! sudo cmp -s deploy/Caddyfile /etc/caddy/Caddyfile; then
    if caddy validate --config deploy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
      sudo install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
      sudo systemctl reload caddy
      echo "更新了反向代理配置"
    else
      echo "deploy/Caddyfile 有错，没有更新反向代理配置"
    fi
  fi

  healthy() { # 等应用起来，最多 30 秒
    for i in $(seq 1 30); do
      [ "$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/)" = "200" ] && return 0
      sleep 1
    done
    return 1
  }
  echo "DIY_DIST_DIR=$NEW" > .dist.env
  sudo systemctl restart diy-immigration
  if healthy; then
    echo "已切换到新版本（$NEW）"
    rm -rf .next # 改成轮流目录之前留下的旧构建
  else
    echo "新版本起不来，换回上一个版本。最近的日志："
    sudo journalctl -u diy-immigration -n 20 --no-pager | cut -c1-300
    if [ -n "$CUR" ]; then echo "DIY_DIST_DIR=$CUR" > .dist.env; else rm -f .dist.env; fi
    sudo systemctl restart diy-immigration
    healthy && echo "已换回上一个版本" || echo "换回去之后也没起来，需要马上处理"
    exit 1
  fi
  systemctl is-active diy-immigration
  curl -s -o /dev/null -w "http %{http_code}\n" http://127.0.0.1:3001/
'
