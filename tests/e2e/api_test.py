"""接口级测试：对着本地测试站（BASE）逐个打一遍。只用标准的 HTTP 调用，不碰数据库以外的东西。"""
import json, os, sqlite3, sys, time, uuid
import requests

BASE = os.environ.get("BASE", "http://127.0.0.1:3999")
S = os.environ.get("TEST_WORK") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".work")
DB = os.environ.get("DB", os.path.join(S, "data", "app.db"))
results = []

def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  -- {detail}" if (detail and not cond) else ""))

def db(sql, args=()):
    con = sqlite3.connect(DB, timeout=10)
    try:
        cur = con.execute(sql, args)
        rows = cur.fetchall()
        con.commit()
        return rows
    finally:
        con.close()

def mail():
    return f"t{uuid.uuid4().hex[:10]}@example.com"

def login(email=None):
    email = email or mail()
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/request", json={"email": email})
    assert r.status_code == 200, r.text
    code = r.json()["devCode"]
    r = s.post(f"{BASE}/api/auth/verify", json={"email": email, "code": code})
    assert r.status_code == 200, r.text
    return s, email

# ---------------- 1. 登录 ----------------
r = requests.post(f"{BASE}/api/auth/request", json={"email": "not-an-email"})
check("auth: invalid email rejected", r.status_code == 400, r.text)
r = requests.post(f"{BASE}/api/auth/request", data="garbage", headers={"Content-Type": "application/json"})
check("auth: garbage body rejected", r.status_code == 400, r.text)
e1 = mail()
s1 = requests.Session()  # 验证码绑在申请它的那个浏览器上，所以申请和输入要用同一个会话
r = s1.post(f"{BASE}/api/auth/request", json={"email": e1.upper()})
check("auth: code issued (dev)", r.status_code == 200 and len(r.json().get("devCode", "")) == 6, r.text)
code = r.json()["devCode"]
ck = r.headers.get("set-cookie", "")
check("auth: the requesting browser gets a short-lived HttpOnly marker", "diy_login=" in ck and "HttpOnly" in ck and "Path=/api/auth" in ck and "Max-Age=900" in ck, ck)
r2 = s1.post(f"{BASE}/api/auth/request", json={"email": e1})
check("auth: resend within 60s blocked", r2.status_code == 429, r2.text)
wrong = "000000" if code != "000000" else "111111"
r = s1.post(f"{BASE}/api/auth/verify", json={"email": e1, "code": wrong})
check("auth: wrong code rejected", r.status_code == 400 and "不对" in r.text, r.text)
r = s1.post(f"{BASE}/api/auth/verify", json={"email": e1, "code": "12345"})
check("auth: malformed code rejected", r.status_code == 400, r.text)
# 别的浏览器拿着正确的验证码也登录不了，而且不管试多少次都不会把这个验证码试废
other = requests.Session()
r = other.post(f"{BASE}/api/auth/verify", json={"email": e1, "code": code})
check("auth: the right code from another browser is refused", r.status_code == 400 and "这个浏览器" in r.text and "diy_session" not in other.cookies, r.text)
for i in range(7):
    other.post(f"{BASE}/api/auth/verify", json={"email": e1, "code": wrong})
