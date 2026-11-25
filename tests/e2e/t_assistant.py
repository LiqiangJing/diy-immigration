"""聊天助手替用户操作系统：按编号填项目、清空、撤销、案件和文档、会话、带用户去某一页。
模型的回复用假的接口回复代替（只测页面怎么处理卡片），不调用模型。例子里的人和成果都是虚构的。"""
import json, os, time
from common import *

FX = os.path.join(S, "fixtures")

def ls(page, key):
    time.sleep(0.7)
    return json.loads(page.evaluate(f"localStorage.getItem('pathway.{key}')") or "null")
def files_on_server(email):
    return [r[0] for r in db("select file_id from user_files f join users u on u.id=f.user_id where u.email=?", (email,))]
def reply(page, *actions, text="整理成了下面的卡片。"):
    """下一条消息的回复：一段话加若干个操作。"""
    body = text + "".join(f"\n<action>{json.dumps(a, ensure_ascii=False)}</action>" for a in actions)
    page.unroute("**/api/chat")
    page.route("**/api/chat", lambda route: route.fulfill(status=200, content_type="text/plain; charset=utf-8", body=body))
def send(page, text):
    n = page.locator(".msg.assistant").count()
    box = page.locator(".composer textarea").last
    box.fill(text); box.press("Enter")
    page.locator(".msg.assistant").nth(n).wait_for()
    time.sleep(1.0)
def cards(page):
    return page.locator(".msg.assistant").last.locator(".action-card")
def projects(page):
    return (ls(page, "profile") or {}).get("soc", {}).get("projects", [])

