"""生成测试用的样例文件（内容都是虚构的），放到工作目录的 fixtures/ 下。需要 Pillow；PDF 用项目里的 pdf-lib 生成。"""
import os, subprocess
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
S = os.environ.get("TEST_WORK") or os.path.join(os.path.dirname(HERE), ".work")
D = os.path.join(S, "fixtures")
os.makedirs(D, exist_ok=True)

NODE = """
const { PDFDocument, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const out = process.argv[1];
(async () => {
  const mk = async (name, pages, text) => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) d.addPage([612, 792]).drawText(`${text} page ${i + 1}`, { x: 72, y: 700, size: 18, font: f });
    fs.writeFileSync(`${out}/${name}`, await d.save());
  };
  await mk("cv.pdf", 2, "CV-FIXTURE");
  await mk("award.pdf", 1, "AWARD-FIXTURE");
  await mk("letter.pdf", 3, "RECOMMENDATION-FIXTURE");
  await mk("landscape.pdf", 1, "LANDSCAPE");
})();
"""
subprocess.run(["node", "-e", NODE, D], cwd=ROOT, check=True)

def image(name, fmt, size, exif=None):
    im = Image.new("RGB", size, (230, 240, 235))
    dr = ImageDraw.Draw(im)
    dr.rectangle([20, 20, size[0] - 20, size[1] - 20], outline=(30, 90, 70), width=8)
    dr.text((60, 60), name, fill=(0, 0, 0))
    kw = {}
    if exif:
        e = im.getexif(); e[0x0112] = exif; kw["exif"] = e
    im.save(os.path.join(D, name), fmt, **kw)

image("photo.png", "PNG", (1600, 1000))
image("scan.jpg", "JPEG", (900, 1400))
image("pic.webp", "WEBP", (300, 200))
image("anim.gif", "GIF", (120, 80))
image("phone.jpg", "JPEG", (800, 600), exif=6)  # 像素是横的，记号说显示时要转成竖的

def write(name, data, mode="w"):
    with open(os.path.join(D, name), mode) as f:
        f.write(data)

write("notes.txt", "Plain text exhibit.\nSecond line with a very long URL https://example.org/" + "a" * 180 + "\n")
write("media.md", "# Media Coverage\n\nTechDaily, \"A faster way to test batteries\", May 12, 2025.\n\n- point one\n- point two\n")
write("resume.docx", b"PK\x03\x04 not really a docx", "wb")
write("big.pdf", b"%PDF-1.4\n" + b"0" * (20 * 1024 * 1024 + 5), "wb")
write("corrupt.pdf", b"%PDF-1.4\nthis is not a real pdf body\n%%EOF", "wb")
write("empty.txt", "")

# 一份虚构的 Google Scholar 主页（另存的网页），结构和真的一样
papers = [("Early-cycle prediction of battery lifetime &amp; degradation", "J Doe, A Smith", "Nature Energy 9 (3), 123-134", 320, 2024),
          ("BattLife: an open benchmark for <b>battery</b> degradation", "J Doe, B Lee", "Joule 7, 55-70", 150, 2023),
          ("A paper with no citations yet", "J Doe", "arXiv preprint arXiv:2601.00001", "", 2026),
          ("Transfer learning across battery chemistries", "J Doe, C Wang, D Kim", "Journal of Power Sources 500", 61, 2022)]
rows = "".join(
    f'<tr class="gsc_a_tr"><td class="gsc_a_t"><a href="/citations?view_op=view_citation" class="gsc_a_at">{t}</a><div class="gs_gray">{a}</div>'
    f'<div class="gs_gray">{v}<span class="gs_oph">, {y}</span></div></td><td class="gsc_a_c"><a href="#" class="gsc_a_ac gs_ibl">{c}</a></td>'
    f'<td class="gsc_a_y"><span class="gsc_a_h gsc_a_hc gs_ibl">{y}</span></td></tr>' for t, a, v, c, y in papers)
stats = "".join(f'<td class="gsc_rsb_std">{n}</td>' for n in [531, 520, 3, 3, 3, 3])
write("scholar_page.html", f"""<!doctype html><html><head><title>Jane Doe - Google Scholar</title></head><body>
<div id="gsc_prf_in">Jane Doe</div>
<table id="gsc_rsb_st"><tr>{stats}</tr></table>
<table id="gsc_a_t"><tbody id="gsc_a_b">{rows}</tbody></table>
<button type="button" id="gsc_bpf_more" class="gs_btnPD" disabled><span>Show more</span></button>
</body></html>""")
print("fixtures written to", D)
