"""接口测试第二组：这次加固的部分（验证码次数、跨站请求、账号对不上、并发、停止后的扣费、超大请求）。"""
import json, os, sqlite3, sys, threading, time, uuid
import requests

BASE = os.environ.get("BASE", "http://127.0.0.1:3999")
S = os.environ.get("TEST_WORK") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".work")
DB = os.environ.get("DB", os.path.join(S, "data", "app.db"))
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), str(detail)))
    print(("PASS " if cond else "FAIL ") + name + (f"  -- {str(detail)[:300]}" if (detail and not cond) else ""), flush=True)
def db(sql, args=()):
    con = sqlite3.connect(DB, timeout=10)
    try:
        rows = con.execute(sql, args).fetchall(); con.commit(); return rows
    finally:
        con.close()
def mail(): return f"h{uuid.uuid4().hex[:10]}@example.com"
def login(email=None, credits=None, ip=None):
    email = email or mail(); s = requests.Session()
    h = {"x-forwarded-for": ip} if ip else {}
    r = s.post(f"{BASE}/api/auth/request", json={"email": email}, headers=h); assert r.status_code == 200, r.text
    r = s.post(f"{BASE}/api/auth/verify", json={"email": email, "code": r.json()["devCode"]}); assert r.status_code == 200, r.text
    if credits is not None: db("update users set credits=? where email=?", (credits, email))
    return s, email
rip = lambda: f"10.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"

# ---------- 邮箱校验：超长的输入要立刻被拒绝 ----------
t = time.time()
r = requests.post(f"{BASE}/api/auth/request", json={"email": "a@" + "." * 3000 + "@"}, headers={"x-forwarded-for": rip()})
check("email: crafted long address rejected quickly", r.status_code in (400, 413) and time.time() - t < 1, (r.status_code, time.time() - t))
t = time.time()
r = requests.post(f"{BASE}/api/auth/request", data=json.dumps({"email": "a@" + "." * 200000 + "@"}), headers={"Content-Type": "application/json", "x-forwarded-for": rip()})
check("email: 200 KB body refused without tying up the server", r.status_code == 413 and time.time() - t < 1, (r.status_code, time.time() - t))
for good in ["a@b.co", "first.last+tag@sub.example.com", "USER@Example.COM"]:
    r = requests.post(f"{BASE}/api/auth/request", json={"email": good.replace("a@b.co", f"{uuid.uuid4().hex[:6]}@b.co").replace("USER", uuid.uuid4().hex[:6]).replace("first", uuid.uuid4().hex[:6])}, headers={"x-forwarded-for": rip()})
    check(f"email: ordinary address accepted ({good})", r.status_code == 200, r.text)
for bad in ["a@b", "@b.com", "a b@c.com", "a@@b.com", "a@b.c", "plain", ""]:
    r = requests.post(f"{BASE}/api/auth/request", json={"email": bad}, headers={"x-forwarded-for": rip()})
    check(f"email: invalid address rejected ({bad!r})", r.status_code == 400, r.text)

# ---------- 验证码的次数上限 ----------
def ask(e, ip=None, sess=None):
    db("update login_codes set sent_at=0 where email=?", (e,))  # 跳过「一分钟内不重发」
    return (sess or requests).post(f"{BASE}/api/auth/request", json={"email": e}, headers={"x-forwarded-for": ip or rip()})

# 同一个邮箱 + 同一个 IP：一小时 4 次；这时邮箱的主人在别的网络上仍然要得到
e = mail(); bad_ip = rip()
codes = [ask(e, bad_ip).status_code for _ in range(6)]
check("code: one machine gets at most 4 codes an hour for an address", codes == [200] * 4 + [429] * 2, codes)
r = ask(e, bad_ip)
check("code: the refusal explains itself", "次数太多" in r.json().get("error", "") and "密码" in r.json().get("error", ""), r.text)
check("code: the owner on another network still gets one", ask(e).status_code == 200)
# 同一个邮箱所有 IP 合计：一小时 8 次
e = mail(); codes = [ask(e).status_code for _ in range(10)]
check("code: an address gets at most 8 codes an hour in total", codes == [200] * 8 + [429] * 2, codes)