r = requests.post(f"{BASE}/api/auth/verify", json={"email": e1, "code": code}, cookies={"diy_login": "a" * 64})
check("auth: a made-up browser marker is refused", r.status_code == 400, r.text)
check("auth: guesses from other browsers do not use up the attempts", db("select attempts from login_codes where email=?", (e1,)) == [(1,)], db("select attempts from login_codes where email=?", (e1,)))
# 别人（另一个 IP）替这个邮箱再要一个验证码：自己手里的那个照样能用
r = requests.post(f"{BASE}/api/auth/request", json={"email": e1}, headers={"x-forwarded-for": "198.51.100.7"})
check("auth: someone else can request a code for the same address", r.status_code == 200, r.text)
r = s1.post(f"{BASE}/api/auth/verify", json={"email": e1, "code": code})
check("auth: correct code logs in (case-insensitive email)", r.status_code == 200 and "diy_session" in s1.cookies, r.text)
ck = r.headers.get("set-cookie", "")
check("auth: cookie is HttpOnly + SameSite", "HttpOnly" in ck and "SameSite=Lax" in ck, ck)
check("auth: login marks the browser as known and clears the code marker", "diy_device" in s1.cookies and "diy_login" not in s1.cookies, list(s1.cookies.keys()))
me = s1.get(f"{BASE}/api/me").json()
check("auth: /api/me shows user with signup bonus 200", me["user"] and me["user"]["email"] == e1 and me["user"]["credits"] == 200, json.dumps(me["user"]))
check("auth: ledger has signup bonus", me["history"] and me["history"][0]["delta"] == 200 and me["history"][0]["reason"] == "注册赠送", json.dumps(me["history"]))
r = s1.post(f"{BASE}/api/auth/verify", json={"email": e1, "code": code})
check("auth: code is single-use", r.status_code == 400, r.text)

# 5 次输错后锁定，即使第 6 次是对的
e2 = mail(); s2 = requests.Session()
code2 = s2.post(f"{BASE}/api/auth/request", json={"email": e2}).json()["devCode"]
bad = "999999" if code2 != "999999" else "888888"
for i in range(5):
    s2.post(f"{BASE}/api/auth/verify", json={"email": e2, "code": bad})
r = s2.post(f"{BASE}/api/auth/verify", json={"email": e2, "code": code2})
check("auth: locked after 5 wrong attempts even with right code", r.status_code == 400 and "次数过多" in r.text, r.text)
check("auth: no user created for failed login", db("select count(*) from users where email=?", (e2,))[0][0] == 0)

# 过期的验证码
e3 = mail(); s3 = requests.Session()
code3 = s3.post(f"{BASE}/api/auth/request", json={"email": e3}).json()["devCode"]
db("update login_codes set expires_at=? where email=?", (int(time.time() * 1000) - 1000, e3))
r = s3.post(f"{BASE}/api/auth/verify", json={"email": e3, "code": code3})
check("auth: expired code rejected", r.status_code == 400 and "过期" in r.text, r.text)
# 用一个邮箱要的验证码不能拿去登录另一个邮箱
e4 = mail(); s4 = requests.Session()
code4 = s4.post(f"{BASE}/api/auth/request", json={"email": e4}, headers={"x-forwarded-for": "198.51.100.8"}).json()["devCode"]
r = s4.post(f"{BASE}/api/auth/verify", json={"email": e1, "code": code4})
check("auth: a code for one address cannot log in to another", r.status_code == 400 and "diy_session" not in s4.cookies, r.text)

# 再次登录同一邮箱不重复送 credit
db("update login_codes set sent_at=0 where email=?", (e1,))
db("delete from login_codes where email=?", (e1,))
s1b, _ = login(e1)
me = s1b.get(f"{BASE}/api/me").json()
check("auth: second login gives no second bonus", me["user"]["credits"] == 200 and sum(1 for h in me["history"] if h["reason"] == "注册赠送") == 1, json.dumps(me["history"]))

# 退出
r = s1b.post(f"{BASE}/api/auth/logout")
me = s1b.get(f"{BASE}/api/me").json()
check("auth: logout clears session", r.status_code == 200 and me["user"] is None)
me = s1.get(f"{BASE}/api/me").json()
check("auth: other session of same user survives logout", me["user"] is not None)
# 伪造 cookie
r = requests.get(f"{BASE}/api/me", cookies={"diy_session": "a" * 64})
check("auth: forged cookie is anonymous", r.json()["user"] is None)

