"""多设备同步：两台设备同一个账号、同时修改、删除、换账号、退出登录。"""
import json, re, time
from common import *
from fixture_profile import profile

def login_as(page, email):
    """已有账号再登录一次（另一台设备）。"""
    page.goto(BASE + "/")
    page.locator(".account-box button", has_text="登录 / 注册").first.click()
    page.locator(".modal input[type=email]").fill(email)
    db("update login_codes set sent_at=0 where email=?", (email,)); db("delete from code_requests where email=?", (email,))  # 测试里同一个账号反复登录，别撞上次数上限
    page.get_by_role("button", name="发送验证码").click()
    page.locator(".modal input[inputmode=numeric]").fill(page.locator(".dev-code strong").inner_text())
    page.locator(".modal button[type=submit]").click()
    page.locator(".account-email", has_text=email).wait_for()

# 这个浏览器里缓存着哪些文件（IndexedDB；kv: 开头的是同步用的记录，不是文件）
IDB_KEYS = """() => new Promise((res, rej) => {
  const r = indexedDB.open('diy-immigration', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('files');
  r.onerror = () => rej(r.error);
  r.onsuccess = () => {
    const q = r.result.transaction('files').objectStore('files').getAllKeys();
    q.onsuccess = () => res(q.result.filter((k) => !String(k).startsWith('kv:')));
    q.onerror = () => rej(q.error);
  };
})"""

def synced(page, timeout=15000):
    page.locator(".sync-state.ok").wait_for(timeout=timeout)
    time.sleep(0.3)

def ls(page, key):
    time.sleep(0.6)  # 存进浏览器有 0.4 秒的延迟
    return json.loads(page.evaluate(f"localStorage.getItem('pathway.{key}')") or "null")

def server(email, key):
    r = db("select value, rev from user_data d join users u on u.id=d.user_id where u.email=? and key=?", (email, key))
    return (json.loads(r[0][0]), r[0][1]) if r else (None, 0)

def new_case(page, name, typ="NIW"):
    nav(page, "案件")
    if page.locator("button.back").count():
        page.locator("button.back").click()
    (page.get_by_role("button", name="+ 新建案件") if page.get_by_role("button", name="+ 新建案件").count() else page.get_by_role("button", name="+ 创建第一个案件")).click()
    page.locator(".case-form .seg button", has_text=typ).click()
    page.locator(".case-form input").fill(name)
    page.get_by_role("button", name="创建", exact=True).click()
    page.locator("h2", has_text=name).wait_for()
    page.locator("button.back").click()