# 登录过这个账号的浏览器单独计数：别人把这个邮箱的名额用光了，它照样要得到
s, email = login(ip=rip())
check("code: a browser that logged in is remembered", "diy_device" in s.cookies, list(s.cookies.keys()))
s.post(f"{BASE}/api/auth/logout")
db("delete from code_requests where email=?", (email,))
codes = [ask(email).status_code for _ in range(9)]
check("code: strangers can use up an address's allowance", codes == [200] * 8 + [429], codes)
r = ask(email, sess=s)
check("code: the owner's usual browser still gets a code", r.status_code == 200 and r.json().get("devCode"), r.text)
r2 = s.post(f"{BASE}/api/auth/verify", json={"email": email, "code": r.json()["devCode"]})
check("code: and can log in with it", r2.status_code == 200 and s.get(f"{BASE}/api/me").json()["user"]["email"] == email, r2.text)
codes = [ask(email, sess=s).status_code for _ in range(6)]
check("code: the usual browser has its own cap (5 an hour)", codes == [200] * 4 + [429] * 2, codes)
# 那个记号只对登录过的账号有用：拿它替别的邮箱要验证码，还是按陌生浏览器算
e = mail(); [ask(e) for _ in range(8)]
check("code: being known for one account gives nothing for another address", ask(e, sess=s).status_code == 429)
stranger = requests.Session(); stranger.cookies.set("diy_device", "b" * 64)
check("code: a made-up marker is treated as a stranger", ask(email, sess=stranger).status_code == 429)

# 同一个 IP 一小时最多 30 次
ip = rip(); codes = [requests.post(f"{BASE}/api/auth/request", json={"email": mail()}, headers={"x-forwarded-for": ip}).status_code for _ in range(32)]
check("code: an IP gets at most 30 codes an hour", codes == [200] * 30 + [429] * 2, codes)
# 全站一天的总量（默认 400）。到了之后陌生浏览器要不到，登录过的浏览器不受影响
now = int(time.time() * 1000)
con_rows = [(f"flood{i}@example.com", f"203.0.{i % 250}.{i // 250 + 1}", now - 2 * 3600_000) for i in range(400)]
import sqlite3 as _sq
_c = _sq.connect(DB, timeout=10); _c.executemany("insert into code_requests (email, ip, at, lane) values (?, ?, ?, 'anon')", con_rows); _c.commit(); _c.close()
r = ask(mail())
check("code: over the site-wide daily total, strangers are asked to wait", r.status_code == 429 and "人太多" in r.json().get("error", ""), r.text)
s_k, email_k = None, None
db("delete from code_requests where email like 'flood%@example.com'")
s_k, email_k = login(ip=rip()); s_k.post(f"{BASE}/api/auth/logout")
_c = _sq.connect(DB, timeout=10); _c.executemany("insert into code_requests (email, ip, at, lane) values (?, ?, ?, 'anon')", con_rows); _c.commit(); _c.close()
check("code: a known browser still gets a code during a flood", ask(email_k, sess=s_k).status_code == 200)
db("delete from code_requests where email like 'flood%@example.com'")

# 一分钟内重发：告诉页面刚才那个还能用（只对申请它的那个浏览器这么说）
e = mail(); ip = rip(); sb = requests.Session()
sb.post(f"{BASE}/api/auth/request", json={"email": e}, headers={"x-forwarded-for": ip})
r = sb.post(f"{BASE}/api/auth/request", json={"email": e}, headers={"x-forwarded-for": ip})
check("code: resend within a minute says the earlier code is still valid", r.status_code == 429 and r.json().get("sent") is True, r.text)
r = requests.post(f"{BASE}/api/auth/request", json={"email": e}, headers={"x-forwarded-for": ip})
check("code: another browser on the same network is told to wait, not sent to the code step", r.status_code == 429 and not r.json().get("sent"), r.text)
r = sb.post(f"{BASE}/api/auth/request", json={"email": e}, headers={"x-forwarded-for": rip()})
check("code: the same browser on a new network is also held to one a minute", r.status_code == 429 and r.json().get("sent") is True, r.text)