# ---------------- 2. 密码 ----------------
r = requests.post(f"{BASE}/api/auth/password", json={"password": "abcdefgh1"})
check("pw: set requires login", r.status_code == 401, r.text)
r = s1.post(f"{BASE}/api/auth/password", json={"password": "short"})
check("pw: too short rejected", r.status_code == 400, r.text)
r = s1.post(f"{BASE}/api/auth/password", json={"password": "x" * 201})
check("pw: too long rejected", r.status_code == 400, r.text)
s1c, _ = (lambda: (db("delete from login_codes where email=?", (e1,)), login(e1))[1])()
r = s1.post(f"{BASE}/api/auth/password", json={"password": "correct horse 9"})
check("pw: set ok", r.status_code == 200, r.text)
check("pw: hasPassword true", s1.get(f"{BASE}/api/me").json()["user"]["hasPassword"] is True)
check("pw: other sessions revoked on set", s1c.get(f"{BASE}/api/me").json()["user"] is None)
check("pw: current session kept", s1.get(f"{BASE}/api/me").json()["user"] is not None)
sp = requests.Session()
r = sp.post(f"{BASE}/api/auth/login", json={"email": e1, "password": "wrong password"})
msg_wrong = r.json().get("error")
check("pw: wrong password rejected", r.status_code == 400, r.text)
r = requests.post(f"{BASE}/api/auth/login", json={"email": mail(), "password": "whatever123"})
check("pw: unknown email gives identical error", r.status_code == 400 and r.json().get("error") == msg_wrong, r.text)
e_nopw = mail(); s_nopw, _ = login(e_nopw)
r = requests.post(f"{BASE}/api/auth/login", json={"email": e_nopw, "password": "whatever123"})
check("pw: account without password gives identical error", r.status_code == 400 and r.json().get("error") == msg_wrong, r.text)
r = sp.post(f"{BASE}/api/auth/login", json={"email": e1.upper(), "password": "correct horse 9"})
check("pw: login ok (email case-insensitive)", r.status_code == 200 and sp.get(f"{BASE}/api/me").json()["user"]["email"] == e1, r.text)
r = requests.post(f"{BASE}/api/auth/login", json={"email": e1})
check("pw: missing password rejected", r.status_code == 400, r.text)
for i in range(5):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": e1, "password": "nope nope"})
r = requests.post(f"{BASE}/api/auth/login", json={"email": e1, "password": "correct horse 9"})
check("pw: locked after 5 failures (right password refused)", r.status_code == 400 and "15 分钟" in r.text, r.text)
db("update users set pw_locked_until=0, pw_fails=0 where email=?", (e1,))
r = requests.post(f"{BASE}/api/auth/login", json={"email": e1, "password": "correct horse 9"})
check("pw: works again after lock expires", r.status_code == 200, r.text)
stored = db("select password_hash from users where email=?", (e1,))[0][0]
check("pw: stored hashed (scrypt), not plain", stored.startswith("scrypt$") and "correct horse" not in stored, stored[:20])

