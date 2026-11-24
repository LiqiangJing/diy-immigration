"""「我的档案」：基本资料、贡献总结、拟从事事业（新功能）、说明框、按案件类型调整。"""
import json, re, time
from common import *

def LS(page, key):
    time.sleep(0.6)  # 存进浏览器有 0.4 秒的延迟
    return page.evaluate(f"localStorage.getItem('{key}')") or "{}"  # 还没填过内容时浏览器里没有这一项


with sync_playwright() as p:
    b = launch(p)
    ctx, page = new_page(b, "profile")

    # ---------- 未登录也能填档案（存在浏览器里） ----------
    page.goto(BASE + "/")
    nav(page, "我的档案")
    tabs = page.locator(".profile-tabs button")
    check("profile: four tabs", tabs.count() == 4 and "拟从事事业" in tabs.nth(3).inner_text(), tabs.all_inner_texts())
    page.get_by_placeholder("与护照一致，如 Xiaoming").fill("Jane")
    page.get_by_placeholder("与护照一致，如 Wang").fill("Doe")
    page.get_by_placeholder(re.compile("多模态大模型")).fill("Battery Informatics")
    page.get_by_role("button", name="+ 添加学位").click()
    deg = page.locator(".degree").first
    deg.locator("select").select_option(label="博士（PhD）")
    deg.locator("input").nth(0).fill("Materials Science")
    deg.locator("input").nth(1).fill("Example University")
    deg.locator("input").nth(2).fill("2022")
    deg.get_by_label("相关", exact=True).check()
    page.locator("section.card", has=page.locator("h3", has_text="工作与未来计划")).locator("input").first.fill("Research Scientist at Example Labs, CA")
    page.get_by_label("是，继续在积累了主要成果的领域工作").check()
    page.get_by_label("是，仍在做研究并发表").check()
    check("profile: next-paper field appears", page.get_by_placeholder("MM/YYYY").count() >= 1)
    page.get_by_label("否，我换了领域").check()
    check("profile: field-change inputs appear", page.locator("label", has_text="原领域").count() == 1)
    page.get_by_label("是，继续在积累了主要成果的领域工作").check()

    # ---------- 拟从事事业 ----------
    tabs.nth(3).click()
    check("endeavor: heading", page.locator("h3", has_text="拟从事事业（Proposed Endeavor）").count() == 1)
    areas = page.locator("section.card textarea")
    check("endeavor: six text areas", areas.count() == 6, areas.count())
    check("endeavor: six guide boxes + intro", page.locator("details.tips").count() == 7, page.locator("details.tips").count())
    check("endeavor: no case-type note without cases", page.locator("small.for-type").count() == 0)
    stmt = "My proposed endeavor is to develop data-driven methods that predict battery lifetime in order to speed up battery development in the United States."
    areas.nth(0).fill(stmt)
    areas.nth(1).fill("Batteries degrade. Testing takes months. IMPORTANCE-MARKER")
    areas.nth(2).fill("Project 1 (2027-2028): extend the model. PLAN-MARKER")
    areas.nth(3).fill("Research Scientist at Example Labs. ROLE-MARKER")
    areas.nth(4).fill("- BattLife has 12,000 downloads. PROGRESS-MARKER")
    areas.nth(5).fill("The endeavor spans institutions. WAIVER-MARKER")
    # 说明框能展开，里面有要点、示例、证据、常见问题和官方出处
    first = page.locator("details.tips").nth(1)
    first.locator("summary").click()
    txt = first.inner_text()
    check("endeavor: guide shows points/example/avoid", "示例（内容是虚构的" in txt and "常见问题" in txt and "My proposed endeavor is to" in txt, txt[:200])
    intro = page.locator("details.tips").nth(0)
    intro.locator("summary").click()
    link = intro.locator("a")
    check("endeavor: intro links to USCIS policy manual", link.count() == 1 and "uscis.gov/policy-manual/volume-6-part-f-chapter-5" in link.get_attribute("href"))
    shot(page, "endeavor-top")
    page.locator(".cases.profile").evaluate("e => e.scrollTo(0, e.scrollHeight)")
    shot(page, "endeavor-bottom")

    # 「为什么重要」和贡献总结里的是同一个框
    tabs.nth(2).click()
    imp = page.locator("label", has_text="这项工作的重要性、益处和应用").locator("textarea")
    check("endeavor: importance shared with SoC", "IMPORTANCE-MARKER" in imp.input_value(), imp.input_value())
    imp.fill("Edited in SoC. IMPORTANCE-2")
    tabs.nth(3).click()
    check("endeavor: SoC edit shows up in endeavor tab", "IMPORTANCE-2" in page.locator("section.card textarea").nth(1).input_value())

    # 存进了 localStorage，刷新后还在
    time.sleep(0.5)
    saved = json.loads(LS(page, 'pathway.profile'))
    check("endeavor: saved to localStorage", saved["endeavor"]["statement"] == stmt and "PLAN-MARKER" in saved["endeavor"]["plan"] and "WAIVER-MARKER" in saved["endeavor"]["waiver"], saved.get("endeavor"))
    check("endeavor: importance stored once (in soc)", "importance" not in saved["endeavor"] and "IMPORTANCE-2" in saved["soc"]["importance"])
    page.reload()
    nav(page, "我的档案")
    page.locator(".profile-tabs button").nth(3).click()
    check("endeavor: survives reload", page.locator("section.card textarea").nth(0).input_value() == stmt)

    # ---------- 贡献总结的说明框 ----------
    page.locator(".profile-tabs button").nth(2).click()
    n = page.locator("details.tips").count()
    check("soc: guide boxes render (general + 9 without projects)", n == 10, n)
    page.get_by_role("button", name="+ 添加项目").click()
    n = page.locator("details.tips").count()
    check("soc: project adds 4 guide boxes", n == 14, n)
    g = page.locator("details.tips", has_text="查看填写说明和示例").first
    g.locator("summary").click()
    t = g.inner_text()
    check("soc: guide shows both NIW and EB-1A notes without cases", "申请 NIW：" in t and "申请 EB-1A：" in t, t[-300:])
    check("soc: section three not marked optional without cases", page.locator("h3", has_text="三、其他成就").inner_text() == "三、其他成就")

    # ---------- 登录后新建案件，说明按类型调整 ----------
    email = ui_login(page)
    nav(page, "案件")
    page.get_by_role("button", name="+ 创建第一个案件").click()
    page.locator(".case-form .seg button", has_text="NIW").click()
    page.locator(".case-form input").fill("NIW Test Case")
    page.get_by_role("button", name="创建", exact=True).click()
    page.locator("h2", has_text="NIW Test Case").wait_for()

    # 向导里的拟从事事业这一步：排在贡献总结前面，档案里填过了就能直接生成文档
    steps = page.locator(".guide li.step")
    titles = [s.locator("strong").first.inner_text().split("\n")[0] for s in steps.all()]
    ie = next(i for i, t in enumerate(titles) if "拟从事事业" in t)
    isoc = next(i for i, t in enumerate(titles) if "贡献总结" in t)
    check("guide(NIW): endeavor step exists and precedes SoC", ie < isoc, titles)
    est = steps.nth(ie)
    check("guide(NIW): notes endeavor already filled", "档案里已经填了，还没有生成文档" in est.inner_text(), est.inner_text())
    shot(page, "guide-niw", full=False)
    est.get_by_role("button", name="生成「Proposed Endeavor 陈述」文档").click()
    ed = page.locator("textarea.doc-editor")
    ed.wait_for()
    doc = ed.input_value()
    order = ["# Proposed Endeavor of Jane Doe", "## The Proposed Endeavor", stmt, "## Substantial Merit and National Importance", "IMPORTANCE-2",
             "## Plan for the Next Three to Five Years", "PLAN-MARKER", "## Position and Capacity", "ROLE-MARKER", "## Progress to Date and Outside Support",
             "PROGRESS-MARKER", "## Why Waiving the Job Offer and Labor Certification Benefits the United States", "WAIVER-MARKER"]
    pos = [doc.find(x) for x in order]
    check("endeavor doc: all sections present in order", all(x >= 0 for x in pos) and pos == sorted(pos), doc[:600])
    check("endeavor doc: title", page.locator("input.doc-title").input_value() == "Proposed Endeavor")
    sug = page.locator(".chat-pane .suggestions button").all_inner_texts()
    check("endeavor doc: tailored suggestions", any("正式的英文 Proposed Endeavor 陈述" in s for s in sug), sug)
    shot(page, "endeavor-doc")
    page.locator("button.back").click()
    page.locator(".tabs button", has_text="申请向导").click()
    est = page.locator(".guide li.step").nth(ie)
    check("guide(NIW): endeavor step done after doc exists", "done" in est.get_attribute("class") and est.get_by_role("button", name="打开「Proposed Endeavor」").count() == 1, est.get_attribute("class"))

    # 向导 →「去『拟从事事业』」会直接打开那一栏（用另一个没有文档的案件验证）
    # NIW 的申请信工作流：拟从事事业填过了，开场白不再要求从头问
    plstep = page.locator(".guide li.step", has_text="写 Petition Letter")
    plstep.get_by_role("button", name=re.compile("和 AI 一起做：起草 Petition Letter")).click()
    sug = page.locator(".chat-pane .suggestions button").all_inner_texts()
    check("NIW PL workflow: starter knows endeavor is filled", len(sug) == 1 and "拟从事事业已经填在档案里" in sug[0], sug)
    page.locator("button.back").click()

    # 只有 NIW 案件：档案里的提示
    nav(page, "我的档案")
    page.locator(".profile-tabs button").nth(2).click()
    check("soc(NIW only): intro note", page.locator("small.for-type", has_text="你目前只有 NIW 案件").count() == 1)
    check("soc(NIW only): section three optional", "（NIW 可选）" in page.locator("h3", has_text="三、其他成就").inner_text())
    g = page.locator("details.tips", has_text="查看填写说明和示例").first
    g.locator("summary").click()
    t = g.inner_text()
    check("soc(NIW only): guide hides EB-1A note", "申请 NIW：" in t and "申请 EB-1A：" not in t, t[-300:])
    shot(page, "soc-niw-only")
    page.locator(".profile-tabs button").nth(3).click()
    check("endeavor(NIW only): no skip note", page.locator("small.for-type").count() == 0)

    # 再建一个 EB-1A 案件：两种都有，说明都显示
    nav(page, "案件")
    page.get_by_role("button", name="+ 新建案件").click()
    page.locator(".case-form .seg button", has_text="EB-1A").click()
    page.get_by_role("button", name="创建", exact=True).click()
    page.locator("h2", has_text="我的 EB-1A 案件").wait_for()
    titles = [s.locator("strong").first.inner_text() for s in page.locator(".guide li.step").all()]
    check("guide(EB-1A): no endeavor step", not any("拟从事事业" in t for t in titles), titles)
    nav(page, "我的档案")
    page.locator(".profile-tabs button").nth(2).click()
    check("soc(both types): no type note", page.locator("small.for-type").count() == 0)

    # 删掉 NIW 案件 → 只剩 EB-1A
    nav(page, "案件")
    page.locator(".case-card", has_text="NIW Test Case").click()
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="删除案件").click()
    nav(page, "我的档案")
    page.locator(".profile-tabs button").nth(3).click()
    check("endeavor(EB-1A only): says optional", page.locator("small.for-type", has_text="这一栏可以不填").count() == 1)
    page.locator(".profile-tabs button").nth(2).click()
    g = page.locator("details.tips", has_text="查看填写说明和示例").first
    g.locator("summary").click()
    t = g.inner_text()
    check("soc(EB-1A only): guide hides NIW note", "申请 EB-1A：" in t and "申请 NIW：" not in t, t[-300:])
    check("soc(EB-1A only): intro note", page.locator("small.for-type", has_text="你目前只有 EB-1A 案件").count() == 1)

    # 案件向导的版式没有被说明框的样式影响（之前两者共用了类名）
    nav(page, "案件")
    page.locator(".case-card").first.click()
    fs = page.locator(".guide").evaluate("e => getComputedStyle(e).fontSize")
    mg = page.locator(".guide li.step").first.evaluate("e => getComputedStyle(e).marginTop")
    check("guide: not affected by tips styles", mg == "0px", f"font {fs} margin {mg}")
    shot(page, "guide-eb1a")

    # 同步到服务器
    time.sleep(3.5)
    row = db("select value from user_data d join users u on u.id=d.user_id where u.email=? and key='profile'", (email,))
    check("endeavor: synced to server", row and json.loads(row[0][0])["endeavor"]["statement"] == stmt)
    b.close()
finish()