# ---------- 别的网站发起的请求 ----------
s, email = login(ip=rip())
X = {"Sec-Fetch-Site": "cross-site"}
check("cross-site: session is not honoured", s.get(f"{BASE}/api/me", headers=X).json()["user"] is None)
before = s.get(f"{BASE}/api/me").json()["user"]["credits"]
r = s.get(f"{BASE}/api/scholar", params={"s2": "1741101"}, headers={**X, "Sec-Fetch-Mode": "navigate"})
check("cross-site: a link to a paid lookup is refused and costs nothing", r.status_code == 401 and s.get(f"{BASE}/api/me").json()["user"]["credits"] == before, r.status_code)
r = requests.post(f"{BASE}/api/auth/login", data=json.dumps({"email": email, "password": "x" * 10}), headers={**X, "Content-Type": "text/plain"})
check("cross-site: login form posted from another site is refused", r.status_code == 403, r.status_code)
r = requests.post(f"{BASE}/api/auth/request", json={"email": mail()}, headers=X)
check("cross-site: code request refused", r.status_code == 403, r.status_code)
r = s.put(f"{BASE}/api/data", json={"key": "cases", "value": "[]", "rev": 0}, headers=X)
check("cross-site: data write refused", r.status_code == 401, r.status_code)
check("same-origin and direct requests still work", s.get(f"{BASE}/api/me", headers={"Sec-Fetch-Site": "same-origin"}).json()["user"] is not None and s.get(f"{BASE}/api/me", headers={"Sec-Fetch-Site": "none"}).json()["user"] is not None)

# ---------- 页面以为的账号和实际登录的账号对不上 ----------
r = s.get(f"{BASE}/api/data", headers={"X-Account": "someone-else@example.com"})
check("account: request tagged with another account is treated as logged out", r.status_code == 401, r.status_code)
r = s.put(f"{BASE}/api/data", json={"key": "cases", "value": "[]", "rev": 0}, headers={"X-Account": "someone-else@example.com"})
check("account: cannot write into the session's account under another name", r.status_code == 401 and s.get(f"{BASE}/api/data").json() == {"items": {}}, r.status_code)
r = s.get(f"{BASE}/api/data", headers={"X-Account": email.upper()})
check("account: matching tag (any letter case) is accepted", r.status_code == 200, r.status_code)