# ---------------- 3. 数据同步 ----------------
sa, ea = login(); sb, eb = login()
r = requests.get(f"{BASE}/api/data")
check("data: GET requires login", r.status_code == 401)
r = requests.put(f"{BASE}/api/data", json={"key": "profile", "value": "{}", "rev": 0})
check("data: PUT requires login", r.status_code == 401)
check("data: empty for new user", sa.get(f"{BASE}/api/data").json() == {"items": {}})
r = sa.put(f"{BASE}/api/data", json={"key": "profile", "value": json.dumps({"firstName": "A", "updatedAt": 1}), "rev": 0})
check("data: first PUT ok rev=1", r.status_code == 200 and r.json()["rev"] == 1, r.text)
r = sa.put(f"{BASE}/api/data", json={"key": "profile", "value": json.dumps({"firstName": "A2", "updatedAt": 2}), "rev": 0})
check("data: stale rev -> 409 with server copy", r.status_code == 409 and r.json()["rev"] == 1 and "\"A\"" in r.json()["value"], r.text)
r = sa.put(f"{BASE}/api/data", json={"key": "profile", "value": json.dumps({"firstName": "A2", "updatedAt": 2}), "rev": 1})
check("data: correct rev -> rev=2", r.status_code == 200 and r.json()["rev"] == 2, r.text)
r = sa.put(f"{BASE}/api/data", json={"key": "evil", "value": "{}", "rev": 0})
check("data: unknown key rejected", r.status_code == 400, r.text)
r = sa.put(f"{BASE}/api/data", json={"key": "cases", "value": "{not json", "rev": 0})
check("data: invalid JSON value rejected", r.status_code == 400, r.text)
r = sa.put(f"{BASE}/api/data", json={"key": "cases", "value": "[]", "rev": -1})
check("data: negative rev rejected", r.status_code == 400, r.text)
r = sa.put(f"{BASE}/api/data", json={"key": "cases", "value": "[]", "rev": "0"})
check("data: string rev rejected", r.status_code == 400, r.text)
r = sa.put(f"{BASE}/api/data", data="xx", headers={"Content-Type": "application/json"})
check("data: garbage body rejected", r.status_code == 400, r.text)
check("data: other user sees nothing", sb.get(f"{BASE}/api/data").json() == {"items": {}})
big = json.dumps(["x" * (8 * 1024 * 1024 + 10)])
r = sa.put(f"{BASE}/api/data", json={"key": "docs", "value": big, "rev": 0})
check("data: >8MB rejected with 413", r.status_code == 413, str(r.status_code))
ok7 = json.dumps(["y" * (7 * 1024 * 1024)])
r = sa.put(f"{BASE}/api/data", json={"key": "docs", "value": ok7, "rev": 0})
check("data: 7MB accepted", r.status_code == 200, str(r.status_code) + r.text[:100])
got = sa.get(f"{BASE}/api/data").json()["items"]
check("data: roundtrip intact", got["profile"]["rev"] == 2 and json.loads(got["profile"]["value"])["firstName"] == "A2" and got["docs"]["value"] == ok7)

# ---------------- 4. 文件 ----------------
fid = "f" + uuid.uuid4().hex[:10]
payload = os.urandom(50_000)
r = requests.put(f"{BASE}/api/files/{fid}", data=payload)
check("files: PUT requires login", r.status_code == 401)
r = sa.put(f"{BASE}/api/files/{fid}", data=payload)
check("files: PUT ok", r.status_code == 200, r.text)
r = sa.get(f"{BASE}/api/files/{fid}")
check("files: GET returns identical bytes", r.status_code == 200 and r.content == payload)
check("files: listed", fid in sa.get(f"{BASE}/api/files").json()["ids"])
r = sb.get(f"{BASE}/api/files/{fid}")
check("files: other user cannot read", r.status_code == 404, str(r.status_code))
check("files: other user's list empty", sb.get(f"{BASE}/api/files").json()["ids"] == [])
r = sb.delete(f"{BASE}/api/files/{fid}")
r = sa.get(f"{BASE}/api/files/{fid}")
check("files: other user's DELETE has no effect", r.status_code == 200 and r.content == payload)
for bad_id in ["..%2F..%2Fapp.db", "a", "x" * 65, "a.b.c.d", "ab cd"]:
    r = sa.put(f"{BASE}/api/files/{bad_id}", data=b"x")
    check(f"files: bad id rejected ({bad_id[:12]})", r.status_code in (400, 404), str(r.status_code))
