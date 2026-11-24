"""案件：向导、申报条件、文档、文件、清单、打包下载（并检查生成的 PDF）。"""
import json, os, re, subprocess, time
from common import *

def LS(page, key):
    time.sleep(0.6)  # 存进浏览器有 0.4 秒的延迟
    return page.evaluate(f"localStorage.getItem('{key}')") or "{}"  # 还没填过内容时浏览器里没有这一项

from fixture_profile import profile

FX = os.path.join(S, "fixtures")
fx = lambda *names: [os.path.join(FX, n) for n in names]

def pdf_pages(path):
    n = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", path], capture_output=True, text=True).stdout).group(1))
    return [subprocess.run(["pdftotext", "-f", str(i), "-l", str(i), "-layout", path, "-"], capture_output=True, text=True).stdout for i in range(1, n + 1)]

with sync_playwright() as p:
    b = launch(p)
    ctx, page = new_page(b, "cases", permissions=["clipboard-read", "clipboard-write"])

    # 先在没登录的浏览器里放一份档案，再登录：验证「登录前填的内容会传上去」
    page.goto(BASE + "/")
    page.evaluate("v => localStorage.setItem('pathway.profile', v)", json.dumps(profile()))
    email = ui_login(page)
    time.sleep(3.5)
    row = db("select value from user_data d join users u on u.id=d.user_id where u.email=? and key='profile'", (email,))
    check("sync: profile filled before login is uploaded after login", row and json.loads(row[0][0])["firstName"] == "Jane", row and row[0][0][:80])

    # ---------- 新建 NIW 案件 ----------
    nav(page, "案件")
    check("cases: empty state", page.locator(".empty h3", has_text="暂无案件").count() == 1)
    page.get_by_role("button", name="+ 创建第一个案件").click()
    page.get_by_role("button", name="取消").click()
    check("cases: cancel create", page.locator(".case-form").count() == 0)
    page.get_by_role("button", name="+ 创建第一个案件").click()
    page.get_by_role("button", name="创建", exact=True).click()  # 不填名字用默认名
    page.locator("h2", has_text="我的 NIW 案件").wait_for()
    steps = page.locator(".guide li.step")
    check("guide(NIW): 15 steps", steps.count() == 15, steps.count())
    st = lambda title: page.locator(".guide li.step", has=page.locator("strong", has_text=title)).first
    check("guide: profile step auto-done", "done" in st("填写个人档案").get_attribute("class"))
    check("guide: scholar step auto-done with source", "done" in st("获取学术记录").get_attribute("class") and "Semantic Scholar" in st("获取学术记录").inner_text())
    check("guide: next step is endeavor (first unfinished)", "current" in st("确定拟从事事业").get_attribute("class"), st("确定拟从事事业").get_attribute("class"))
    check("guide: notable step says picked count", "档案里已选出 2 条" in st("找出重要引用").inner_text(), st("找出重要引用").inner_text())

    # 申报条件
    cl = st("选择申报条件")
    cl.locator(".seg button", has_text="高等学位").click()
    check("claims(NIW): advanced degree completes the step", "done" in st("选择申报条件").get_attribute("class"))
    cl.locator(".seg button", has_text="特殊能力").click()
    check("claims(NIW): exceptional needs three", "todo" in st("选择申报条件").get_attribute("class") and "已选 0 项，还差 3 项" in st("选择申报条件").inner_text(), st("选择申报条件").inner_text()[:200])
    boxes = st("选择申报条件").locator(".claims input[type=checkbox]")
    check("claims(NIW): six criteria", boxes.count() == 6, boxes.count())
    for i in range(3):
        boxes.nth(i).check()
    check("claims(NIW): three picked -> done", "done" in st("选择申报条件").get_attribute("class") and "已选 3 项" in st("选择申报条件").inner_text())
    boxes.nth(0).uncheck()
    check("claims(NIW): unpick -> not done", "todo" in st("选择申报条件").get_attribute("class"))
    st("选择申报条件").locator(".seg button", has_text="高等学位").click()

    # 手动标记
    m = st("上传基础材料")
    m.get_by_role("button", name="跳过").click()
    check("guide: skip marks step", "skip" in st("上传基础材料").get_attribute("class") and "已跳过" in st("上传基础材料").inner_text())
    st("上传基础材料").get_by_role("button", name="取消标记").click()
    check("guide: unmark restores", "todo" in st("上传基础材料").get_attribute("class"))
    st("案件评估").get_by_role("button", name="标为已完成").click()
    check("guide: mark done", "done" in st("案件评估").get_attribute("class"))
    head = page.locator(".guide > .group-note").inner_text()
    check("guide: progress count text", re.search(r"已经完成 \d+ / 15 步", head) is not None, head)

    # 「去『拟从事事业』」在档案里直接打开那一栏；之后从侧边栏进档案回到第一栏
    page.locator(".guide li.step", has_text="确定拟从事事业").get_by_role("button", name="去「拟从事事业」").click()
    check("guide: jump opens the endeavor tab", page.locator(".profile-tabs button.on").inner_text().startswith("拟从事事业"))
    nav(page, "案件"); nav(page, "我的档案")
    check("nav: sidebar entry opens the first tab again", page.locator(".profile-tabs button.on").inner_text().startswith("基本资料"))
    nav(page, "案件")
    page.locator(".case-card").first.click()

    # ---------- 文档 ----------
    page.locator(".tabs button", has_text="文档").click()
    kinds = page.locator(".case-card strong", has_text="+ ").all_inner_texts()
    check("docs: seven blank kinds", len(kinds) == 7, kinds)
    wf = [x.inner_text() for x in page.locator(".case-card.workflow strong").all()]
    check("docs(NIW): workflows listed (7, NIW letter only)", len(wf) == 7 and wf.count("起草 Petition Letter") == 1, wf)

    def new_doc(kind):
        page.locator(".case-card", has=page.locator("strong", has_text=f"+ {kind}")).click()
        page.locator("textarea.doc-editor").wait_for()
    def back():
        page.locator("button.back").click()
        page.locator(".tabs").wait_for()

    # 空白文档：没写内容就返回，不会留下空文档
    new_doc("Petition Letter")
    back()
    page.locator(".tabs button", has_text="文档").click()
    check("docs: untouched blank doc is not saved", page.locator(".tabs button", has_text="文档 0").count() == 1)

    # 自动生成的四种
    for kind, title, marker in [("Summary of Contributions", "Summary of Contributions", "SOC-SUMMARY"), ("论文与引用记录", "Publication and Citation Record", "Cited by 320"),
                                ("重要引用", "Notable Citations", "We adopt the early-cycle predictor"), ("Proposed Endeavor 陈述", "Proposed Endeavor", "ENDEAVOR-PLAN")]:
        new_doc(kind)
        content = page.locator("textarea.doc-editor").input_value()
        check(f"docs: generated「{kind}」", marker in content and page.locator("input.doc-title").input_value() == title, content[:200])
        if kind == "重要引用":
            check("notable doc: only selected citations (2 of 3)", content.count("### ") == 2 and "Citing paper number 3" not in content, content[:400])
        if kind == "论文与引用记录":
            check("citation doc: totals", "**Total citations:** 543" in content and "**h-index:** 4" in content and "4. Uncertainty-aware state of health estimation. 2021. Cited by 12." in content, content[:500])
        if kind == "Summary of Contributions":
            check("soc doc: review table", "| Joule | 4 | Yes |" in content and "Peer review (4 reviews in total)" in content, content[-600:])
        back(); page.locator(".tabs button", has_text="文档").click()
    check("docs: four docs saved", page.locator(".tabs button", has_text="文档 4").count() == 1, page.locator(".tabs").inner_text())

    # 手写一份 Petition Letter：标题、内容、预览、下载、复制、撤销
    new_doc("Petition Letter")
    ed = page.locator("textarea.doc-editor")
    letter = "# Petition Letter\n\nDear Officer:\n\nI respectfully submit this petition. **Bold claim** with [a link](https://example.org).\n\n## I. Introduction\n\n- First point\n- Second point\n\n1. Numbered one\n2. Numbered two\n\n| Metric | Value |\n| --- | --- |\n| Citations | 543 |\n\n> A quoted sentence.\n\n中文段落：这一句是中文，打包时会被略去。\n\n[待补充：推荐人姓名]\n"
    ed.fill(letter)
    page.locator("input.doc-title").fill("Petition Letter of Jane Doe")
    page.locator(".doc-actions .seg button", has_text="预览").click()
    prev = page.locator(".doc-preview")
    check("doc: preview renders markdown", prev.locator("h1").count() == 1 and prev.locator("table").count() == 1 and prev.locator("li").count() == 4 and prev.locator("strong", has_text="Bold claim").count() == 1)
    page.locator(".doc-actions .seg button", has_text="编辑").click()
    with page.expect_download() as dl:
        page.get_by_role("button", name="下载", exact=True).click()
    path = os.path.join(SHOTS, "letter.md"); dl.value.save_as(path)
    check("doc: download .md with title as name", dl.value.suggested_filename == "Petition Letter of Jane Doe.md" and open(path).read() == letter, dl.value.suggested_filename)
    page.get_by_role("button", name="复制", exact=True).click()
    check("doc: copy to clipboard", page.evaluate("navigator.clipboard.readText()") == letter and page.get_by_role("button", name="已复制").count() == 1)
    back(); page.locator(".tabs button", has_text="文档").click()
    check("docs: five docs, newest first", page.locator(".case-list").first.locator(".case-card strong").first.inner_text() == "Petition Letter of Jane Doe", page.locator(".case-list").first.inner_text()[:200])

    # 推荐信
    new_doc("推荐信")
    page.locator("textarea.doc-editor").fill("# Recommendation Letter\n\nTo whom it may concern: Dr. Doe is excellent.\n")
    page.locator("input.doc-title").fill("Letter from Dr. Smith")
    back(); page.locator(".tabs button", has_text="文档").click()

    # 删除一份文档
    page.locator(".case-card", has=page.locator("strong", has_text="Publication and Citation Record")).click()
    page.once("dialog", lambda d: d.dismiss())
    page.get_by_role("button", name="删除", exact=True).click()
    check("doc: delete cancelled keeps doc", page.locator("textarea.doc-editor").count() == 1)
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="删除", exact=True).click()
    page.locator(".tabs").wait_for()
    page.locator(".tabs button", has_text="文档").click()
    check("doc: deleted", page.locator(".case-card strong", has_text="Publication and Citation Record").count() == 0 and page.locator(".tabs button", has_text="文档 5").count() == 1)

    # ---------- 文件 ----------
    page.locator(".tabs button", has_text="文件").click()
    up = page.locator(".dropzone input[type=file]")
    up.set_input_files(fx("cv.pdf", "award.pdf", "letter.pdf", "photo.png", "scan.jpg", "notes.txt", "media.md", "pic.webp", "anim.gif", "corrupt.pdf"))
    page.locator(".file-list li").nth(9).wait_for()
    names = page.locator(".file-list .file-name").all_inner_texts()
    check("files: ten uploaded in order", names == ["cv.pdf", "award.pdf", "letter.pdf", "photo.png", "scan.jpg", "notes.txt", "media.md", "pic.webp", "anim.gif", "corrupt.pdf"], names)
    up.set_input_files(fx("resume.docx", "big.pdf", "empty.txt"))
    page.locator(".notice").wait_for()
    note = page.locator(".notice").inner_text()
    check("files: unsupported, oversized and empty files rejected with reasons", "resume.docx" in note and "格式暂不支持" in note and "big.pdf" in note and "超过 20 MB" in note and "empty.txt" in note and "是空文件" in note, note)
    names = page.locator(".file-list .file-name").all_inner_texts()
    check("files: rejected ones are not listed", "empty.txt" not in names and "resume.docx" not in names and "big.pdf" not in names, names)
    check("files: tab count", page.locator(".tabs button", has_text="文件 10").count() == 1, page.locator(".tabs").inner_text())
    # 替换：普通文件用新文件的名字
    row = page.locator(".file-list li", has_text="award.pdf")
    row.locator("input[type=file]").set_input_files(fx("landscape.pdf"))
    page.locator(".file-list .file-name", has_text="landscape.pdf").wait_for()
    names = page.locator(".file-list .file-name").all_inner_texts()
    check("files: replace keeps position, takes new name", names[1] == "landscape.pdf" and "award.pdf" not in names, names)
    # 删除
    page.once("dialog", lambda d: d.accept())
    page.locator(".file-list li", has_text="anim.gif").get_by_role("button", name="删除").click()
    check("files: delete", page.locator(".file-list .file-name", has_text="anim.gif").count() == 0)
    check("files: paper fetch box listed (4 own + 2 citing)", "选择论文（6）" in page.locator(".paper-fetch").inner_text(), page.locator(".paper-fetch").inner_text()[:120])
    time.sleep(2.5)
    uid = db("select id from users where email=?", (email,))[0][0]
    on_server = db("select count(*) from user_files where user_id=?", (uid,))[0][0]
    check("files: mirrored to server (9 kept, deleted one removed)", on_server == 9, on_server)

    # ---------- 材料清单 ----------
    page.locator(".tabs button", has_text="材料清单").click()
    items = page.locator(".group .item input")
    check("checklist(NIW): ten items", items.count() == 10, items.count())
    items.nth(0).check(); items.nth(3).check(); items.nth(9).check()
    check("checklist: progress 30%", page.locator(".tabs button", has_text="材料清单 30%").count() == 1 and page.locator(".progress").get_attribute("aria-valuenow") == "30")
    items.nth(3).uncheck()
    check("checklist: uncheck -> 20%", page.locator(".tabs button", has_text="材料清单 20%").count() == 1)

    # ---------- 打包下载 ----------
    page.locator(".tabs button", has_text="打包下载").click()
    def rows(section):
        ul = page.locator("h3.section-title", has_text=section).locator("xpath=following-sibling::ul[1]")
        return [(li.locator(".pack-no").inner_text(), li.locator("input.pack-title").input_value(), "off" in (li.get_attribute("class") or "")) for li in ul.locator("li").all()]
    body = rows("正文文书"); ex = rows("Exhibits")
    print("  body:", body); print("  exhibits:", ex)
    check("pack: every doc and file appears once", len(body) + len(ex) == 5 + 9, (len(body), len(ex)))
    check("pack: petition letter is the only body doc included by default", [t for _, t, off in body if not off] == ["Petition Letter of Jane Doe"], body)
    check("pack: working docs (SoC, notable citations) are off by default", sorted(t for _, t, off in body if off) == ["Notable Citations", "Summary of Contributions"], body)
    check("pack: recommendation letter and endeavor statement default to exhibits", [t for _, t, _ in ex[:2]] == ["Proposed Endeavor", "Letter from Dr. Smith"] or sorted(t for _, t, _ in ex[:2]) == ["Letter from Dr. Smith", "Proposed Endeavor"], ex)
    check("pack: working docs carry an explanation", page.locator(".pack-list li", has_text="工作底稿，默认不递交").count() == 2)
    unsupported = [li.inner_text() for li in page.locator(".pack-list li", has_text="此格式无法并入 PDF").all()]
    check("pack: webp flagged as not mergeable", len(unsupported) == 1, unsupported)
    nums = [n for n, _, off in ex if not off]
    check("pack: exhibits numbered 1..N without gaps", nums == [f"Exhibit {i + 1}" for i in range(len(nums))], nums)

    li = lambda title: page.locator(".pack-list li", has=page.locator(f'input.pack-title[value="{title}"]')).first
    # 勾上一份工作底稿再取消
    li("Summary of Contributions").locator("input[type=checkbox]").check()
    check("pack: working doc can be included by hand", rows("正文文书")[-1][2] is False or any(t == "Summary of Contributions" and not off for _, t, off in rows("正文文书")))
    li("Summary of Contributions").locator("input[type=checkbox]").uncheck()
    check("pack: and excluded again", any(t == "Summary of Contributions" and off for _, t, off in rows("正文文书")))
    # 改标题、调顺序、改位置、去掉一个
    li("cv").locator("input.pack-title").fill("Curriculum Vitae of Jane Doe")
    before = [t for _, t, _ in rows("Exhibits")]
    li("scan").get_by_role("button", name="上移").click()
    after = [t for _, t, _ in rows("Exhibits")]
    i = before.index("scan")
    check("pack: move up swaps with previous exhibit", after[i - 1] == "scan" and after[i] == before[i - 1], (before, after))
    first_ex = rows("Exhibits")[0][1]
    check("pack: first exhibit cannot move up", li(first_ex).get_by_role("button", name="上移").is_disabled())
    li("notes").locator("select").select_option("body")
    check("pack: role change moves row to body", any(t == "notes" for _, t, _ in rows("正文文书")))
    li("notes").locator("select").select_option("exhibit")
    li("media").locator("input[type=checkbox]").uncheck()
    ex = rows("Exhibits")
    nums = [n for n, _, off in ex if not off]
    check("pack: numbering closes the gap after excluding one", nums == [f"Exhibit {i + 1}" for i in range(len(nums))] and any(t == "media" and off for _, t, off in ex), ex)
    shot(page, "pack-edited", full=True)

    with page.expect_download() as dl:
        page.get_by_role("button", name="生成并下载 PDF").click()
    pdf = os.path.join(SHOTS, "packet.pdf"); dl.value.save_as(pdf)
    check("pack: file name", dl.value.suggested_filename == "NIW_Jane_Doe.pdf", dl.value.suggested_filename)
    page.locator(".pack-actions .case-meta").wait_for()
    said = int(re.search(r"共 (\d+) 页", page.locator(".pack-actions .case-meta").inner_text()).group(1))
    pages = pdf_pages(pdf)
    check("pack: page count matches what the UI says", said == len(pages), (said, len(pages)))
    warns = page.locator(".notice").all_inner_texts()
    print("  warnings:", warns)
    check("pack: warns about unfilled placeholder", any("1 处 [待补充]" in w for w in warns), warns)
    check("pack: warns about dropped Chinese", any("无法写入 PDF 的字符" in w for w in warns), warns)
    check("pack: warns about the corrupt PDF", any("corrupt" in w and "无法并入" in w for w in warns), warns)
    cover = pages[0]
    check("pack: cover page", "Immigrant Petition for Alien Worker" in cover and "National Interest Waiver of the Job Offer (EB2-NIW)" in cover and "TABLE OF CONTENTS" in cover, cover[:300])
    toc = re.findall(r"p\. (\d+)\s+(.+)", cover)
    print("  toc:", toc)
    check("pack: TOC lists the petition letter on page 2", toc and toc[0] == ("2", "Petition Letter of Jane Doe."), toc)
    check("pack: page 2 is the petition letter", "Petition Letter" in pages[1] and "Dear Officer" in pages[1] and "I. Introduction" in pages[1], pages[1][:300])
    check("pack: markdown rendered (no raw markers)", "**" not in pages[1] and "](" not in pages[1] and "| ---" not in pages[1] and "Bold claim with a link" in pages[1], pages[1])
    check("pack: Chinese dropped, not garbled", "中文" not in pages[1])
    included = [t for _, t, off in ex if not off]
    lst_no = int(toc[-1][0])
    check("pack: TOC last entry is the exhibit list", toc[-1][1] == f"Exhibits 1–{len(included)}." or toc[-1][1].startswith("Exhibits 1"), toc[-1])
    lst = pages[lst_no - 1]
    listed = re.findall(r"Exhibit (\d+):\s+(.+)", lst)
    check("pack: List of Exhibits matches the UI order and titles", [t.strip() for _, t in listed] == included and [n for n, _ in listed] == [str(i + 1) for i in range(len(included))], (listed, included))
    # 每个 Exhibit 的分隔页和紧跟着的内容
    sep = {}
    for idx, text in enumerate(pages):
        m = re.search(r"^\s*Exhibit (\d+)\s*$", text, re.M)
        if m and idx > lst_no - 1 and "List of Exhibits" not in text:
            sep[int(m.group(1))] = idx
    check("pack: one separator page per exhibit, in order", sorted(sep) == list(range(1, len(included) + 1)) and list(sep.values()) == sorted(sep.values()), sep)
    expect_after = {"Curriculum Vitae of Jane Doe": "CV-FIXTURE page 1", "landscape": "LANDSCAPE page 1", "letter": "RECOMMENDATION-FIXTURE page 1", "notes": "Plain text exhibit.",
                    "Letter from Dr. Smith": "Recommendation Letter", "Proposed Endeavor": "Proposed Endeavor of Jane Doe"}
    ok = True; bad = []
    for n, title in enumerate(included, 1):
        if title in expect_after:
            nxt = pages[sep[n] + 1] if sep.get(n) is not None and sep[n] + 1 < len(pages) else ""
            if expect_after[title] not in nxt or title not in pages[sep[n]]:
                ok = False; bad.append((n, title, nxt[:80]))
    check("pack: each separator is followed by that exhibit's content", ok, bad)
    cv_n = included.index("Curriculum Vitae of Jane Doe") + 1
    check("pack: multi-page PDF exhibit kept whole", "CV-FIXTURE page 2" in pages[sep[cv_n] + 2])
    hdr = all("Permanent Residence Petition for Jane Doe" in t for t in pages)
    ftr = all(f"Page {i + 1} of {len(pages)}" in t for i, t in enumerate(pages))
    check("pack: header on every page", hdr)
    check("pack: 'Page X of N' on every page", ftr, [i + 1 for i, t in enumerate(pages) if f"Page {i + 1} of {len(pages)}" not in t])
    long_url_page = pages[sep[included.index("notes") + 1] + 1]
    check("pack: long URL wrapped inside the page", "aaaa" in long_url_page and max(len(l) for l in long_url_page.splitlines()) < 140, max(len(l) for l in long_url_page.splitlines()))

    # 设置刷新后还在
    page.reload()
    page.locator(".account-email").wait_for()
    nav(page, "案件"); page.locator(".case-card").first.click(); page.locator(".tabs button", has_text="打包下载").click()
    ex2 = rows("Exhibits")
    check("pack: settings survive reload", ex2 == ex, (ex2, ex))
    # 删掉一个在包里的文件
    page.locator(".tabs button", has_text="文件").click()
    page.once("dialog", lambda d: d.accept())
    page.locator(".file-list li", has_text="corrupt.pdf").get_by_role("button", name="删除").click()
    page.locator(".tabs button", has_text="打包下载").click()
    check("pack: deleted file disappears from the list", not any(t == "corrupt" for _, t, _ in rows("Exhibits")))
    with page.expect_download() as dl:
        page.get_by_role("button", name="生成并下载 PDF").click()
    dl.value.save_as(pdf)
    page.locator(".pack-actions .case-meta").wait_for()
    check("pack: regenerates cleanly without the corrupt file", not any("无法并入" in w for w in page.locator(".notice").all_inner_texts()), page.locator(".notice").all_inner_texts())

    # 没填英文姓名时的提示（另一个浏览器里的匿名用户看不到案件，这里只看提示文字是否存在于有名字时不出现）
    check("pack: no missing-name notice when the name is filled", page.locator(".notice", has_text="还没有填英文姓名").count() == 0)

    # ---------- 聊天里引用案件资料（不发消息，只看选择器） ----------
    nav(page, "聊天")
    page.locator("select.case-link").select_option(label="关联：我的 NIW 案件")
    page.locator(".picker-wrap button.attach").click()
    labels = page.locator(".picker button").all_inner_texts()
    check("chat: case picker lists the case's docs and files", "Petition Letter of Jane Doe" in labels and "cv.pdf" in labels and len(labels) == 5 + 8, labels)
    page.locator(".picker button", has_text="cv.pdf").click()
    page.locator(".picker-wrap button.attach").click()
    page.locator(".picker button", has_text="Petition Letter of Jane Doe").click()
    chips = page.locator(".composer .chip-name").all_inner_texts()
    check("chat: picked materials become attachment chips", chips == ["cv.pdf", "Petition Letter of Jane Doe.md"], chips)
    page.locator(".composer .chip button").first.click()
    check("chat: chip can be removed", page.locator(".composer .chip-name").all_inner_texts() == ["Petition Letter of Jane Doe.md"])

    # ---------- EB-1A 案件 ----------
    nav(page, "案件")
    page.locator("button.back").click() if page.locator("button.back").count() else None
    page.get_by_role("button", name="+ 新建案件").click()
    page.locator(".case-form .seg button", has_text="EB-1A").click()
    page.locator(".case-form input").fill("EB1A <b>Test</b> & Co")
    page.get_by_role("button", name="创建", exact=True).click()
    page.locator("h2").first.wait_for()
    check("cases: special characters in the name shown literally", page.locator("h2").first.inner_text() == "EB1A <b>Test</b> & Co")
    check("guide(EB-1A): 14 steps", page.locator(".guide li.step").count() == 14, page.locator(".guide li.step").count())
    page.locator(".tabs button", has_text="材料清单").click()
    check("checklist(EB-1A): all ten criteria listed before any is chosen (17 items)", page.locator(".group .item input").count() == 17, page.locator(".group .item input").count())
    page.locator(".tabs button", has_text="申请向导").click()
    boxes = st("选择申报条件").locator(".claims input[type=checkbox]")
    check("claims(EB-1A): ten criteria", boxes.count() == 10, boxes.count())
    boxes.nth(3).check(); boxes.nth(4).check()
    check("claims(EB-1A): two picked says one more needed", "已选 2 项，还差 1 项" in st("选择申报条件").inner_text())
    boxes.nth(5).check()
    check("claims(EB-1A): three -> done", "done" in st("选择申报条件").get_attribute("class"))
    page.locator(".tabs button", has_text="材料清单").click()
    check("checklist(EB-1A): only the three chosen criteria are listed (3 + 2 + 5 items)", page.locator(".group .item input").count() == 10 and page.locator(".group h3").first.inner_text() == "你选择主张的标准", page.locator(".group .item input").count())
    for i in range(10): page.locator(".group .item input").nth(i).check()
    check("checklist(EB-1A): can reach 100% with three criteria", page.locator(".tabs button", has_text="材料清单 100%").count() == 1, page.locator(".tabs").inner_text())
    page.locator(".tabs button", has_text="文档").click()
    wf = [x.inner_text() for x in page.locator(".case-card.workflow strong").all()]
    descs = page.locator(".case-card.workflow .case-meta").all_inner_texts()
    check("docs(EB-1A): the EB-1A letter workflow is offered", any("Final Merits" in d for d in descs) and not any("Dhanasar" in d for d in descs), descs)
    page.locator(".tabs button", has_text="打包下载").click()
    check("pack: empty case says so", page.locator(".group-note", has_text="这个案件里还没有文档或文件").count() == 1)

    # ---------- 删除案件 ----------
    page.locator("button.back").click()
    cards = page.locator(".case-card")
    check("cases: two cases listed", cards.count() == 2, cards.count())
    page.locator(".case-card", has_text="我的 NIW 案件").click()
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="删除案件").click()
    check("cases: deleted case is gone, the other stays", page.locator(".case-card").count() == 1 and "EB1A" in page.locator(".case-card").inner_text())
    saved_docs = json.loads(LS(page, 'pathway.docs'))
    check("cases: its documents are deleted with it", saved_docs == [], [d["title"] for d in saved_docs])
    time.sleep(3)
    left = db("select count(*) from user_files where user_id=?", (uid,))[0][0]
    print("  files left on server after deleting the case:", left)
    check("cases: its files are removed from the server (only the chat-cited snapshot may remain)", left <= 1, left)
    b.close()
finish()
