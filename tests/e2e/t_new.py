"""这次改动的行为：撤销可恢复、清空对话、换文件、删除时清附件、掉线和登录失效、两个标签页换账号、提示不混进文档等。
需要模型回复的地方用假的接口回复代替（只测页面怎么处理），不调用模型。"""
import json, os, re, subprocess, time, uuid
from common import *
from fixture_profile import profile

FX = os.path.join(S, "fixtures")
NOTICE = "\u001e"

def ls(page, key):
    time.sleep(0.6)
    return json.loads(page.evaluate(f"localStorage.getItem('pathway.{key}')") or "null")
def server(email, key):
    r = db("select value, rev from user_data d join users u on u.id=d.user_id where u.email=? and key=?", (email, key))
    return json.loads(r[0][0]) if r else None
def files_on_server(email):
    return [r[0] for r in db("select file_id from user_files f join users u on u.id=f.user_id where u.email=?", (email,))]
def synced(page, timeout=20000):
    page.locator(".sync-state.ok").wait_for(timeout=timeout); time.sleep(0.3)
def login_as(page, email):
    page.goto(BASE + "/")
    page.locator(".account-box button", has_text="登录 / 注册").first.click()
    page.locator(".modal input[type=email]").fill(email)
    db("update login_codes set sent_at=0 where email=?", (email,))
    page.get_by_role("button", name="发送验证码").click()
    page.locator(".modal input[inputmode=numeric]").fill(page.locator(".dev-code strong").inner_text())
    page.locator(".modal button[type=submit]").click()
    page.locator(".account-email", has_text=email).wait_for()
def fake_chat(page, body, delay=0):
    """让 /api/chat 返回指定的内容（不调用模型）。"""
    def handler(route):
        if delay: time.sleep(delay)
        route.fulfill(status=200, content_type="text/plain; charset=utf-8", body=body)
    page.unroute("**/api/chat")
    page.route("**/api/chat", handler)
def send(page, text, scope=""):
    box = page.locator(f"{scope} .composer textarea".strip()).last
    box.fill(text); box.press("Enter")
    time.sleep(1.2)