r = sa.put(f"{BASE}/api/files/{fid}e", data=b"")
check("files: empty body rejected", r.status_code == 413, str(r.status_code))
r = sa.put(f"{BASE}/api/files/{fid}b", data=os.urandom(20 * 1024 * 1024 + 1))
check("files: >20MB rejected", r.status_code == 413, str(r.status_code))
r = sa.put(f"{BASE}/api/files/{fid}", data=b"replaced")
check("files: overwrite ok", r.status_code == 200 and sa.get(f"{BASE}/api/files/{fid}").content == b"replaced")
r = sa.delete(f"{BASE}/api/files/{fid}")
check("files: DELETE ok then 404", r.status_code == 200 and sa.get(f"{BASE}/api/files/{fid}").status_code == 404)
uid_a = db("select id from users where email=?", (ea,))[0][0]
check("files: bytes removed from disk", not os.path.exists(os.path.join(os.path.dirname(DB), "files", uid_a, fid)))

# ---------------- 5. 需要登录 / 余额的接口 ----------------
for path, method, body in [("/api/chat", "post", {"messages": [{"role": "user", "text": "hi"}]}), ("/api/citations", "post", {"title": "A long enough paper title"}),
                           ("/api/citemap", "post", {"titles": ["A long enough paper title"]}), ("/api/paper", "post", {"title": "A long enough paper title"}),
                           ("/api/scholar?q=Jane%20Doe", "get", None), ("/api/billing/alipay/checkout", "post", {"pack": "p5"}), ("/api/billing/checkout", "post", {"pack": "p5"})]:
    r = getattr(requests, method)(f"{BASE}{path}", json=body) if body is not None else getattr(requests, method)(f"{BASE}{path}")
    check(f"gate: {path.split('?')[0]} requires login", r.status_code == 401, str(r.status_code))
s0, e0 = login()
db("update users set credits=0 where email=?", (e0,))
r = s0.post(f"{BASE}/api/chat", json={"messages": [{"role": "user", "text": "hi"}]})
check("gate: chat with 0 credits -> 402", r.status_code == 402, r.text[:80])
r = s0.get(f"{BASE}/api/scholar", params={"s2": "1741101"})
check("gate: scholar fetch with 0 credits -> 402", r.status_code == 402, r.text[:80])
r = s0.post(f"{BASE}/api/scholar", json={"html": "<html></html>"})
check("gate: scholar upload with 0 credits -> 402", r.status_code == 402, r.text[:80])
r = s0.post(f"{BASE}/api/citations", json={"title": "A long enough paper title"})
check("gate: citations with 0 credits -> 402", r.status_code == 402, r.text[:80])
r = s0.post(f"{BASE}/api/citemap", json={"titles": ["A long enough paper title"]})
check("gate: citemap with 0 credits -> 402", r.status_code == 402, r.text[:80])
check("gate: nothing charged on refusals", s0.get(f"{BASE}/api/me").json()["user"]["credits"] == 0)

