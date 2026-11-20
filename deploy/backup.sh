#!/bin/sh
# 每天备份一次数据库，保留最近 14 天。由 cron 调用。
set -e
SRC=/var/lib/diy-immigration/app.db
DST=/var/backups/diy-immigration
[ -f "$SRC" ] || exit 0
sqlite3 "$SRC" ".backup '$DST/app-$(date +%F).db'"
find "$DST" -name 'app-*.db' -mtime +14 -delete