# ---------- 密码：各种失败都是同一句话 ----------
s.post(f"{BASE}/api/auth/password", json={"password": "correct horse 9"})
msgs = set()
msgs.add(requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": "wrong wrong"}, headers={"x-forwarded-for": rip()}).json()["error"])
msgs.add(requests.post(f"{BASE}/api/auth/login", json={"email": mail(), "password": "wrong wrong"}, headers={"x-forwarded-for": rip()}).json()["error"])
for i in range(5):
    requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": "wrong wrong"}, headers={"x-forwarded-for": rip()})
r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": "correct horse 9"}, headers={"x-forwarded-for": rip()})
msgs.add(r.json().get("error"))
check("pw: unknown account, wrong password and locked account all get the same message", len(msgs) == 1 and r.status_code == 400, msgs)
db("update users set pw_locked_until=0, pw_fails=0 where email=?", (email,))
check("pw: correct password works once the lock is over", requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": "correct horse 9"}, headers={"x-forwarded-for": rip()}).status_code == 200)
ip = rip(); codes = [requests.post(f"{BASE}/api/auth/login", json={"email": mail(), "password": "whatever 1"}, headers={"x-forwarded-for": ip}).status_code for _ in range(62)]
check("pw: one IP is cut off after 60 attempts an hour", codes[:60] == [400] * 60 and codes[60:] == [429, 429], codes[-4:])

# ---------- 聊天接口的输入检查 ----------
s, email = login(credits=3000, ip=rip())
for name, payload in [("null body", "null"), ("array body", "[]"), ("message without text", json.dumps({"messages": [{"role": "user"}]})), ("messages not a list", json.dumps({"messages": "hi"})),
                      ("attachment without data", json.dumps({"messages": [{"role": "user", "text": "", "attachments": [{"name": 5}]}]})), ("bad role", json.dumps({"messages": [{"role": "system", "text": "x"}]}))]:
    r = s.post(f"{BASE}/api/chat", data=payload, headers={"Content-Type": "application/json"})
    check(f"chat: {name} -> clean 400", r.status_code == 400 and "error" in r.json(), (r.status_code, r.text[:80])) if name != "attachment without data" else check(f"chat: {name} handled", r.status_code in (200, 400), r.status_code)
    if r.status_code == 200: r.close()
time.sleep(2)

# ---------- 同时发很多请求：最多两个在生成 ----------
codes = []
def fire():
    try:
        r = s.post(f"{BASE}/api/chat", json={"messages": [{"role": "user", "text": "只回答两个字：收到"}]}, stream=True, timeout=120)
        codes.append(r.status_code)
        if r.status_code == 200:
            for _ in r.iter_content(64): pass
        r.close()
    except Exception as ex:
        codes.append(str(ex)[:40])
ths = [threading.Thread(target=fire) for _ in range(6)]
[t.start() for t in ths]; [t.join() for t in ths]
check("chat: only two replies generate at once, the rest are told to wait", sorted(map(str, codes)) == ["200", "200", "429", "429", "429", "429"], codes)
time.sleep(1.5)
r = s.post(f"{BASE}/api/chat", json={"messages": [{"role": "user", "text": "只回答两个字：收到"}]}, stream=True, timeout=120)
ok = r.status_code == 200
if ok:
    for _ in r.iter_content(64): pass
check("chat: slots are released when replies finish", ok, r.status_code)

# ---------- 中途停止：按已经输出的内容扣费，而不是固定 1 个 ----------
time.sleep(1.5)
before = db("select credits from users where email=?", (email,))[0][0]
r = s.post(f"{BASE}/api/chat", json={"messages": [{"role": "user", "text": "请用中文写一篇两千字的文章，详细介绍 EB-1A 十项标准每一项的证据要求，分十个小节。"}]}, stream=True, timeout=200)
got = b""
for chunk in r.iter_content(256):
    got += chunk
    if len(got) > 2400: break
r.close()
time.sleep(4)
after = db("select credits from users where email=?", (email,))[0][0]
print(f"  stopped after {len(got.decode('utf8', 'ignore'))} characters; charged {before - after}")
check("chat: a reply stopped part-way is charged for what was produced (more than the old flat 1)", before - after >= 10, before - after)
check("chat: and less than a full reply would cost", before - after < 400, before - after)

# ---------- 超大请求 ----------
def chunks(n, size=1 << 20):
    for _ in range(n): yield b"x" * size
fid = "big" + uuid.uuid4().hex[:8]
t = time.time()
try:
    r = s.put(f"{BASE}/api/files/{fid}", data=chunks(30)); code = r.status_code
except Exception as ex:
    code = "closed"   # 服务器读到上限就断开，也算拒绝
check("files: a 30 MB upload sent without a length is cut off at the limit", code in (413, "closed") and fid not in s.get(f"{BASE}/api/files").json()["ids"], code)
r = requests.post(f"{BASE}/api/contact", data=json.dumps({"email": "a@b.co", "message": "x" * 200000}), headers={"Content-Type": "application/json", "x-forwarded-for": rip()})
check("contact: oversized body refused", r.status_code == 413, r.status_code)

# ---------- Scholar 另存的网页：没存全的不收费并提示 ----------
html = open(os.path.join(S, "fixtures", "scholar_page.html")).read()
before = db("select credits from users where email=?", (email,))[0][0]
r = s.post(f"{BASE}/api/scholar", json={"html": html.replace(" disabled>", ">")})
check("scholar upload: an incomplete page (more papers not shown) is refused with guidance and not charged", r.status_code == 400 and r.json().get("incomplete") is True and "还有更多" in r.json()["error"] and db("select credits from users where email=?", (email,))[0][0] == before, r.text[:200])
r = s.post(f"{BASE}/api/scholar", json={"html": html})
d = r.json()
check("scholar upload: a complete page is parsed, sorted by citations, charged 20", r.status_code == 200 and [w["citations"] for w in d["works"]] == [320, 150, 61, 0] and before - db("select credits from users where email=?", (email,))[0][0] == 20, r.text[:200])
r = s.post(f"{BASE}/api/scholar", json={"html": "<tr" * 900000})
check("scholar upload: crafted input answered quickly", r.status_code == 400 and r.elapsed.total_seconds() < 3, (r.status_code, r.elapsed.total_seconds()))

fails = [x for x in results if not x[1]]
print(f"\n{len(results) - len(fails)} passed, {len(fails)} failed")
for name, _, detail in fails: print("  FAILED:", name, "|", detail[:300])
sys.exit(1 if fails else 0)
