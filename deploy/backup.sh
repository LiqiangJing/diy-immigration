#!/bin/sh
# 每天备份一次：数据库保留最近 14 天，用户上传的文件做一份镜像。由 cron 调用。
set -e
SRC=/var/lib/diy-immigration
DST=/var/backups/diy-immigration
mkdir -p "$DST"
[ -f "$SRC/app.db" ] || exit 0
sqlite3 "$SRC/app.db" ".backup '$DST/app-$(date +%F).db'"
find "$DST" -name 'app-*.db' -mtime +14 -delete
# 文件只增不删地镜像一份：用户误删后还能从这里找回
[ -d "$SRC/files" ] && rsync -a "$SRC/files/" "$DST/files/"
exit 0
