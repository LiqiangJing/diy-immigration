#!/bin/sh
# 一键回归：构建 → 起一个临时的测试站（端口 3999，数据放在 tests/.work，不碰真实数据）→ 跑测试 → 关掉。
#   tests/run.sh          全部
#   tests/run.sh quick    不跑要调用模型和外部学术接口的两组（t_chat、t_scholar）
# 需要：python3 + playwright（pip install playwright && playwright install chromium）、Pillow、requests、poppler-utils（pdftotext 等）。
# 调模型的两组走本机登录的 Claude Code（LLM_PROVIDER=cli），不花线上的 API 额度。
ROOT=$(cd "$(dirname "$0")/.." && pwd)
W="${TEST_WORK:-$ROOT/tests/.work}"
export TEST_WORK="$W"
mkdir -p "$W/shots"
cd "$ROOT" || exit 1
npx tsc --noEmit -p . || exit 1
npx next build > "$W/build.log" 2>&1 || { tail -30 "$W/build.log"; exit 1; }
python3 tests/e2e/make_fixtures.py || exit 1
rm -rf "$W/data"; mkdir -p "$W/data"
# 3999 端口上还有上一次留下的测试站的话，这次的起不来，测试会打到旧代码上：先确认端口是空的
on_port() { ss -ltnp 2>/dev/null | sed -n 's/.*:3999 .*pid=\([0-9]*\).*/\1/p' | head -1; }
[ -n "$(on_port)" ] && { echo "3999 端口被占用（进程 $(on_port)），请先把它停掉"; exit 1; }
DATA_DIR="$W/data" LLM_PROVIDER=cli DEV_LOGIN_CODE=1 npx next start -p 3999 > "$W/server.log" 2>&1 &
SERVER=$!
# npx 起的服务是它的子进程，只杀 npx 的话它会留下来：按端口再找一次
trap 'kill $SERVER 2>/dev/null; P=$(on_port); [ -n "$P" ] && kill $P 2>/dev/null' EXIT
sleep 6
[ -n "$(on_port)" ] || { echo "测试站没起来："; tail -20 "$W/server.log"; exit 1; }
FAILED=""
run() { echo; echo "=== $*"; "$@" > "$W/last.out" 2>&1; CODE=$?; grep -E "^FAIL|passed, |Traceback" "$W/last.out"; [ $CODE -ne 0 ] && FAILED="$FAILED $2"; }
for t in merge actions assistant price normalize scholar packet; do
  case $t in scholar) A="$W/fixtures/scholar_page.html";; packet) A="$W/unit";; *) A="";; esac
  run tests/unit/run.sh $t.test.ts $A
done
cd tests/e2e
for t in api_test api_test2 t_profile t_cases t_account t_sync t_new t_assistant; do run python3 $t.py; done
if [ "$1" != "quick" ]; then for t in t_chat t_scholar; do run python3 $t.py; done; fi
echo
[ -z "$FAILED" ] && echo "全部通过" || { echo "有失败的：$FAILED（详细输出见 $W/last.out，每组跑完会被下一组覆盖，可单独重跑那一组）"; exit 1; }
