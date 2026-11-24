#!/bin/sh
# 每天备份一次：数据库保留最近 14 天；用户上传的文件做一份镜像，用户删掉的文件再留 14 天。由 cron 调用。
set -e
SRC=/var/lib/diy-immigration
DST=/var/backups/diy-immigration
mkdir -p "$DST"
[ -f "$SRC/app.db" ] || exit 0
sqlite3 "$SRC/app.db" ".backup '$DST/app-$(date +%F).db'"
find "$DST" -maxdepth 1 -name 'app-*.db' -mtime +14 -delete
# 文件：镜像和线上保持一致。线上已经删掉的文件先挪到 deleted/<日期>/ 里（误删后 14 天内还能找回），到期清掉。
# 隐私政策里写的是「备份里的副本约 14 天后清除」，这里要和它一致。
if [ -d "$SRC/files" ]; then
  mkdir -p "$DST/files" "$DST/deleted"
  rsync -a --delete --backup --backup-dir="$DST/deleted/$(date +%F)" "$SRC/files/" "$DST/files/"
  find "$DST/deleted" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
fi
exit 0