r = sa.post(f"{BASE}/api/chat", json={"messages": []})
check("chat: empty messages -> 400", r.status_code == 400, r.text[:80])
r = sa.post(f"{BASE}/api/chat", json={"messages": [{"role": "assistant", "text": "x"}]})
check("chat: last message not user -> 400", r.status_code == 400, r.text[:80])
r = sa.post(f"{BASE}/api/chat", data="{bad", headers={"Content-Type": "application/json"})
check("chat: bad JSON -> 400", r.status_code == 400, r.text[:80])
r = sa.post(f"{BASE}/api/chat", json={"messages": [{"role": "user", "text": "   "}]})
check("chat: blank message -> 400", r.status_code == 400, r.text[:80])
r = sa.post(f"{BASE}/api/citations", json={"title": "short"})
check("citations: short title -> 400", r.status_code == 400, r.text[:80])
r = sa.post(f"{BASE}/api/citemap", json={"titles": []})
check("citemap: no titles -> 400", r.status_code == 400, r.text[:80])
r = sa.post(f"{BASE}/api/paper", json={"title": "short"})
check("paper: short title -> 400", r.status_code == 400, r.text[:80])
r = sa.get(f"{BASE}/api/scholar")
check("scholar: no params -> 400", r.status_code == 400, r.text[:80])
r = sa.get(f"{BASE}/api/scholar", params={"gs": "https://example.com/citations?user=abcdefgh"})
check("scholar: non-Scholar link -> 400", r.status_code == 400, r.text[:80])
r = sa.get(f"{BASE}/api/scholar", params={"s2": "https://example.com/author/1"})
check("scholar: non-S2 link -> 400", r.status_code == 400, r.text[:80])
r = sa.get(f"{BASE}/api/scholar", params={"id": "W123"})
check("scholar: bad OpenAlex id -> 400", r.status_code == 400, r.text[:80])
r = sa.post(f"{BASE}/api/scholar", json={"html": "<html>not scholar</html>"})
check("scholar: unparseable upload -> 400 and not charged", r.status_code == 400 and sa.get(f"{BASE}/api/me").json()["user"]["credits"] == 200, r.text[:80])
r = sa.post(f"{BASE}/api/billing/alipay/checkout", json={"pack": "p5"})
check("billing: alipay not configured locally -> 503", r.status_code == 503, r.text[:80])
r = sa.post(f"{BASE}/api/billing/checkout", json={"pack": "p5"})
check("billing: stripe not configured -> 503", r.status_code == 503, r.text[:80])
r = requests.post(f"{BASE}/api/billing/alipay/notify", data={"out_trade_no": "x", "trade_status": "TRADE_SUCCESS"})
check("billing: alipay notify unconfigured -> fail", r.text == "fail", r.text[:40])
r = requests.post(f"{BASE}/api/billing/webhook", data="{}")
check("billing: stripe webhook unconfigured -> 503", r.status_code == 503, r.text[:40])

# ---------------- 6. 联系我们 ----------------
ip = f"10.9.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
h = {"x-forwarded-for": ip}
r = requests.post(f"{BASE}/api/contact", json={"email": "bad", "message": "hello there"}, headers=h)
check("contact: anonymous needs valid email", r.status_code == 400, r.text)
r = requests.post(f"{BASE}/api/contact", json={"email": "u@example.com", "message": "hi"}, headers=h)
check("contact: too short rejected", r.status_code == 400, r.text)
r = requests.post(f"{BASE}/api/contact", json={"email": "u@example.com", "message": "x" * 5001}, headers=h)
check("contact: too long rejected", r.status_code == 400, r.text)
ip2 = f"10.8.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
codes = [requests.post(f"{BASE}/api/contact", json={"email": "u@example.com", "message": f"test message number {i}"}, headers={"x-forwarded-for": ip2}).status_code for i in range(6)]
check("contact: 5 ok then rate-limited", codes == [200] * 5 + [429], str(codes))
check("contact: stored", db("select count(*) from contact_messages where message like 'test message number %'")[0][0] >= 5)
r = sa.post(f"{BASE}/api/contact", json={"message": "logged in user, no email field"}, headers={"x-forwarded-for": f"10.7.1.{uuid.uuid4().int % 250}"})
check("contact: logged-in user may omit email", r.status_code == 200 and db("select email from contact_messages where message='logged in user, no email field' order by id desc")[0][0] == ea, r.text)

# ---------------- 7. 页面 ----------------
for path in ["/", "/demo", "/terms", "/privacy"]:
    r = requests.get(f"{BASE}{path}")
    check(f"page: {path} 200", r.status_code == 200 and "DIY Immigration" in r.text, str(r.status_code))
r = requests.get(f"{BASE}/nope")
check("page: unknown path 404", r.status_code == 404, str(r.status_code))
for asset in ["/logo.png", "/logo-square.png", "/wechat-qr.png"]:
    check(f"asset: {asset}", requests.get(f"{BASE}{asset}").status_code == 200)

fails = [x for x in results if not x[1]]
print(f"\n{len(results) - len(fails)} passed, {len(fails)} failed")
for name, _, detail in fails:
    print("  FAILED:", name, "|", detail[:300])
sys.exit(1 if fails else 0)