with sync_playwright() as p:
    b = launch(p)
    ctx, page = new_page(b, "new")
    page.goto(BASE + "/")
    page.locator(".suggestions").wait_for(); time.sleep(0.6)
    now = int(time.time() * 1000)
    case = {"id": "c1", "name": "Test NIW", "type": "NIW", "createdAt": now, "done": [], "files": []}
    docs = [
        {"id": "d-ai", "title": "Zeta Draft", "kind": "Petition Letter", "content": "After AI edit.\n", "undo": "Before AI edit.\n", "updatedAt": now, "chat": [{"id": "m1", "role": "user", "text": "改一下"}, {"id": "m2", "role": "assistant", "text": "改好了"}], "caseId": "c1"},
        {"id": "d-wf", "title": "案件评估", "kind": "案件评估", "content": "", "updatedAt": now, "chat": [{"id": "m3", "role": "user", "text": "开始评估"}, {"id": "m4", "role": "assistant", "text": "先问你几个问题"}], "caseId": "c1", "skill": "case-strength-assessor"},
    ]
    page.evaluate("([p, c, d]) => { localStorage.setItem('pathway.profile', p); localStorage.setItem('pathway.cases', c); localStorage.setItem('pathway.docs', d); }",
                  [json.dumps(profile()), json.dumps([case]), json.dumps(docs)])
    page.reload()
    email = ui_login(page, credits=2000)
    synced(page)

    # ---------- 聊天框一直在：切到别的页面再回来，输入的内容还在 ----------
    page.locator(".composer textarea").fill("打了一半的问题")
    nav(page, "我的档案"); nav(page, "聊天")
    check("chat: half-typed text survives visiting another page", page.locator(".composer textarea").input_value() == "打了一半的问题")
    page.locator(".composer textarea").fill("")

    # ---------- 文档：撤销和恢复互为反操作 ----------
    nav(page, "案件"); page.locator(".case-card").first.click()
    g = page.locator(".guide li.step", has=page.locator("strong", has_text="案件评估"))
    check("guide: a workflow already started (chat only) is offered to continue, not restarted", g.get_by_role("button", name="继续和 AI 做：案件评估").count() == 1, g.inner_text())
    g.get_by_role("button", name="继续和 AI 做：案件评估").click()
    check("guide: continuing opens the existing conversation", "先问你几个问题" in page.locator(".chat-pane").inner_text())
    page.locator("button.back").click()
    page.locator(".tabs button", has_text="文档").click()
    page.locator(".case-card", has=page.locator("strong", has_text="Zeta Draft")).click()
    ed = page.locator("textarea.doc-editor")
    ed.fill("After AI edit.\nPlus a line I typed by hand.\n")
    page.get_by_role("button", name="↩ 撤销 AI 修改").click()
    check("undo: goes back to the text before the AI change", ed.input_value() == "Before AI edit.\n")
    check("undo: offers to restore what was just discarded", page.get_by_role("button", name="↪ 恢复").count() == 1 and page.get_by_role("button", name="↩ 撤销 AI 修改").count() == 0)
    page.get_by_role("button", name="↪ 恢复").click()
    check("undo: restore brings back the hand-typed text (nothing lost by a mis-click)", ed.input_value() == "After AI edit.\nPlus a line I typed by hand.\n" and page.get_by_role("button", name="↩ 撤销 AI 修改").count() == 1)

    # ---------- 文档对话：服务端的提示不写进文档；没写完要说明 ----------
    fake_chat(page, "我来重写。\n<doc_write>\n# New Letter\n\nFirst paragraph that was being writ" + NOTICE + "\n\n> 回复过长被截断，可以让我「继续」。")
    send(page, "重写全文", ".chat-pane")
    page.locator(".chat-pane .msg.assistant").nth(1).wait_for()
    time.sleep(0.8)
    content = ed.input_value(); reply = page.locator(".chat-pane .msg.assistant").last.inner_text()
    check("notice: a server notice is not written into the document", "截断" not in content and "First paragraph that was being writ" in content, content)
    check("notice: the chat shows the notice and says the document is incomplete", "回复过长被截断" in reply and "只写了一部分" in reply, reply)
    fake_chat(page, "好的。\n<doc_edit><find>New Letter</find><replace>Newer Letter</replace></doc_edit>\n<doc_edit><find>First paragraph" + NOTICE + "\n\n> ⚠️ 模型服务出错：upstream")
    send(page, "改标题", ".chat-pane")
    page.locator(".chat-pane .msg.assistant").nth(2).wait_for(); time.sleep(0.8)
    content = ed.input_value(); reply = page.locator(".chat-pane .msg.assistant").last.inner_text()
    check("notice: complete edits apply, the cut-off one is dropped and reported", "# Newer Letter" in content and "模型服务出错" in reply and "没写完就中断" in reply and "已修改文档 1 处" in reply, (content[:60], reply))
    fake_chat(page, "")
    send(page, "再来", ".chat-pane")
    page.locator(".chat-pane .msg.assistant").nth(3).wait_for(); time.sleep(0.5)
    check("empty reply: says so instead of showing a blank bubble", "没有收到回复" in page.locator(".chat-pane .msg.assistant").last.inner_text())

    # ---------- 清空对话 ----------
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="清空对话").click()
    check("clear chat: conversation emptied, document untouched", page.locator(".chat-pane .msg").count() == 0 and "# Newer Letter" in ed.input_value() and page.get_by_role("button", name="清空对话").count() == 0)
    page.locator("button.back").click()
    page.unroute("**/api/chat")

    # ---------- 文件：上传、替换（新 id、标题设置跟着走）、删除会清云端 ----------
    page.locator(".tabs button", has_text="文件").click()
    up = page.locator(".dropzone input[type=file]")
    up.set_input_files([os.path.join(FX, n) for n in ["cv.pdf", "award.pdf", "phone.jpg", "notes.txt", "Offer Letter.pdf" if os.path.exists(os.path.join(FX, "Offer Letter.pdf")) else "letter.pdf"]])
    page.locator(".file-list li").nth(4).wait_for()
    time.sleep(2.5)
    f0 = {f["name"]: f["id"] for f in ls(page, "cases")[0]["files"]}
    check("files: uploads mirrored to the cloud", set(f0.values()) <= set(files_on_server(email)), (f0, files_on_server(email)))
    page.locator(".tabs button", has_text="打包下载").click()
    li = lambda title: page.locator(".pack-list li", has=page.locator(f'input.pack-title[value="{title}"]')).first
    li("award").locator("input.pack-title").fill("Best Paper Award Certificate")
    li("cv").locator("input.pack-title").fill("")
    check("pack: an emptied title box shows the default as a hint", page.locator(".pack-list input.pack-title[placeholder='cv']").count() == 1)
    page.locator(".tabs button", has_text="文件").click()
    page.locator(".file-list li", has_text="award.pdf").locator("input[type=file]").set_input_files(os.path.join(FX, "landscape.pdf"))
    page.locator(".file-list .file-name", has_text="landscape.pdf").wait_for()
    time.sleep(3)
    c1 = ls(page, "cases")[0]
    new_id = next(f["id"] for f in c1["files"] if f["name"] == "landscape.pdf")
    check("replace: the new file gets a new id", new_id != f0["award.pdf"])
    check("replace: pack settings follow the file (custom title kept)", c1["pack"]["titles"].get(new_id) == "Best Paper Award Certificate" and f0["award.pdf"] not in c1["pack"]["titles"], c1.get("pack"))
    on = files_on_server(email)
    check("replace: new bytes uploaded, old copy removed from the cloud", new_id in on and f0["award.pdf"] not in on, (new_id in on, f0["award.pdf"] in on))

    # 打包：清空的标题用默认的；手机照片转正；纯文本保留换行；向导记下已打包
    page.locator(".tabs button", has_text="打包下载").click()
    with page.expect_download() as dl:
        page.get_by_role("button", name="生成并下载 PDF").click()
    pdf = os.path.join(SHOTS, "packet2.pdf"); dl.value.save_as(pdf)
    page.locator(".pack-actions .case-meta").wait_for()
    text = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
    check("pack: emptied title falls back to the default in the PDF", re.search(r"Exhibit \d+:\s+cv\b", text) is not None, text[:600])
    check("pack: custom title used for the replaced file", "Best Paper Award Certificate" in text and "LANDSCAPE page 1" in text)
    imgs = subprocess.run(["pdfimages", "-list", pdf], capture_output=True, text=True).stdout
    dims = [(int(l.split()[3]), int(l.split()[4])) for l in imgs.splitlines()[2:] if l.split()[2] == "image"]
    check("pack: a sideways phone photo is turned upright (600x800, not 800x600)", (600, 800) in dims and (800, 600) not in dims, dims)
    check("pack: plain text file keeps its line breaks", re.search(r"Plain text exhibit\.\n\s*Second line", text) is not None)
    page.locator(".tabs button", has_text="申请向导").click()
    pk = page.locator(".guide li.step", has=page.locator("strong", has_text="打包下载"))
    check("guide: packing step is marked done after a packet is generated", "done" in pk.get_attribute("class") and "上次生成于" in pk.inner_text(), pk.inner_text())

    # 推荐信的判断：普通的 letter.pdf / Offer Letter 不算，RL_Smith.pdf 算
    lt = page.locator(".guide li.step", has=page.locator("strong", has_text="准备推荐信"))
    check("guide: a file merely named 'letter' does not complete the letters step", "todo" in lt.get_attribute("class"), lt.get_attribute("class"))
    page.locator(".tabs button", has_text="文件").click()
    os.system(f"cp {FX}/letter.pdf {FX}/RL_Smith.pdf; cp {FX}/letter.pdf '{FX}/Recommendation Letter - Dr Lee.pdf'")
    up.set_input_files([os.path.join(FX, "RL_Smith.pdf")])
    page.locator(".file-list .file-name", has_text="RL_Smith.pdf").wait_for()
    page.locator(".tabs button", has_text="申请向导").click()
    lt = page.locator(".guide li.step", has=page.locator("strong", has_text="准备推荐信"))
    check("guide: a file named like a recommendation letter does", "done" in lt.get_attribute("class") and "上传了 1 封" in lt.inner_text(), lt.inner_text())

    # ---------- 聊天附件：移除没发出的、删除会话，云端的文件跟着清 ----------
    nav(page, "聊天")
    page.locator(".composer input[type=file]").set_input_files(os.path.join(FX, "media.md"))
    page.locator(".composer .chip-name", has_text="media.md").wait_for()
    time.sleep(2)
    before = set(files_on_server(email))
    page.locator(".composer .chip button").click()
    time.sleep(3)
    after = set(files_on_server(email))
    check("chat: removing an unsent attachment deletes its cloud copy", len(before - after) == 1 and len(after) == len(before) - 1, (len(before), len(after)))
    # 发一条带两个附件的消息：一个新上传的，一个从案件里引用的
    page.locator("select.case-link").select_option(label="关联：Test NIW")
    page.locator(".composer input[type=file]").set_input_files(os.path.join(FX, "media.md"))
    page.locator(".composer .chip-name", has_text="media.md").wait_for()
    page.locator(".picker-wrap button.attach").click()
    page.locator(".picker button", has_text="cv.pdf").click()
    fake_chat(page, "收到这两份材料。")
    send(page, "看看这两个文件")
    page.locator(".msg.assistant .md").wait_for(); time.sleep(3)
    conv = ls(page, "conversations")[0]
    att = {a["name"]: a["id"] for a in conv["messages"][0]["attachments"]}
    on = set(files_on_server(email))
    check("chat: sent attachments are in the cloud; the cited case file reuses the case's copy", att["media.md"] in on and att["cv.pdf"] == f0["cv.pdf"], att)
    page.once("dialog", lambda d: d.accept())
    page.locator(".history-del").first.click()
    time.sleep(3.5)
    on = set(files_on_server(email))
    check("delete conversation: its own attachment is removed from the cloud, the case's file is kept", att["media.md"] not in on and f0["cv.pdf"] in on, (att["media.md"] in on, f0["cv.pdf"] in on))

    # ---------- 聊天里的操作卡片：字符串里直接换行的也能读；读不懂的要说 ----------
    page.unroute("**/api/chat")
    fake_chat(page, '整理好了。\n<action>{"type":"endeavor","append":{"progress":"- First line\n- Second line"}}</action>\n<action>{"type":"profile","set":{"firstName": Jane}}</action>')
    send(page, "帮我补充进展")
    page.locator(".action-card").first.wait_for(); time.sleep(0.5)
    reply = page.locator(".msg.assistant").last.inner_text()
    check("actions: a block with raw line breaks still becomes a card", page.locator(".action-card").count() == 1 and "Second line" in page.locator(".action-card").inner_text())
    check("actions: an unreadable block is reported to the user", "1 项要填的内容没能整理成卡片" in reply, reply)
    page.locator(".action-card").get_by_role("button", name="应用").dblclick()
    time.sleep(1)
    prog = ls(page, "profile")["endeavor"]["progress"]
    check("actions: a double click applies once", prog.count("- First line") == 1, prog)
    page.unroute("**/api/chat")

    # ---------- 耗时操作：切走再回来仍然显示进行中，不会重复发起 ----------
    calls = {"n": 0}; held = []
    def slow_cite(route):
        calls["n"] += 1
        held.append(route)          # 先不回复，模拟要跑一分钟的分析
    page.route("**/api/citations", slow_cite)
    nav(page, "我的档案"); page.locator(".profile-tabs button").nth(1).click()
    nt = page.locator("section.card", has_text="重要引用（Notable Citations）").first
    row = nt.locator(".paper-pick > div", has_text="Transfer learning across battery chemistries")
    row.get_by_role("button").click()
    time.sleep(0.8)
    page.locator(".profile-tabs button").nth(0).click(); time.sleep(0.5)
    nav(page, "聊天"); time.sleep(0.3); nav(page, "我的档案")
    page.locator(".profile-tabs button").nth(1).click()
    nt = page.locator("section.card", has_text="重要引用（Notable Citations）").first
    row = nt.locator(".paper-pick > div", has_text="Transfer learning across battery chemistries")
    check("running: after leaving and returning, the analysis still shows as in progress", "分析中" in row.get_by_role("button").inner_text() and row.get_by_role("button").is_disabled(), row.get_by_role("button").inner_text())
    others = nt.locator(".paper-pick > div button").first
    check("running: other analyses cannot be started meanwhile", others.is_disabled())
    held[0].fulfill(status=200, content_type="application/json", body=json.dumps({"analysis": {"title": "Transfer learning across battery chemistries", "year": 2022, "paperUrl": "", "analyzedAt": now, "total": 61, "scanned": 61, "selfCitations": 1, "withContext": 2, "analyzed": 1,
        "items": [{"citingTitle": "A citing paper", "authors": "X", "venue": "V", "year": 2025, "citations": 3, "url": "", "topAuthor": "", "contexts": ["We build on Doe et al."], "category": "builds", "importance": "high", "reason": "r"}]}, "cost": 5}))
    nt.locator("details.notable", has_text="Transfer learning across battery chemistries").wait_for(timeout=15000)
    check("running: one request only, result saved although the page was left meanwhile", calls["n"] == 1 and any(a["title"].startswith("Transfer learning") for a in ls(page, "profile")["analyses"]), calls)
    page.unroute("**/api/citations")

    # ---------- 学术记录：手动填的数字不会被之后的获取覆盖；Google 拦截时的说明 ----------
    card = page.locator("section.card", has_text="学术记录").first
    card.locator(".grid2 input").nth(1).fill("600")
    page.route("**/api/scholar?q=*", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"candidates": [{"id": "A1", "name": "Jane Doe", "institution": "Example", "papers": 9, "citations": 99, "hIndex": 5}]})))
    page.route("**/api/scholar?id=*", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"source": "OpenAlex", "url": "https://openalex.org/A1", "author": {"id": "A1", "name": "Jane Doe", "papers": 9, "citations": 99, "hIndex": 5}, "works": [{"title": "Some paper title here", "year": 2020, "venue": "V", "citations": 9}]})))
    card.get_by_role("button", name=re.compile("OpenAlex")).click()
    page.locator(".candidates button").first.click()
    page.locator("details.pubs", has_text="OpenAlex").wait_for()
    pr = ls(page, "profile")
    check("scholar: numbers typed by hand are not overwritten by a later fetch", pr["citations"] == "600" and pr["primarySource"] == "" and len(pr["records"]) == 2, (pr["citations"], pr["primarySource"]))
    page.route("**/api/scholar?gs=*", lambda r: r.fulfill(status=502, content_type="application/json", body=json.dumps({"error": "Google 拦截了服务器的访问，没能直接读到你的主页。", "blocked": True})))
    card.locator("input[type=url]").nth(0).fill("scholar.google.com/citations?user=JicYPdAAAAAJ")
    card.get_by_role("button", name="获取", exact=True).first.click()
    page.locator(".gs-upload").wait_for()
    href = page.locator(".gs-upload a").get_attribute("href")
    check("gs upload: instructions link to the 100-per-page view of the user's own profile", "user=JicYPdAAAAAJ" in href and "pagesize=100" in href, href)
    page.unroute("**/api/scholar?gs=*"); page.unroute("**/api/scholar?q=*"); page.unroute("**/api/scholar?id=*")

    # ---------- 网络断了：退出登录时没传上去的内容不清掉 ----------
    synced(page)
    page.route("**/api/data", lambda r: r.abort() if r.request.method == "PUT" else r.continue_())
    page.locator(".profile-tabs button").nth(0).click()
    page.locator("section.card", has_text="基本信息").locator("input").nth(2).fill("离线时改的中文名")
    time.sleep(0.5)
    page.locator(".account-box button", has_text=email).click()
    page.get_by_role("button", name="退出登录").click()
    page.locator(".empty h3", has_text="还没有登录").wait_for(timeout=20000)
    check("logout while offline: unsynced content stays in the browser, with an explanation", ls(page, "profile")["chineseName"] == "离线时改的中文名" and "还没来得及保存到云端" in page.locator(".toast").inner_text())
    page.unroute("**/api/data")
    login_as(page, email); time.sleep(3); synced(page)
    check("login again: the unsynced change is uploaded", server(email, "profile")["chineseName"] == "离线时改的中文名")

    # ---------- 打开页面时服务器暂时连不上：过一会儿自动重试 ----------
    state = {"fail": True}
    page.route("**/api/data", lambda r: r.abort() if (state["fail"] and r.request.method == "GET") else r.continue_())
    page.reload(); page.locator(".account-email").wait_for()
    page.locator(".sync-state.error").wait_for(timeout=10000)
    state["fail"] = False
    page.locator(".sync-state.ok").wait_for(timeout=20000)
    check("first sync failed: retried automatically once the server is reachable", True)
    page.unroute("**/api/data")

    # ---------- 登录过期后继续编辑，再登录：本机的修改不丢，别的设备的修改也在 ----------
    db("delete from sessions where user_id=(select id from users where email=?)", (email,))
    nav(page, "我的档案")
    page.locator("section.card", has_text="基本信息").locator("input").nth(2).fill("过期后改的")
    page.locator(".account-box button", has_text="登录 / 注册").wait_for(timeout=15000)   # 保存失败后页面发现登录已失效
    check("session expired: the page notices and shows the login button", True)
    page.locator("section.card", has=page.locator("h3", has_text="工作与未来计划")).locator("input").first.fill("Edited while logged out")
    # 这期间「另一台设备」改了服务器上的档案
    uidrow = db("select id from users where email=?", (email,))[0][0]
    sp = server(email, "profile"); sp["field"] = "Changed on the phone"; sp["updatedAt"] = int(time.time() * 1000)
    db("update user_data set value=?, rev=rev+1 where user_id=? and key='profile'", (json.dumps(sp, ensure_ascii=False), uidrow))
    time.sleep(0.8)
    login_as(page, email); time.sleep(3.5); synced(page)
    sp = server(email, "profile")
    check("after logging in again: edits made while logged out and edits from the other device are both there", sp["currentPosition"] == "Edited while logged out" and sp["chineseName"] == "过期后改的" and sp["field"] == "Changed on the phone", {k: sp[k] for k in ["currentPosition", "chineseName", "field"]})

    # ---------- 本机存储满了：给出提示，下次以云端为准 ----------
    page.evaluate("""() => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'pathway.profile') throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); }; }""")
    nav(page, "我的档案")
    page.locator("section.card", has_text="基本信息").locator("input").nth(2).fill("存不进本机")
    time.sleep(3.5)
    check("storage full: a warning is shown", "存储空间满了" in page.locator(".sync-state").inner_text(), page.locator(".sync-state").inner_text())
    check("storage full: the change still reaches the cloud", server(email, "profile")["chineseName"] == "存不进本机")
    page.reload(); page.locator(".account-email").wait_for(); synced(page)
    check("storage full: after reload the newer cloud copy is used, not the stale local one", ls(page, "profile")["chineseName"] == "存不进本机", ls(page, "profile")["chineseName"])

    # ---------- 同一个浏览器两个标签页：另一个标签页换了账号 ----------
    tab2 = ctx.new_page(); tab2.set_default_timeout(15000); watch(tab2, "tab2")
    tab2.goto(BASE + "/"); tab2.locator(".account-email", has_text=email).wait_for(); time.sleep(1)
    tab2.locator(".account-box button", has_text=email).click()
    tab2.get_by_role("button", name="退出登录").click()
    tab2.locator(".empty h3", has_text="还没有登录").wait_for()
    email_b = ui_login(tab2)                       # 标签页 2 现在是账号 B；标签页 1 的页面上还是账号 A 的内容
    time.sleep(1)
    page.bring_to_front()
    nav(page, "我的档案")
    page.locator("section.card", has_text="基本信息").locator("input").nth(2).fill("旧标签页里改的")
    # 标签页 1 发现账号换了，跟着换过去。有两条路：保存时被服务器拒绝后发现；或者切回这个标签页时先发现已经不是原来的登录状态
    page.locator(f".account-email:has-text('{email_b}'), .account-box button:has-text('登录 / 注册')").first.wait_for(timeout=20000)
    if not page.locator(".account-email", has_text=email_b).count():
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.locator(".account-email", has_text=email_b).wait_for(timeout=20000)
    time.sleep(3.5)
    sb = server(email_b, "profile"); cb = server(email_b, "cases")
    check("two tabs: the first account's data never lands in the second account", (sb is None or not sb.get("firstName")) and (cb is None or cb == []), (sb and sb.get("firstName"), cb))
    check("two tabs: the first account's cloud data is untouched", server(email, "profile")["firstName"] == "Jane" and server(email, "profile")["chineseName"] == "存不进本机")
    check("two tabs: the stale tab now shows the second account (empty), not the first one's content", not ls(page, "profile").get("firstName") and ls(page, "cases") == [])
    # 账号 A 再登录：旧标签页里那次没传上去的修改被找回来
    page.locator(".account-box button", has_text=email_b).click()
    page.get_by_role("button", name="退出登录").click()
    page.locator(".empty h3", has_text="还没有登录").wait_for()
    login_as(page, email); time.sleep(3.5); synced(page)
    check("two tabs: the edit made in the stale tab is recovered when its owner logs in again", server(email, "profile")["chineseName"] == "旧标签页里改的", server(email, "profile")["chineseName"])
    b.close()
finish()
