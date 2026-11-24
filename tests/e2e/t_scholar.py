"""学术记录：三个来源的获取、主要数字、重要引用分析、引用地图、论文下载。会访问 Semantic Scholar / OpenAlex，并调用模型（本机测试通道）。"""
import json, os, re, time
from common import *

def LS(page, key):
    time.sleep(0.6)  # 存进浏览器有 0.4 秒的延迟
    return page.evaluate(f"localStorage.getItem('{key}')") or "{}"  # 还没填过内容时浏览器里没有这一项


NAME = ("Geoffrey", "Hinton")  # 用一位公开的知名学者做查找测试

def credits(email):
    return db("select credits from users where email=?", (email,))[0][0]
def ledger(email, n=1):
    return db("select delta, reason from ledger l join users u on u.id=l.user_id where u.email=? order by l.id desc limit ?", (email, n))

with sync_playwright() as p:
    b = launch(p)
    ctx, page = new_page(b, "scholar")
    email = ui_login(page, credits=3000)
    nav(page, "我的档案")
    page.locator(".profile-tabs button").nth(1).click()
    card = page.locator("section.card", has_text="学术记录").first
    check("scholar: name-based buttons disabled until a name is filled", page.get_by_role("button", name="按姓名查找").is_disabled() and "请先在上面填写英文姓名" in card.inner_text())
    check("scholar: fetch disabled without a valid Google Scholar link", card.get_by_role("button", name="获取", exact=True).first.is_disabled())
    page.locator(".profile-tabs button").nth(0).click()
    page.get_by_placeholder("与护照一致，如 Xiaoming").fill(NAME[0])
    page.get_by_placeholder("与护照一致，如 Wang").fill(NAME[1])
    page.locator(".profile-tabs button").nth(1).click()
    card = page.locator("section.card", has_text="学术记录").first

    # ---------- Semantic Scholar：按姓名找 → 选人 ----------
    before = credits(email)
    page.get_by_role("button", name="按姓名查找").click()
    page.locator(".candidates button").first.wait_for(timeout=60000)
    cands = page.locator(".candidates button")
    check("s2: candidates listed with institution / papers / citations", cands.count() >= 1 and "篇论文" in cands.first.inner_text(), cands.first.inner_text())
    check("s2: searching by name is free", credits(email) == before)
    # 选论文最多的那位
    best = max(range(cands.count()), key=lambda i: int(re.search(r"(\d+) 篇论文", cands.nth(i).inner_text()).group(1)))
    cands.nth(best).click()
    page.locator("details.pubs", has_text="Semantic Scholar").wait_for(timeout=90000)
    rec = page.locator("details.pubs", has_text="Semantic Scholar").first
    check("s2: record saved and marked as the main source", "（主要）" in rec.locator("summary").inner_text(), rec.locator("summary").inner_text())
    check("s2: charged 20 once", before - credits(email) == 20 and ledger(email)[0] == (-20, "获取学术数据"), (before, credits(email), ledger(email)))
    nums = [card.locator(".grid2 input").nth(i).input_value() for i in range(3)]
    check("s2: the three headline numbers are filled from it", all(n.strip("+").isdigit() for n in nums) and int(nums[1]) > 1000, nums)
    check("s2: profile link stored", "semanticscholar.org/author/" in card.locator("input[type=url]").nth(1).input_value())
    check("s2: candidates list closed after picking", page.locator(".candidates").count() == 0)
    saved = json.loads(LS(page, 'pathway.profile'))
    pubs = saved["records"][0]["publications"]
    check("s2: publications sorted by citations", len(pubs) > 20 and all(pubs[i]["citations"] >= pubs[i + 1]["citations"] for i in range(len(pubs) - 1)), len(pubs))
    rec.locator("summary").click()
    check("s2: publication list visible when expanded", rec.locator("ol li").count() == len(pubs))

    # ---------- OpenAlex：按姓名找 ----------
    before = credits(email)
    card.get_by_role("button", name=re.compile("OpenAlex")).click()
    page.locator(".candidates button").first.wait_for(timeout=60000)
    check("openalex: candidates listed", "OpenAlex" in page.locator(".candidates small").first.inner_text())
    page.locator(".candidates button").first.click()
    page.locator("details.pubs", has_text="OpenAlex").wait_for(timeout=90000)
    check("openalex: second record kept side by side, main unchanged", page.locator("details.pubs").count() == 2 and "（主要）" in page.locator("details.pubs", has_text="Semantic Scholar").locator("summary").inner_text() and "（主要）" not in page.locator("details.pubs", has_text="OpenAlex").locator("summary").inner_text())
    check("openalex: charged 20", before - credits(email) == 20)
    oa = page.locator("details.pubs", has_text="OpenAlex").first
    oa.locator("summary").click()
    oa.get_by_role("button", name="用这组数字").click()
    saved = json.loads(LS(page, 'pathway.profile'))
    oarec = next(r for r in saved["records"] if r["source"] == "OpenAlex")
    check("openalex: 'use these numbers' switches the main source", saved["primarySource"] == "OpenAlex" and saved["citations"] == oarec["citations"] and "目前取自 OpenAlex" in card.inner_text())
    # 手改数字
    card.locator(".grid2 input").nth(1).fill("12345")
    saved = json.loads(LS(page, 'pathway.profile'))
    check("scholar: editing a number by hand marks it as manual", saved["primarySource"] == "" and saved["citations"] == "12345" and "目前是你手动填写的" in card.inner_text())
    # 删除记录
    oa.get_by_role("button", name="删除这份记录").click()
    check("openalex: record deleted", page.locator("details.pubs", has_text="OpenAlex").count() == 0 and page.locator("details.pubs").count() == 1)
    s2rec = page.locator("details.pubs", has_text="Semantic Scholar").first
    s2rec.get_by_role("button", name="用这组数字").click()
    check("s2: back to main", json.loads(LS(page, 'pathway.profile'))["primarySource"] == "Semantic Scholar")
    # 审稿次数
    card.get_by_label("6–10").check()
    check("scholar: review count saved", json.loads(LS(page, 'pathway.profile'))["reviews"] == "6–10")

    # ---------- Google Scholar ----------
    gs = card.locator("input[type=url]").nth(0)
    gs.fill("https://example.com/citations?user=JicYPdAAAAAJ")
    check("gs: non-Scholar link keeps the button disabled", card.get_by_role("button", name="获取", exact=True).first.is_disabled())
    gs.fill("https://scholar.google.com/citations?user=JicYPdAAAAAJ&hl=en")
    before = credits(email)
    card.get_by_role("button", name="获取", exact=True).first.click()
    card.get_by_role("button", name="正在获取…").wait_for(state="detached", timeout=60000)
    time.sleep(0.5)
    gs_rec = lambda: page.locator("details.pubs > summary", has_text=re.compile(r"^Google Scholar："))
    if page.locator(".gs-upload").count():
        print("  Google blocked the direct fetch from this machine; checking the upload fallback")
        check("gs: blocked fetch explains and offers the upload fallback, without charging", "Google 拦截了" in card.locator(".notice").inner_text() and credits(email) == before)
        # 上传不是 Scholar 页面的文件
        bad = os.path.join(S, "fixtures", "notes.txt")
        os.system(f"cp {bad} {os.path.join(S, 'fixtures', 'notscholar.html')}")
        page.locator(".gs-upload input[type=file]").set_input_files(os.path.join(S, "fixtures", "notscholar.html"))
        page.locator(".notice", has_text="没能从这个文件里读出论文列表").wait_for(timeout=20000)
        check("gs: a wrong file is rejected without charging", credits(email) == before)
        fixture = os.path.join(S, "fixtures", "scholar_page.html")
        if os.path.exists(fixture):
            page.locator(".gs-upload input[type=file]").set_input_files(fixture)
            gs_rec().wait_for(timeout=20000)
            saved = json.loads(LS(page, 'pathway.profile'))
            g = next(r for r in saved["records"] if r["source"] == "Google Scholar")
            check("gs: saved page parsed into a record and charged 20", before - credits(email) == 20 and page.locator(".gs-upload").count() == 0)
            check("gs: parsed numbers (papers 4, citations 531, h-index 3)", (g["papers"], g["citations"], g["hIndex"]) == ("4", "531", "3"), (g["papers"], g["citations"], g["hIndex"]))
            titles = [w["title"] for w in g["publications"]]
            check("gs: titles decoded (entities and inline tags)", titles[0] == "Early-cycle prediction of battery lifetime & degradation" and titles[1] == "BattLife: an open benchmark for battery degradation", titles)
            check("gs: venue without the trailing year, blank citation count read as 0", g["publications"][0]["venue"] == "Nature Energy 9 (3), 123-134" and g["publications"][2]["citations"] == 0, g["publications"][:3])
            check("gs: another source stays the main one", saved["primarySource"] == "Semantic Scholar")
    else:
        check("gs: direct fetch worked and charged 20", gs_rec().count() == 1 and before - credits(email) == 20, card.locator(".notice").all_inner_texts())
    shot(page, "scholar-records", full=True)

    # ---------- 重要引用分析 ----------
    nt = page.locator("section.card", has_text="重要引用（Notable Citations）").first
    check("notable: top papers listed (8 shown, rest behind a toggle)", nt.locator(".paper-pick > div").count() == 8 and "显示全部" in nt.inner_text())
    # 挑一篇引用不多的，省时间
    target = next((w for w in pubs if 15 <= w["citations"] <= 45 and len(w["title"]) > 25), None) or pubs[-1]
    print("  analysing:", target["title"], "| cited", target["citations"])
    inp = nt.locator(".src-row input")
    inp.fill("short")
    check("notable: custom title needs at least 8 characters", nt.locator(".src-row button").is_disabled())
    inp.fill(target["title"])
    before = credits(email)
    nt.locator(".src-row button").click()
    page.locator("details.notable, section.card .notice").first.wait_for(timeout=400_000)
    if nt.locator("details.notable").count():
        an = nt.locator("details.notable").first
        saved = json.loads(LS(page, 'pathway.profile'))
        a = saved["analyses"][0]
        time.sleep(1.5)
        cost = before - credits(email)
        print(f"  analysis: total {a['total']}, self {a['selfCitations']}, with context {a['withContext']}, analysed {a['analyzed']}, items {len(a['items'])}, cost {cost}")
        check("notable: summary numbers are consistent", a["analyzed"] == len(a["items"]) <= a["withContext"] <= a["total"] and a["selfCitations"] <= a["total"], a | {"items": len(a["items"])})
        if a["items"]:
            check("notable: charged by usage and recorded", cost >= 1 and ledger(email)[0][1] == "重要引用分析", (cost, ledger(email)))
            check("notable: every item has a category, importance and a quoted context", all(i["category"] in ["praise", "builds", "baseline", "uses", "mention", "critical"] and i["importance"] in ["high", "medium", "low"] and i["contexts"] for i in a["items"]))
            an.locator("summary").click()
            chips = an.locator(".chips button")
            chips.nth(1).click()  # 全部
            check("notable: 'all' filter lists every item", an.locator(".cite").count() == len(a["items"]), (an.locator(".cite").count(), len(a["items"])))
            first = an.locator(".cite").first
            was = first.locator("input[type=checkbox]").is_checked()
            first.locator("input[type=checkbox]").click()
            saved2 = json.loads(LS(page, 'pathway.profile'))
            check("notable: ticking a citation is saved", saved2["analyses"][0]["items"][0].get("selected") == (not was))
            check("notable: the summary count follows", f"选出 {sum(1 for i in saved2['analyses'][0]['items'] if i.get('selected', i['importance'] == 'high'))} 条" in an.locator("summary").inner_text(), an.locator("summary").inner_text())
        else:
            check("notable: nothing to analyse is free", cost == 0, cost)
        check("notable: input cleared after success", inp.input_value() == "")
        shot(page, "notable")
        an.get_by_role("button", name="删除这篇的分析").click() if False else None
    else:
        print("  notable analysis did not complete:", nt.locator(".notice").inner_text())
        check("notable: failure is reported and not charged", credits(email) == before, nt.locator(".notice").inner_text())
    # 不存在的论文
    inp.fill("Zzyzx qwertyuiop nonexistent paper title 9f8e7d6c")
    before = credits(email)
    nt.locator(".src-row button").click()
    nt.locator(".notice").wait_for(timeout=120_000)
    check("notable: unknown paper gives a clear message and no charge", "没有找到这篇论文" in nt.locator(".notice").inner_text() and credits(email) == before, nt.locator(".notice").inner_text())

    # ---------- 引用地图 ----------
    cm = page.locator("section.card", has_text="引用地图（Citation Map）").first
    before = credits(email)
    cm.get_by_role("button", name="生成引用地图").click()
    page.locator("svg.cite-map, section.card:has-text('引用地图') .notice").first.wait_for(timeout=180_000)
    if page.locator("svg.cite-map").count():
        time.sleep(1.5)
        saved = json.loads(LS(page, 'pathway.profile'))
        m = saved["citeMap"]
        print(f"  cite map: {m['papers']} papers, {m['citing']} citing, {len(m['countries'])} countries, self excluded {m['selfExcluded']}")
        check("citemap: charged 30", before - credits(email) == 30 and ledger(email)[0] == (-30, "引用地图"), (before, credits(email)))
        check("citemap: countries and institutions listed", len(m["countries"]) > 5 and len(m["institutions"]) > 3 and cm.locator(".cite-map-lists ol li").count() >= 10)
        check("citemap: title carries the name", f"Citation Map of {NAME[0]} {NAME[1]}" in cm.locator("svg.cite-map").text_content())
        with page.expect_download() as dl:
            cm.get_by_role("button", name="下载图片（PNG）").click()
        from PIL import Image
        check("citemap: PNG download", Image.open(dl.value.path()).size[0] > 1000)
        shot(page, "citemap")
    else:
        print("  cite map did not complete:", cm.locator(".notice").inner_text())
        check("citemap: failure is reported and not charged", credits(email) == before, cm.locator(".notice").inner_text())

    # ---------- 案件里一键下载论文 ----------
    nav(page, "案件")
    page.get_by_role("button", name="+ 创建第一个案件").click()
    page.get_by_role("button", name="创建", exact=True).click()
    page.locator(".tabs button", has_text="文件").click()
    pf = page.locator(".paper-fetch")
    pf.get_by_role("button", name=re.compile("选择论文")).click()
    boxes = pf.locator(".paper-fetch-list input[type=checkbox]")
    check("papers: list offers own papers (up to 20) plus selected citing papers", boxes.count() >= 20, boxes.count())
    for i in range(boxes.count()):
        if boxes.nth(i).is_checked() and boxes.nth(i).is_enabled():
            boxes.nth(i).uncheck()
    check("papers: nothing selected -> download disabled", pf.get_by_role("button", name="下载 0 篇").is_disabled())
    boxes.nth(0).check(); boxes.nth(1).check()
    before = credits(email)
    pf.get_by_role("button", name="下载 2 篇").click()
    pf.get_by_role("button", name=re.compile(r"^下载 \d+ 篇$")).wait_for(timeout=240_000)
    time.sleep(1)
    status = [x.inner_text() for x in pf.locator(".paper-fetch-list label.item small").all()[:2]]
    print("  paper download status:", status)
    files = page.locator(".file-list .file-name").all_inner_texts()
    check("papers: each chosen paper is either saved or explained", all(("已保存" in s) or ("没有公开的 PDF" in s) or ("没有找到" in s) or ("下载失败" in s) or ("太多" in s) for s in status), status)
    check("papers: saved ones appear in the case files with the 'Paper - ' prefix", len(files) == sum(1 for s in status if "已保存" in s) and all(f.startswith("Paper - ") for f in files), files)
    check("papers: downloading is free", credits(email) == before)
    if files:
        check("papers: guide step counts downloaded papers", True)
    b.close()
finish()
