"""聊天：问答、停止、用聊天填拟从事事业和档案、建案件、存文件；文档工作区里让 AI 写和改。模型走本机的测试通道。"""
import json, os, re, time
from common import *

def LS(page, key):
    time.sleep(0.6)  # 存进浏览器有 0.4 秒的延迟
    return page.evaluate(f"localStorage.getItem('{key}')") or "{}"  # 还没填过内容时浏览器里没有这一项

from fixture_profile import profile

FX = os.path.join(S, "fixtures")
LONG = 240_000

def wait_reply(page, timeout=LONG):
    """等这一轮回复结束（发送按钮从「停止」变回「发送」）。"""
    page.locator("button.send.stop").wait_for(state="visible", timeout=20000)
    page.locator("button.send.stop").wait_for(state="detached", timeout=timeout)
    time.sleep(0.4)

def send(page, text):
    box = page.locator(".composer textarea").last
    box.fill(text)
    box.press("Enter")

def credits(email):
    return db("select credits from users where email=?", (email,))[0][0]

with sync_playwright() as p:
    b = launch(p)
    ctx, page = new_page(b, "chat")
    page.goto(BASE + "/")

    # 没登录时点建议或发送：弹出登录框，不发请求
    check("chat: six starter suggestions", page.locator(".suggestions button").count() == 6, page.locator(".suggestions button").all_inner_texts())
    page.locator(".suggestions button").first.click()
    check("chat: anonymous send opens the login dialog", page.locator(".modal h3", has_text="登录 / 注册").count() == 1 and page.locator(".msg").count() == 0)
    page.locator(".modal").get_by_role("button", name="取消").click()

    email = ui_login(page, credits=6000)

    # ---------- 1. 普通问答 ----------
    before = credits(email)
    send(page, "用两句话说明 NIW 的三项要求分别是什么。")
    page.locator(".msg.user .bubble").wait_for()
    check("chat: typing indicator or streamed text while busy", page.locator(".typing, .msg.assistant .md").count() >= 1)
    wait_reply(page)
    ans = page.locator(".msg.assistant .md").last.inner_text()
    check("chat: got an on-topic answer", len(ans) > 40 and ("国家" in ans or "Dhanasar" in ans), ans[:200])
    check("chat: no action cards for a plain question", page.locator(".action-card").count() == 0)
    check("chat: conversation appears in history with the message as title", page.locator(".history-title").first.inner_text().startswith("用两句话说明 NIW"), page.locator(".history-title").all_inner_texts())
    time.sleep(1.5)
    after = credits(email)
    led = db("select delta, reason from ledger l join users u on u.id=l.user_id where u.email=? order by l.id desc limit 1", (email,))[0]
    check("chat: charged once, matching the ledger", before - after == -led[0] and led[1] == "聊天" and before - after >= 1, (before, after, led))
    shown = page.locator(".account-credits").inner_text()
    check("chat: balance in the sidebar refreshed", str(after) in shown, shown)
    print("  cost of a plain question on the test channel:", before - after)

    # ---------- 2. 中途停止 ----------
    before = credits(email)
    send(page, "请详细写一篇 1500 字的文章，介绍 EB-1A 十项标准每一项的证据要求。")
    page.locator("button.send.stop").wait_for(state="visible", timeout=20000)
    page.locator(".msg.assistant .md").nth(1).wait_for(timeout=120000)  # 等它开始出字
    time.sleep(1.5)
    page.locator("button.send.stop").click()
    page.locator("button.send.stop").wait_for(state="detached", timeout=20000)
    last = page.locator(".msg.assistant .md").last.inner_text()
    check("chat: stop keeps the partial text and says it was stopped", "已停止生成" in last and len(last) > 20, last[-120:])
    time.sleep(2.5)
    cost_stop = before - credits(email)
    check("chat: a stopped reply is charged only a small amount", 1 <= cost_stop <= 40, cost_stop)
    check("chat: composer usable again after stop", page.locator("button.send").is_visible() and page.locator(".composer textarea").is_enabled())

    # ---------- 3. 用聊天填拟从事事业 ----------
    page.get_by_role("button", name="+ 新建会话").click()
    check("chat: new conversation starts empty", page.locator(".msg").count() == 0 and page.locator(".suggestions").count() == 1)
    msg = ("我在申请 NIW，拟从事事业已经想清楚了，请直接帮我填进档案，不用再问。"
           "一句话是：My proposed endeavor is to develop data-driven methods that predict the lifetime of lithium-ion batteries from early test data in order to shorten battery development in the United States. "
           "未来计划：2027–2028 年把模型扩展到商用电芯，两家电池厂已经签了意向书给我数据，并发布开源基准；2028–2030 年做一个一周内估算电芯寿命的认证工具，在一家美国厂商试点。"
           "身份：我现在是加州 Example Labs 的 Research Scientist，会继续做，但这件事不依赖这一家单位。"
           "已有进展：开源软件 BattLife 下载约 12000 次；Example Motors 在测试流程里用了它。"
           "另外我的名字是 Jane Doe，博士 2022 年毕业于 Example University，专业 Materials Science。")
    send(page, msg)
    wait_reply(page)
    cards = page.locator(".action-card")
    titles = [c.locator(".action-head strong").inner_text() for c in cards.all()]
    print("  cards:", titles)
    check("actions: an endeavor card is proposed", any("拟从事事业" in t for t in titles), titles)
    check("actions: a basic-profile card is proposed for the name and degree", any("基本资料" in t for t in titles), titles)
    check("actions: tags are hidden from the chat text", "<action>" not in page.locator(".msg.assistant").last.inner_text())
    ecard = page.locator(".action-card", has=page.locator("strong", has_text="拟从事事业")).first
    rows = {r.locator("span").first.inner_text(): r.locator("div").first.inner_text() for r in ecard.locator(".action-row").all()}
    print("  endeavor rows:", {k: v[:60] for k, v in rows.items()})
    stmt_row = next((v for k, v in rows.items() if k.startswith("要做的事")), "")
    check("actions: the statement is kept verbatim", "My proposed endeavor is to develop data-driven methods that predict the lifetime of lithium-ion batteries" in stmt_row, stmt_row)
    check("actions: plan, role and progress rows present", sum(1 for k in rows if k.startswith(("未来三到五年", "在哪里", "已有的进展"))) == 3, list(rows))
    check("actions: nothing written before the user confirms", not json.loads(LS(page, 'pathway.profile')).get("endeavor", {}).get("statement"))
    shot(page, "chat-endeavor-card", full=False)
    # 全部应用
    if page.get_by_role("button", name="全部应用").count():
        page.get_by_role("button", name="全部应用").click()
    else:
        ecard.get_by_role("button", name="应用").click()
    page.locator(".action-card.applied").first.wait_for()
    saved = json.loads(LS(page, 'pathway.profile'))
    check("actions: endeavor written to the profile", "predict the lifetime of lithium-ion batteries" in saved["endeavor"]["statement"] and saved["endeavor"]["plan"] and saved["endeavor"]["role"] and saved["endeavor"]["progress"], saved["endeavor"])
    check("actions: name and degree written to the profile", saved["firstName"] == "Jane" and saved["lastName"] == "Doe" and len(saved["degrees"]) == 1 and "PhD" in saved["degrees"][0]["type"], (saved["firstName"], saved["degrees"]))
    check("actions: cards marked applied, buttons gone", page.locator(".action-card.pending").count() == 0 and page.get_by_role("button", name="应用", exact=True).count() == 0)
    ecard = page.locator(".action-card.applied", has=page.locator("strong", has_text="拟从事事业")).first
    ecard.get_by_role("button", name="去看填好的页面 →").click()
    check("actions: 'go see' opens the endeavor tab with the content", page.locator(".profile-tabs button.on").inner_text().startswith("拟从事事业") and "predict the lifetime" in page.locator("section.card textarea").first.input_value())
    nav(page, "聊天")
    check("chat: conversation still there after visiting another page", page.locator(".action-card.applied").count() >= 1)

    # 已有内容时再让它补充：应该用追加，不覆盖
    send(page, "再补充一条进展：2026 年我拿到了美国能源部的经费支持（项目编号 DE-XX-0000000）。帮我加进拟从事事业的进展里。")
    wait_reply(page)
    card = page.locator(".action-card.pending").last
    txt = card.inner_text()
    check("actions: adding to a filled field is proposed as an append (no overwrite warning)", "追加" in txt and "会替换掉原来的内容" not in txt, txt[:300])
    card.get_by_role("button", name="应用").click()
    page.locator(".action-card.pending").wait_for(state="detached")
    saved = json.loads(LS(page, 'pathway.profile'))
    check("actions: append keeps the old progress and adds the new line", "BattLife" in saved["endeavor"]["progress"] and "DE-XX-0000000" in saved["endeavor"]["progress"], saved["endeavor"]["progress"])

    # ---------- 4. 上传材料 → 建案件 + 存文件 ----------
    page.get_by_role("button", name="+ 新建会话").click()
    page.locator(".composer input[type=file]").set_input_files(os.path.join(FX, "media.md"))
    page.locator(".composer .chip-name", has_text="media.md").wait_for()
    send(page, "这是一篇报道我工作的媒体文章。请帮我新建一个 NIW 案件，名字叫 Battery NIW，把这个文件存进去，并把这条报道记到贡献总结的媒体报道里。")
    wait_reply(page)
    titles = [c.locator(".action-head strong").inner_text() for c in page.locator(".action-card").all()]
    print("  cards:", titles)
    check("actions: case + save-file + contributions cards", any("新建案件" in t for t in titles) and any("存进案件" in t for t in titles) and any("贡献总结" in t for t in titles), titles)
    fcard = page.locator(".action-card", has=page.locator("strong", has_text="存进案件")).first
    check("actions: saving a file before the case exists is blocked with a reason", fcard.get_by_role("button", name="应用").is_disabled() and fcard.locator(".notice").count() == 1, fcard.inner_text()[:200])
    page.get_by_role("button", name="全部应用").click()
    page.locator(".action-card.pending").wait_for(state="detached", timeout=15000)
    cases = json.loads(LS(page, 'pathway.cases'))
    check("actions: case created and file stored in it", len(cases) == 1 and cases[0]["name"] == "Battery NIW" and cases[0]["type"] == "NIW" and len(cases[0]["files"]) == 1, cases)
    fname = cases[0]["files"][0]["name"] if cases and cases[0]["files"] else ""
    check("actions: stored file is named by its exhibit title and keeps the extension", fname.endswith(".md") and fname != "media.md" and re.search(r"[A-Za-z]", fname), fname)
    saved = json.loads(LS(page, 'pathway.profile'))
    check("actions: media coverage appended to contributions", "TechDaily" in saved["soc"]["media"], saved["soc"]["media"])
    page.locator(".action-card.applied", has=page.locator("strong", has_text="存进案件")).get_by_role("button", name="去看填好的页面 →").click()
    check("actions: 'go see' opens that case's files tab", page.locator("h2", has_text="Battery NIW").count() == 1 and page.locator(".tabs button.on").inner_text().startswith("文件") and page.locator(".file-list li").count() == 1)

    # ---------- 5. 文档工作区：让 AI 把拟从事事业写成正式陈述 ----------
    page.locator(".tabs button", has_text="申请向导").click()
    est = page.locator(".guide li.step", has_text="确定拟从事事业")
    est.get_by_role("button", name="生成「Proposed Endeavor 陈述」文档").click()
    ed = page.locator("textarea.doc-editor"); ed.wait_for()
    original = ed.input_value()
    before = credits(email)
    page.locator(".chat-pane .suggestions button").first.click()
    wait_reply(page, 300_000)
    time.sleep(0.5)
    now = ed.input_value()
    reply = page.locator(".chat-pane .msg.assistant").last.inner_text()
    wrote = now != original
    print("  doc changed:", wrote, "| reply:", reply[:160].replace("\n", " "))
    check("doc chat: the reply does not leak document tags", "<doc_" not in reply and "</doc_" not in reply)
    if wrote:
        check("doc chat: AI wrote into the document and says so", "已写入文档" in reply or "已修改文档" in reply, reply[-200:])
        check("doc chat: the statement sentence is reused verbatim", "predict the lifetime of lithium-ion batteries from early test data" in now, now[:500])
        check("doc chat: undo button appears", page.get_by_role("button", name="↩ 撤销 AI 修改").count() == 1)
        page.get_by_role("button", name="↩ 撤销 AI 修改").click()
        check("doc chat: undo restores the previous content", ed.input_value() == original)
    else:
        check("doc chat: AI asked for missing information instead of writing (allowed by the prompt)", "？" in reply or "?" in reply, reply[:300])
    time.sleep(2)
    print("  cost of one document-drafting turn on the test channel:", before - credits(email))
    # 在文档里手改一处后让 AI 局部修改
    ed.fill(original)
    send(page, "只做一处修改：把标题里的 Jane Doe 改成 Dr. Jane Doe，其他都不要动。")
    wait_reply(page, 300_000)
    now = ed.input_value()
    reply = page.locator(".chat-pane .msg.assistant").last.inner_text()
    check("doc chat: a small edit is applied in place", "# Proposed Endeavor of Dr. Jane Doe" in now and now.replace("Dr. Jane Doe", "Jane Doe") == original, now[:200])
    check("doc chat: reports how many places changed", "已修改文档" in reply or "已写入文档" in reply, reply[-200:])
    page.locator("button.back").click()

    # ---------- 6. 会话管理 ----------
    nav(page, "聊天")
    n = page.locator(".history-item").count()
    check("chat: three conversations in history", n == 3, page.locator(".history-title").all_inner_texts())
    page.locator(".history-title").last.click()
    check("chat: switching shows that conversation's messages", "NIW 的三项要求" in page.locator(".msg.user .bubble").first.inner_text())
    page.once("dialog", lambda d: d.dismiss())
    page.locator(".history-del").last.click()
    check("chat: delete cancelled keeps it", page.locator(".history-item").count() == 3)
    page.once("dialog", lambda d: d.accept())
    page.locator(".history-del").last.click()
    check("chat: delete removes it and clears the view", page.locator(".history-item").count() == 2 and page.locator(".msg").count() == 0)

    # ---------- 7. 余额用完 ----------
    db("update users set credits=0 where email=?", (email,))
    page.reload(); page.locator(".account-email").wait_for()
    send(page, "还能用吗")
    page.locator(".toast").wait_for()
    check("chat: zero balance sends the user to top up instead of failing", "余额不足" in page.locator(".toast").inner_text() and page.locator("h2", has_text="账户").count() == 1 and credits(email) == 0)

    # 同步上去的内容里不应该出现原始标签
    time.sleep(3)
    conv = db("select value from user_data d join users u on u.id=d.user_id where u.email=? and key='conversations'", (email,))
    check("sync: conversations saved to the server", conv and len(json.loads(conv[0][0])) == 2)
    b.close()
finish()