with sync_playwright() as p:
    b = launch(p)
    ctxA, A = new_page(b, "devA")
    ctxB, B = new_page(b, "devB")

    # ---------- 设备 A：登录、填档案、建案件 ----------
    email = ui_login(A)
    nav(A, "我的档案")
    A.get_by_placeholder("与护照一致，如 Xiaoming").fill("Jane")
    A.get_by_placeholder("与护照一致，如 Wang").fill("Doe")
    new_case(A, "Case from A")
    time.sleep(2.6); synced(A)
    sp, _ = server(email, "profile"); sc, _ = server(email, "cases")
    check("sync: device A's profile and case reach the server", sp and sp["firstName"] == "Jane" and sc and sc[0]["name"] == "Case from A")

    # ---------- 设备 B：登录同一账号，拿到数据 ----------
    login_as(B, email); synced(B)
    check("sync: device B receives the profile and the case", ls(B, "profile")["firstName"] == "Jane" and [c["name"] for c in ls(B, "cases")] == ["Case from A"])
    # B 上改档案、加文档
    nav(B, "我的档案")
    B.get_by_placeholder(re.compile("多模态大模型")).fill("Battery Informatics")
    nav(B, "案件"); B.locator(".case-card").first.click()
    B.locator(".tabs button", has_text="文档").click()
    B.locator(".case-card", has=B.locator("strong", has_text="+ 其他文档")).click()
    B.locator("textarea.doc-editor").fill("Written on device B")
    B.locator("button.back").click()
    time.sleep(2.6); synced(B)
    # A 刷新后看到 B 的改动
    A.reload(); A.locator(".account-email").wait_for(); synced(A)
    check("sync: after a reload device A sees device B's edits", ls(A, "profile")["field"] == "Battery Informatics" and len(ls(A, "docs")) == 1 and ls(A, "docs")[0]["content"] == "Written on device B")

    # ---------- 两边都没刷新、各自新建一个案件：都应该留下 ----------
    new_case(A, "Second from A")
    time.sleep(2.6); synced(A)
    new_case(B, "Second from B")           # B 这时手里的案件列表是旧的
    time.sleep(4.5); synced(B)
    names = sorted(c["name"] for c in server(email, "cases")[0])
    check("sync: cases created on two stale devices both survive", names == ["Case from A", "Second from A", "Second from B"], names)
    check("sync: device B now also shows device A's new case", sorted(c["name"] for c in ls(B, "cases")) == names, [c["name"] for c in ls(B, "cases")])

    # ---------- A 没刷新，B 改了同一个案件（勾清单）；A 接着也改同一个案件（选申报条件）：两边的修改都应该留下 ----------
    A.reload(); A.locator(".account-email").wait_for(); synced(A)
    B.reload(); B.locator(".account-email").wait_for(); synced(B)
    nav(B, "案件"); B.locator(".case-card", has_text="Case from A").click()
    B.locator(".tabs button", has_text="材料清单").click()
    B.locator(".group .item input").nth(0).check()
    time.sleep(2.6); synced(B)
    nav(A, "案件"); A.locator(".case-card", has_text="Case from A").click()
    A.locator(".guide li.step", has=A.locator("strong", has_text="选择申报条件")).locator(".seg button", has_text="高等学位").click()
    time.sleep(4.5); synced(A)
    c = next(x for x in server(email, "cases")[0] if x["name"] == "Case from A")
    check("sync: edits to the same case from two devices are both kept (checklist from B, claim from A)", c.get("eb2") == "advanced" and len(c.get("done", [])) == 1, {"eb2": c.get("eb2"), "done": c.get("done")})

    # ---------- 档案：A 改一个字段、B（没刷新）改另一个字段，都应该留下 ----------
    A.reload(); A.locator(".account-email").wait_for(); synced(A)
    B.reload(); B.locator(".account-email").wait_for(); synced(B)
    nav(A, "我的档案"); A.get_by_placeholder(re.compile("多模态大模型")).fill("Field set on A")
    time.sleep(2.6); synced(A)
    nav(B, "我的档案"); B.locator("section.card", has_text="基本信息").locator("input").nth(2).fill("中文名在B上填")
    time.sleep(4.5); synced(B)
    sp, _ = server(email, "profile")
    check("sync: profile fields edited on two devices are both kept", sp["field"] == "Field set on A" and sp["chineseName"] == "中文名在B上填", {"field": sp["field"], "chineseName": sp["chineseName"]})

    # ---------- 删除：A 删掉一个案件，B（没刷新）之后做别的修改，被删的不应该复活 ----------
    A.reload(); A.locator(".account-email").wait_for(); synced(A)
    B.reload(); B.locator(".account-email").wait_for(); synced(B)
    nav(A, "案件"); A.locator(".case-card", has_text="Second from B").click()
    A.once("dialog", lambda d: d.accept()); A.get_by_role("button", name="删除案件").click()
    time.sleep(2.6); synced(A)
    new_case(B, "Third from B")
    time.sleep(4.5); synced(B)
    names = sorted(c["name"] for c in server(email, "cases")[0])
    check("sync: a case deleted on one device is not resurrected by a stale device", "Second from B" not in names and "Third from B" in names, names)

    # ---------- 切回页面时自动取回别的设备的改动（不用手动刷新） ----------
    A.reload(); A.locator(".account-email").wait_for(); synced(A)
    nav(A, "我的档案"); A.get_by_placeholder(re.compile("多模态大模型")).fill("Changed while B was in background")
    time.sleep(2.6); synced(A)
    B.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    B.evaluate("window.dispatchEvent(new Event('focus'))")
    time.sleep(3)
    check("sync: returning to a background tab picks up changes made elsewhere", ls(B, "profile")["field"] == "Changed while B was in background", ls(B, "profile")["field"])

    # ---------- 退出登录后，这台设备上不再显示账号里的内容，上传的文件也不留在浏览器里 ----------
    synced(B)
    # 先在 B 上往案件里传两个文件：一个正常传到云端，另一个的上传一直失败（只有这个浏览器里有）
    FX = os.path.join(S, "fixtures")
    nav(B, "案件"); B.locator(".case-card").first.click()
    B.locator(".tabs button", has_text="文件").click()
    B.locator(".dropzone input[type=file]").set_input_files(os.path.join(FX, "cv.pdf"))
    B.locator(".file-list li", has_text="cv.pdf").wait_for(); time.sleep(2.5)
    B.route("**/api/files/*", lambda r: r.fulfill(status=403, body="{}") if r.request.method == "PUT" else r.continue_())
    B.locator(".dropzone input[type=file]").set_input_files(os.path.join(FX, "notes.txt"))
    B.locator(".file-list li", has_text="notes.txt").wait_for(); time.sleep(3); synced(B)
    ids = {f["name"]: f["id"] for c in ls(B, "cases") for f in c.get("files", [])}
    on_server = lambda: {r[0] for r in db("select file_id from user_files f join users u on u.id=f.user_id where u.email=?", (email,))}
    check("files: one upload reached the cloud, the other did not", ids["cv.pdf"] in on_server() and ids["notes.txt"] not in on_server(), (ids, on_server()))
    cached = sorted(B.evaluate(IDB_KEYS))
    check("files: both are cached in this browser while logged in", sorted(ids.values()) == cached, cached)
    B.locator("button.back").click()
    B.locator(".account-box button", has_text=email).click()
    B.get_by_role("button", name="退出登录").click()
    B.locator(".empty h3", has_text="还没有登录").wait_for()
    time.sleep(0.5)
    nav(B, "案件")
    check("logout: cases no longer shown on this device", B.locator(".case-card").count() == 0, B.locator(".case-card").count())
    check("logout: profile cleared from this browser", not (ls(B, "profile") or {}).get("firstName"), (ls(B, "profile") or {}).get("firstName"))
    cached = B.evaluate(IDB_KEYS)
    check("logout: a file that is safely in the cloud is removed from this browser", ids["cv.pdf"] not in cached, cached)
    check("logout: a file the cloud does not have yet is kept in this browser", ids["notes.txt"] in cached, cached)
    check("logout: the cloud copy is untouched", ids["cv.pdf"] in on_server())
    B.unroute("**/api/files/*")
    # 再登录，数据回来；刚才没传上去的文件自动补传，清掉的那个能从云端取回
    login_as(B, email); synced(B)
    check("login: data comes back from the cloud after logging in again", ls(B, "profile")["firstName"] == "Jane" and len(ls(B, "cases")) >= 3)
    for _ in range(20):
        if ids["notes.txt"] in on_server(): break
        time.sleep(0.5)
    check("login: the file that was only in this browser is uploaded after logging in again", ids["notes.txt"] in on_server())
    got = B.evaluate("async (id) => { const r = await fetch('/api/files/' + id); return [r.status, (await r.arrayBuffer()).byteLength]; }", ids["cv.pdf"])
    check("login: the removed file can be fetched back from the cloud", got[0] == 200 and got[1] == os.path.getsize(os.path.join(FX, "cv.pdf")), got)

    # ---------- 同一个浏览器换一个账号：互不串 ----------
    B.locator(".account-box button", has_text=email).click()
    B.get_by_role("button", name="退出登录").click()
    B.locator(".empty h3", has_text="还没有登录").wait_for()
    email2 = ui_login(B); synced(B)
    check("switch account: the new account starts empty", not ls(B, "profile").get("firstName") and ls(B, "cases") == [], (ls(B, "profile").get("firstName"), ls(B, "cases")))
    time.sleep(3)
    check("switch account: nothing of the first account was uploaded into the second", server(email2, "cases")[0] in (None, []) and (server(email2, "profile")[0] or {}).get("firstName") in (None, ""))
    check("switch account: the first account's data on the server is untouched", server(email, "profile")[0]["firstName"] == "Jane")

    # ---------- 没登录时填的内容，登录到已有账号后合并 ----------
    ctxC, C = new_page(b, "devC")
    C.goto(BASE + "/")
    nav(C, "案件")
    C.get_by_role("button", name="+ 创建第一个案件").click()
    C.locator(".case-form input").fill("Made offline on C")
    C.get_by_role("button", name="创建", exact=True).click()
    C.locator("h2", has_text="Made offline on C").wait_for()
    login_as(C, email); time.sleep(3); synced(C)
    names = sorted(c["name"] for c in server(email, "cases")[0])
    check("merge: a case made before logging in is added to the account, existing ones kept", "Made offline on C" in names and "Case from A" in names, names)
    check("merge: the existing profile is not wiped by the empty local one", server(email, "profile")[0]["firstName"] == "Jane")

    # ---------- 旧版本存的档案（没有新字段）还能正常打开 ----------
    ctxD, D = new_page(b, "devD")
    D.goto(BASE + "/")
    D.locator(".suggestions").wait_for(); time.sleep(0.8)   # 等页面自己读完、存完，再放旧数据进去
    old = {"firstName": "Old", "lastName": "User", "field": "X", "degrees": [], "papers": "3", "citations": "10", "hIndex": "2", "scholarUrl": "https://www.semanticscholar.org/author/1234",
           "publications": [{"title": "An old paper title", "year": 2020, "venue": "V", "citations": 10}], "scholarSource": {"source": "OpenAlex", "name": "Old User", "fetchedAt": 1}, "updatedAt": 5}
    D.evaluate("v => localStorage.setItem('pathway.profile', v)", json.dumps(old))
    D.evaluate("() => localStorage.setItem('pathway.cases', JSON.stringify([{id:'old1',name:'Old case',type:'NIW',createdAt:1,done:[]}]))")
    D.evaluate("() => localStorage.setItem('pathway.docs', 'not json at all')")
    D.reload()
    nav(D, "我的档案")
    for i in range(4):
        D.locator(".profile-tabs button").nth(i).click()
        time.sleep(0.2)
    check("legacy: an old-format profile opens on every tab without errors", D.locator(".profile-tabs button.on").inner_text().startswith("拟从事事业") and D.locator("section.card textarea").count() == 6)
    p2 = ls(D, "profile")
    check("legacy: old single-source data converted, link moved to its own box", p2["records"][0]["source"] == "OpenAlex" and p2["s2Url"].endswith("/1234") and p2["scholarUrl"] == "" and "endeavor" in p2 and "soc" in p2, {k: p2.get(k) for k in ["s2Url", "scholarUrl", "primarySource"]})
    nav(D, "案件"); D.locator(".case-card").first.click()
    for t in ["文档", "文件", "材料清单", "打包下载", "申请向导"]:
        D.locator(".tabs button", has_text=t).click()
    check("legacy: an old case without a files list opens on every tab", D.locator(".guide li.step").count() == 15)
    check("legacy: corrupt saved documents fall back to an empty list instead of crashing", D.locator(".tabs button", has_text="文档 0").count() == 1)
    b.close()
finish()