with sync_playwright() as p:
    b = launch(p)
    ctx, page = new_page(b, "assistant")
    email = ui_login(page, credits=3000)

    # ---------- 项目 1 是空的：让助手填，内容要进项目 1，而不是多出一个项目 2 ----------
    nav(page, "我的档案")
    page.locator(".profile-tabs button", has_text="贡献总结").click()
    page.get_by_role("button", name="+ 添加项目").click()
    check("setup: an empty project 1 exists on the page", len(projects(page)) == 1 and projects(page)[0]["title"] == "")
    blank_id = projects(page)[0]["id"]
    nav(page, "聊天")
    P = {"title": "Sodium Battery Lifetime Model", "start": "08/2023", "end": "进行中", "outputs": "Paper A", "summary": "I built a model that predicts battery lifetime."}
    reply(page, {"type": "soc", "addProjects": [P]})
    send(page, "帮我填写项目 1")
    card = cards(page).first
    check("project: the card says the content goes into the empty project 1", "填进现在空着的项目 1" in card.inner_text(), card.inner_text()[:300])
    card.get_by_role("button", name="应用", exact=True).click()
    page.locator(".action-card.applied").wait_for()
    ps = projects(page)
    check("project: project 1 is filled, no project 2 appears", len(ps) == 1 and ps[0]["id"] == blank_id and ps[0]["title"] == P["title"], ps)
    check("project: the applied card offers undo", card.get_by_role("button", name="撤销").count() == 1)
    card.get_by_role("button", name="去看填好的页面 →").click()
    check("project: the page shows it as project 1", page.locator("input").filter(has=page.locator("xpath=self::*[@value='Sodium Battery Lifetime Model']")).count() >= 1 or P["title"] in page.content())
    nav(page, "聊天")

    # ---------- 撤销：改回去，卡片回到待确认；可以再应用 ----------
    card = cards(page).first
    card.get_by_role("button", name="撤销").click()
    time.sleep(0.5)
    ps = projects(page)
    check("undo: project 1 is empty again and still there", len(ps) == 1 and ps[0]["id"] == blank_id and ps[0]["title"] == "" and ps[0]["summary"] == "", ps)
    check("undo: the card is back to pending and says so", "pending" in card.get_attribute("class") and "已撤销" in card.inner_text() and card.get_by_role("button", name="应用", exact=True).count() == 1, card.inner_text()[-200:])
    card.get_by_role("button", name="应用", exact=True).click()
    page.locator(".action-card.applied").wait_for()
    check("undo: the card can be applied again", projects(page)[0]["title"] == P["title"])

    # ---------- 按编号改、清空某一项、删掉一个项目 ----------
    reply(page, {"type": "soc", "addProjects": [{"title": "Stray Project", "summary": "Put in the wrong place."}], "set": {"awards": "Best Paper Award, Example Conference, 2025"}})
    send(page, "再加一个")
    cards(page).first.get_by_role("button", name="应用", exact=True).click()
    page.locator(".msg.assistant").last.locator(".action-card.applied").wait_for()
    check("project: with no empty slot the new project becomes project 2", [x["title"] for x in projects(page)] == [P["title"], "Stray Project"], projects(page))
    reply(page, {"type": "soc", "updateProjects": [{"match": "项目 1", "set": {"funding": "NSF Grant 0000000"}, "clear": ["outputs"]}], "removeProjects": ["Project 2"], "clear": ["awards"]})
    send(page, "项目 1 加上经费，成果清空，删掉项目 2，奖项也清空")
    card = cards(page).first
    text = card.inner_text()
    check("edit: rows name the project by number; removals are marked", "项目 1「Sodium Battery Lifetime Model」的经费来源" in text and "删除项目 2「Stray Project」" in text and "清空：奖项" in text and card.locator(".action-row.danger").count() == 3, text[:500])
    card.get_by_role("button", name="应用", exact=True).click()
    page.locator(".msg.assistant").last.locator(".action-card.applied").wait_for()
    prof = ls(page, "profile")
    ps = prof["soc"]["projects"]
    check("edit: applied to the right project", len(ps) == 1 and ps[0]["funding"] == "NSF Grant 0000000" and ps[0]["outputs"] == "" and prof["soc"]["awards"] == "", ps)
    check("edit: the applied card still shows what it did", "删除项目 2「Stray Project」" in card.inner_text() and "Best Paper Award" in card.inner_text(), card.inner_text()[:500])
    card.get_by_role("button", name="撤销").click(); time.sleep(0.5)
    prof = ls(page, "profile")
    ps = prof["soc"]["projects"]
    check("undo: removed project, cleared text and replaced field are all back", [x["title"] for x in ps] == [P["title"], "Stray Project"] and ps[0]["outputs"] == "Paper A" and ps[0]["funding"] == "" and prof["soc"]["awards"].startswith("Best Paper"), prof["soc"])

    # ---------- 后一张卡片改过的地方，前一张不能先撤销 ----------
    reply(page, {"type": "soc", "set": {"importance": "First version."}})
    send(page, "写重要性")
    first = cards(page).first
    first.get_by_role("button", name="应用", exact=True).click(); time.sleep(0.4)
    reply(page, {"type": "soc", "set": {"importance": "Second version."}})
    send(page, "改一下重要性")
    second = cards(page).first
    check("stack: the later card shows what it replaces", "会替换掉原来的内容：First version." in second.inner_text())
    second.get_by_role("button", name="应用", exact=True).click(); time.sleep(0.4)
    first = page.locator(".msg.assistant").nth(page.locator(".msg.assistant").count() - 2).locator(".action-card").first
    first.get_by_role("button", name="撤销").click(); time.sleep(0.4)
    check("stack: undoing the earlier card first changes nothing and explains why", ls(page, "profile")["soc"]["importance"] == "Second version." and "请先撤销后面那张" in first.inner_text() and "applied" in first.get_attribute("class"), first.inner_text()[-200:])
    second.get_by_role("button", name="撤销").click(); time.sleep(0.4)
    first.get_by_role("button", name="撤销").click(); time.sleep(0.4)
    check("stack: later first, then earlier, restores the original", ls(page, "profile")["soc"]["importance"] == "", ls(page, "profile")["soc"]["importance"])

    # ---------- 基本资料：学位的增删改 ----------
    reply(page, {"type": "profile", "set": {"firstName": "Jane", "lastName": "Doe"}, "addDegrees": [{"type": "Bachelor", "major": "Physics", "university": "Example University", "year": "2015"}, {"type": "PhD", "major": "Materials Science", "university": "Sample Institute", "year": "2021"}]})
    send(page, "填基本资料")
    cards(page).first.get_by_role("button", name="应用", exact=True).click(); time.sleep(0.4)
    reply(page, {"type": "profile", "updateDegrees": [{"match": "学位 2", "set": {"year": "2022"}}], "removeDegrees": ["学位 1"], "clear": ["lastName"]})
    send(page, "博士是 2022 年，删掉本科，姓先清空")
    card = cards(page).first
    check("degrees: the card lists the edit, the removal and the cleared field", "学位 2 的年份" in card.inner_text() and "删除学位 1" in card.inner_text() and "清空：姓" in card.inner_text(), card.inner_text()[:400])
    card.get_by_role("button", name="应用", exact=True).click(); time.sleep(0.4)
    prof = ls(page, "profile")
    check("degrees: applied", [(d["major"], d["year"]) for d in prof["degrees"]] == [("Materials Science", "2022")] and prof["lastName"] == "" and prof["firstName"] == "Jane", prof["degrees"])
    card.get_by_role("button", name="撤销").click(); time.sleep(0.4)
    prof = ls(page, "profile")
    check("degrees: undone", [d["year"] for d in prof["degrees"]] == ["2015", "2021"] and prof["lastName"] == "Doe", prof["degrees"])

    # ---------- 案件：新建、改、文档、文件、删除 ----------
    page.locator(".composer input[type=file]").set_input_files(os.path.join(FX, "media.md"))
    page.locator(".composer .chip-name", has_text="media.md").wait_for()
    reply(page,
          {"type": "case", "name": "Battery NIW", "caseType": "NIW"},
          {"type": "saveFile", "file": "media.md", "case": "Battery NIW", "title": "Media Coverage - Example Daily, 2025"},
          {"type": "doc", "case": "Battery NIW", "title": "Personal Statement Draft", "kind": "其他文档", "content": "# Personal Statement\n\nI work on sodium batteries."},
          {"type": "caseDelete", "case": "Battery NIW"})
    send(page, "建案件，存文件，存一份文档")
    cs = cards(page)
    check("case: four cards; file and document wait for the case; the deletion stands apart", cs.count() == 4 and cs.nth(1).get_by_role("button", name="应用", exact=True).is_disabled() and cs.nth(2).get_by_role("button", name="应用", exact=True).is_disabled() and "danger" in cs.nth(3).get_attribute("class"), [c.inner_text()[:80] for c in cs.all()])
    check("case: a deletion that cannot find its case yet cannot be confirmed", cs.nth(3).get_by_role("button", name="确认删除").is_disabled())
    page.get_by_role("button", name="全部应用").click()
    page.locator(".msg.assistant").last.locator(".action-card.applied").nth(2).wait_for()
    time.sleep(0.8)
    case = ls(page, "cases")[0]
    docs = ls(page, "docs")
    check("case: bulk apply creates the case, stores the file and the document", case["name"] == "Battery NIW" and [f["name"] for f in case["files"]] == ["Media Coverage - Example Daily, 2025.md"] and len(docs) == 1 and docs[0]["caseId"] == case["id"] and docs[0]["content"].startswith("# Personal Statement"), (case, docs))
    check("case: bulk apply leaves the deletion for a separate confirmation", "pending" in cs.nth(3).get_attribute("class") and len(ls(page, "cases")) == 1 and "删除后不能恢复" in cs.nth(3).inner_text(), cs.nth(3).inner_text())
    cs.nth(3).get_by_role("button", name="忽略").click()
    # 文档卡片：点「去看」直接打开那份文档
    cs.nth(2).get_by_role("button", name="去看填好的页面 →").click()
    page.locator(".doc-title").wait_for()
    check("doc: 'go and see' opens the new document itself", page.locator(".doc-title").input_value() == "Personal Statement Draft")
    nav(page, "聊天")
    # 撤销存文件：案件里那份和云端的内容都清掉
    time.sleep(3)
    saved = case["files"][0]["id"]
    check("file: the stored copy reached the cloud", saved in files_on_server(email), files_on_server(email))
    cards(page).nth(1).get_by_role("button", name="撤销").click()
    time.sleep(3.5)
    check("undo: the stored file leaves the case and the cloud", ls(page, "cases")[0]["files"] == [] and saved not in files_on_server(email), (ls(page, "cases")[0]["files"], saved in files_on_server(email)))
    cards(page).nth(1).get_by_role("button", name="应用", exact=True).click(); time.sleep(0.8)
    fname = ls(page, "cases")[0]["files"][0]["name"]

    reply(page,
          {"type": "caseEdit", "case": "Battery NIW", "rename": "NIW - Jane Doe", "eb2": "advanced", "check": ["cv", "简历 / CV", "niw-degree"]},
          {"type": "caseFile", "case": "Battery NIW", "file": fname, "rename": "Exhibit - Example Daily"},
          {"type": "docEdit", "doc": "Personal Statement Draft", "rename": "Personal Statement"})
    send(page, "改名，勾清单，文件和文档也改名")
    page.get_by_role("button", name="全部应用").click(); time.sleep(0.8)
    case = ls(page, "cases")[0]
    check("case: renamed, EB-2 route chosen, checklist ticked once each", case["name"] == "NIW - Jane Doe" and case.get("eb2") == "advanced" and sorted(case["done"]) == ["cv", "niw-degree"], case)
    check("case: file renamed keeping its extension; document renamed", case["files"][0]["name"] == "Exhibit - Example Daily.md" and ls(page, "docs")[0]["title"] == "Personal Statement", (case["files"], ls(page, "docs")[0]["title"]))
    cards(page).first.get_by_role("button", name="去看填好的页面 →").click()
    check("case: 'go and see' opens the checklist of that case", page.locator(".tabs button.on", has_text="材料清单").count() == 1 and page.locator("h2", has_text="NIW - Jane Doe").count() == 1)
    nav(page, "聊天")
    cards(page).first.get_by_role("button", name="撤销").click(); time.sleep(0.5)
    case = ls(page, "cases")[0]
    check("undo: case name, route and checklist restored", case["name"] == "Battery NIW" and not case.get("eb2") and case["done"] == [], case)

    # 删除：单独确认，删了就没有撤销
    time.sleep(3)
    held = [f["id"] for f in ls(page, "cases")[0]["files"]]
    reply(page, {"type": "caseFile", "case": "Battery NIW", "file": "Exhibit - Example Daily.md", "remove": True}, {"type": "docEdit", "doc": "Personal Statement", "remove": True})
    send(page, "删掉那个文件和那份文档")
    cs = cards(page)
    check("delete: no bulk button for deletions; each asks for confirmation", page.get_by_role("button", name="全部应用").count() == 0 and cs.nth(0).get_by_role("button", name="确认删除").count() == 1 and cs.nth(1).get_by_role("button", name="确认删除").count() == 1)
    cs.nth(0).get_by_role("button", name="确认删除").click(); time.sleep(0.4)
    cs.nth(1).get_by_role("button", name="确认删除").click(); time.sleep(3.5)
    check("delete: file and document are gone, from the cloud too, and there is no undo", ls(page, "cases")[0]["files"] == [] and ls(page, "docs") == [] and held[0] not in files_on_server(email) and cs.get_by_role("button", name="撤销").count() == 0 and cs.get_by_role("button", name="去看填好的页面 →").count() == 0, (ls(page, "cases")[0]["files"], ls(page, "docs")))
    reply(page, {"type": "caseDelete", "case": "Battery NIW"})
    send(page, "把这个案件删掉")
    card = cards(page).first
    check("delete: the case card says what goes with it", "0 份文档、0 个文件" in card.inner_text() and "删除后不能恢复" in card.inner_text(), card.inner_text())
    card.get_by_role("button", name="确认删除").click(); time.sleep(0.6)
    check("delete: the case is gone", ls(page, "cases") == [])

    # ---------- 会话：改名、关联案件、新建、删除 ----------
    reply(page, {"type": "case", "name": "EB-1A Plan", "caseType": "EB-1A"})
    send(page, "新建一个 EB-1A 案件")
    cards(page).first.get_by_role("button", name="应用", exact=True).click(); time.sleep(0.5)
    old_title = page.locator(".history-item.on .history-title").inner_text()
    reply(page, {"type": "chat", "op": "rename", "title": "档案整理"}, {"type": "chat", "op": "link", "case": "EB-1A Plan"})
    send(page, "把这个会话改名叫档案整理，关联到 EB-1A 案件")
    page.get_by_role("button", name="全部应用").click(); time.sleep(0.6)
    conv = next(c for c in ls(page, "conversations") if c["title"] == "档案整理")
    check("chat: the conversation is renamed and linked to the case", page.locator(".history-item.on .history-title").inner_text() == "档案整理" and conv.get("caseId") == ls(page, "cases")[0]["id"] and "EB-1A Plan" in page.locator("select.case-link option:checked").inner_text())
    cards(page).nth(0).get_by_role("button", name="撤销").click(); time.sleep(0.5)
    check("chat: undoing the rename restores the old title and keeps the link", page.locator(".history-item.on .history-title").inner_text() == old_title and next(c for c in ls(page, "conversations") if c["title"] == old_title).get("caseId"), page.locator(".history-item.on .history-title").inner_text())
    reply(page, {"type": "chat", "op": "new", "title": "EB-1A 评估", "case": "EB-1A Plan"})
    send(page, "新开一个会话聊 EB-1A")
    card = cards(page).first
    check("chat: the new-conversation card has its own button and no bulk apply", card.get_by_role("button", name="新建并打开").count() == 1)
    card.get_by_role("button", name="新建并打开").click(); time.sleep(0.8)
    check("chat: the new conversation is open, empty, titled and linked", page.locator(".history-item.on .history-title").inner_text() == "EB-1A 评估" and page.locator(".chat-empty").count() == 1 and "EB-1A Plan" in page.locator("select.case-link option:checked").inner_text(), page.locator(".history-title").all_inner_texts())
    reply(page, {"type": "chat", "op": "delete", "match": old_title}, {"type": "chat", "op": "delete", "match": "EB-1A 评估"})
    send(page, "把之前那个会话删掉，这个也删掉")
    cs = cards(page)
    check("chat: it can delete another conversation but not the one it is in", cs.nth(0).get_by_role("button", name="确认删除").is_enabled() and cs.nth(1).get_by_role("button", name="确认删除").is_disabled() and "不能在这个会话里删除它自己" in cs.nth(1).inner_text(), cs.nth(1).inner_text())
    cs.nth(0).get_by_role("button", name="确认删除").click(); time.sleep(0.6)
    check("chat: the other conversation is gone", old_title not in page.locator(".history-title").all_inner_texts() and len(ls(page, "conversations")) == 1, page.locator(".history-title").all_inner_texts())

    # ---------- 带用户去某一页 ----------
    reply(page, {"type": "go", "to": "profile.scholar"}, {"type": "go", "to": "case.pack", "case": "EB-1A Plan"}, {"type": "go", "to": "account"}, text="获取学术数据要在档案里做，我带你过去。")
    send(page, "帮我获取学术数据")
    cs = cards(page)
    check("go: three cards with an open button, no apply and no bulk apply", cs.count() == 3 and cs.get_by_role("button", name="打开 →").count() == 3 and cs.get_by_role("button", name="应用", exact=True).count() == 0 and page.get_by_role("button", name="全部应用").count() == 0, [c.inner_text() for c in cs.all()])
    cs.nth(0).get_by_role("button", name="打开 →").click()
    check("go: lands on the scholar tab of the profile", page.locator(".profile-tabs button.on", has_text="学术记录与引用").count() == 1)
    nav(page, "聊天")
    cards(page).nth(1).get_by_role("button", name="打开 →").click()
    check("go: lands on the pack tab of the named case", page.locator(".tabs button.on", has_text="打包下载").count() == 1 and page.locator("h2", has_text="EB-1A Plan").count() == 1)
    nav(page, "聊天")
    cards(page).nth(2).get_by_role("button", name="打开 →").click()
    check("go: lands on the account page", page.locator(".account-box button.on").count() == 1)
    nav(page, "聊天")

    # ---------- 刷新之后：已应用的卡片还在，还能撤销 ----------
    reply(page, {"type": "endeavor", "set": {"statement": "My proposed endeavor is to extend battery lifetime."}})
    send(page, "写拟从事事业")
    cards(page).first.get_by_role("button", name="应用", exact=True).click(); time.sleep(1.2)
    page.reload()
    page.locator(".account-email", has_text=email).wait_for()
    page.locator(".history-title").first.click()
    card = page.locator(".msg.assistant").last.locator(".action-card")
    card.wait_for()
    check("reload: the applied card and its content survive", "applied" in card.get_attribute("class") and "extend battery lifetime" in card.inner_text())
    card.get_by_role("button", name="撤销").click(); time.sleep(0.5)
    check("reload: undo still works from the stored record", ls(page, "profile")["endeavor"]["statement"] == "" and "pending" in card.get_attribute("class"))
    b.close()
finish()
