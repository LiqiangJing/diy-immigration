"""浏览器测试的公共部分：起浏览器、记录页面上的报错、登录。"""
import os, re, sqlite3, sys, time, uuid
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE", "http://127.0.0.1:3999")
# 测试用的工作目录：测试站的数据库、生成的样例文件、截图都放在这里（不进仓库）
S = os.environ.get("TEST_WORK") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".work")
DB = os.environ.get("DB", os.path.join(S, "data", "app.db"))
SHOTS = os.path.join(S, "shots")
os.makedirs(SHOTS, exist_ok=True)
CHROME = os.environ.get("CHROME")  # 不设就用 Playwright 自带的浏览器

results = []
problems = []  # 页面自己报的错（console error、未捕获异常、失败的请求）

def check(name, cond, detail=""):
    results.append((name, bool(cond), str(detail)))
    print(("PASS " if cond else "FAIL ") + name + (f"  -- {str(detail)[:300]}" if (detail and not cond) else ""), flush=True)
    return bool(cond)

def db(sql, args=()):
    con = sqlite3.connect(DB, timeout=10)
    try:
        rows = con.execute(sql, args).fetchall()
        con.commit()
        return rows
    finally:
        con.close()

def mail():
    return f"b{uuid.uuid4().hex[:10]}@example.com"

# 测试都从同一台机器发起，会撞上「同一个 IP 每小时能要多少次验证码」的上限：每个测试开始前清掉记录
try:
    db("delete from code_requests")
except Exception:
    pass

IGNORE = re.compile(r"favicon|Download the React DevTools|wechat-qr", re.I)

def watch(page, tag=""):
    def on_console(m):
        if m.type in ("error",) and not IGNORE.search(m.text):
            problems.append(f"[{tag}] console.{m.type}: {m.text[:400]}")
        elif m.type == "warning" and re.search(r"key|hydrat|act\(|Each child|unique", m.text):
            problems.append(f"[{tag}] console.warning: {m.text[:400]}")
    page.on("console", on_console)
    page.on("pageerror", lambda e: problems.append(f"[{tag}] pageerror: {str(e)[:400]}"))
    def on_resp(r):
        if r.status >= 500:
            problems.append(f"[{tag}] HTTP {r.status} {r.request.method} {r.url}")
    page.on("response", on_resp)
    def on_failed(r):
        if "ERR_ABORTED" not in (r.failure or ""):
            problems.append(f"[{tag}] requestfailed: {r.method} {r.url} {r.failure}")
    page.on("requestfailed", on_failed)

def launch(p, **kw):
    return p.chromium.launch(headless=True, **({"executable_path": CHROME} if CHROME else {}), **kw)

def new_page(browser, tag="", mobile=False, **ctx_kw):
    vp = {"width": 390, "height": 844} if mobile else {"width": 1360, "height": 900}
    ctx = browser.new_context(viewport=vp, accept_downloads=True, locale="zh-CN", **ctx_kw)
    page = ctx.new_page()
    page.set_default_timeout(15000)
    watch(page, tag)
    return ctx, page

def ui_login(page, email=None, credits=None):
    """从首页通过验证码登录（本地没配发信，验证码直接显示在页面上）。"""
    email = email or mail()
    page.goto(BASE + "/")
    page.locator(".account-box button", has_text="登录 / 注册").first.click()
    page.locator(".modal input[type=email]").fill(email)
    page.get_by_role("button", name="发送验证码").click()
    code = page.locator(".dev-code strong").inner_text()
    page.locator(".modal input[inputmode=numeric]").fill(code)
    page.locator(".modal button[type=submit]").click()
    page.locator(".account-email", has_text=email).wait_for()
    if credits is not None:
        db("update users set credits=? where email=?", (credits, email))
        page.reload()
        page.locator(".account-email", has_text=email).wait_for()
    return email

def nav(page, name):
    page.locator(".nav button", has_text=name).first.click()

def shot(page, name, full=False):
    path = os.path.join(SHOTS, name + ".png")
    page.screenshot(path=path, full_page=full)
    return path

def finish():
    fails = [x for x in results if not x[1]]
    print(f"\n{len(results) - len(fails)} passed, {len(fails)} failed")
    for name, _, detail in fails:
        print("  FAILED:", name, "|", detail[:400])
    if problems:
        print(f"\n页面报出的问题 {len(problems)} 条：")
        seen = set()
        for x in problems:
            if x not in seen:
                seen.add(x); print("  ", x)
    sys.exit(1 if fails else 0)
