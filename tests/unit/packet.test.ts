import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { buildPacket } from "@/lib/packet";
import type { PacketItem } from "@/lib/packet";

const DIR = process.argv[2];
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -- " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 600))); };
const pagesOf = (file: string, layout = true) => {
  const n = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file]).toString())![1]);
  return Array.from({ length: n }, (_, i) => execFileSync("pdftotext", ["-f", String(i + 1), "-l", String(i + 1), ...(layout ? ["-layout"] : []), file, "-"]).toString());
};
async function build(items: PacketItem[], name = "out") {
  const r = await buildPacket({ caseType: "NIW", petitioner: "Jane Doe", items });
  const file = `${DIR}/${name}.pdf`;
  writeFileSync(file, r.bytes);
  return { ...r, file, text: pagesOf(file) };
}
async function srcPdf(label: string, mod?: (d: PDFDocument) => void) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([612, 792]);
  p.drawText(label, { x: 200, y: 300, size: 20, font: f });
  mod?.(d);
  return new Uint8Array(await d.save());
}

(async () => {
  // ---------- 表格 ----------
  let r = await build([{ role: "body", title: "Tables", format: "markdown", text: "# Citation Metrics\n\n| Source | Publications | Citations | h-index | Retrieved |\n| --- | --- | --- | --- | --- |\n| Semantic Scholar | 120+ | 3456 | 25 | November 20, 2026 |\n| Google Scholar | 131 | 4012 | 27 | November 21, 2026 |\n\nAfter the table.\n\n| Criterion | Evidence |\n|---|---|\n| Original contributions | " + "A long cell that must wrap inside its own column without running into the next one. ".repeat(4) + "|\n" }], "tables");
  const t = r.text[1];
  ok("table: columns stay apart (not collapsed into a run of words)", /Source\s+Publications\s+Citations\s+h-index\s+Retrieved/.test(t) && /Semantic Scholar\s+120\+\s{2,}3456\s{2,}25\s{2,}November 20, 2026/.test(t) && /Google Scholar\s{2,}131\s{2,}4012/.test(t), t.slice(0, 700));
  ok("table: text after the table still there, long cell wrapped within the page", t.includes("After the table.") && t.split("\n").every((l) => l.length < 130) && (t.match(/A long cell/g) ?? []).length >= 1, t.slice(-600));

  // ---------- 很长的一串字符 ----------
  const t0 = Date.now();
  r = await build([{ role: "body", title: "Long", format: "markdown", text: "Start " + "A1b2C3d4".repeat(1500) + " end.\n\n- item " + "x".repeat(400) + "\n" }], "long");
  ok("long token: 12,000 unbroken characters laid out quickly", Date.now() - t0 < 4000, Date.now() - t0);
  const bodyText = r.text.slice(1).map((p) => p.replace(/Permanent Residence Petition for Jane Doe/, "").replace(/Page \d+ of \d+/, "")).join("").replace(/\s/g, "");
  ok("long token: nothing lost", bodyText.includes("A1b2C3d4".repeat(1500)) && bodyText.includes("end."), bodyText.length);
  ok("long token: hanging list line stays inside the right margin", r.text.slice(1).join("\n").split("\n").every((l) => l.length < 125), Math.max(...r.text.slice(1).join("\n").split("\n").map((l) => l.length)));

  // ---------- 字符 ----------
  r = await build([{ role: "body", title: "Chars", format: "markdown", text: "Text classiﬁcation is deﬁned and ﬂuent; eﬃcient. A layer of 10 μm at −5% with ≥ 5 runs and λ = 0.5, θ → 0.\n\nThin space and narrow space and ideographic　space. Zero​width. Names: Łukasz, Nguyễn, Dvořák.\n\nOdd: ∮ and ⌘.\n\n中文段落。" }], "chars");
  const c = r.text[1].replace(/\s+/g, " ");
  ok("chars: ligatures expanded, not deleted", c.includes("Text classification is defined and fluent; efficient."), c);
  ok("chars: micro, minus, comparison, Greek and arrow kept in readable form", c.includes("10 µm at -5% with >= 5 runs and lambda = 0.5, theta -> 0."), c);
  ok("chars: unusual spaces become spaces (words not glued)", c.includes("Thin space and narrow space and ideographic space") && c.includes("Zerowidth"), c);
  ok("chars: accented names keep their letters", c.includes("Lukasz") && c.includes("Nguyen") && /Dvo.?r.?ák|Dvorák/.test(c), c);
  ok("chars: what cannot be written is named in a warning", r.warnings.some((w) => w.includes("特殊符号") && w.includes("∮")) && r.warnings.some((w) => w.includes("例如中文")), r.warnings);

  // ---------- 标题里的行内标记、链接、粗体后的标点 ----------
  r = await build([{ role: "body", title: "Inline", format: "markdown", text: "## The *Matter of Dhanasar* test and [the manual](https://www.uscis.gov/policy-manual)\n\nSee [https://example.org/a](https://example.org/a) and [this report](https://example.org/report.pdf).\n\n" + "word ".repeat(14) + "as shown in the record (**Exhibit 12**), and elsewhere (**Exhibit 13**); more text follows here to fill the line.\n" }], "inline");
  const il = r.text[1];
  ok("inline: heading has no raw markdown", il.includes("The Matter of Dhanasar test and the manual (https://www.uscis.gov/policy-manual)") && !il.includes("*") && !il.includes("]("), il.slice(0, 400));
  ok("inline: link targets are printed once", il.includes("this report (https://example.org/report.pdf)") && (il.match(/https:\/\/example\.org\/a/g) ?? []).length === 1, il);
  ok("inline: closing bracket stays with the bold text it follows", !/\n\s*\), and/.test(il) && !/\n\s*\);/.test(il) && il.replace(/\s+/g, " ").includes("(Exhibit 12), and elsewhere (Exhibit 13);"), il);

  // ---------- 标题不留在页底 ----------
  r = await build([{ role: "body", title: "Orphan", format: "markdown", text: Array.from({ length: 38 }, (_, i) => `Line ${i + 1} of filler text.`).join("\n\n") + "\n\n## Heading That Must Not Be Orphaned\n\nBody after the heading.\n" }], "orphan");
  const hp = r.text.findIndex((p) => p.includes("Heading That Must Not Be Orphaned"));
  ok("heading: not left alone at the bottom of a page", hp > 0 && r.text[hp].includes("Body after the heading."), r.text.map((p) => p.trim().split("\n").slice(-2)));

  // ---------- 纯文本 ----------
  r = await build([{ role: "exhibit", title: "Notes", format: "text", text: "Line one\n# not a heading\n- not a list\n\nAfter blank line\n| a | b |\n" }], "text");
  const tx = r.text[r.text.length - 1];
  ok("text: plain text keeps its lines and symbols", /Line one\n\s*# not a heading\n\s*- not a list/.test(tx) && /\|\s*a\s*\|\s*b\s*\|/.test(tx), tx);
  ok("toc: one exhibit reads 'Exhibit 1.'", r.text[0].includes("Exhibit 1.") && !r.text[0].includes("1–1"), r.text[0]);

  // ---------- 加密、缺失、没有英文标题 ----------
  writeFileSync(`${DIR}/plain.pdf`, await srcPdf("SECRET CONTENT"));
  execFileSync("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", "-sOwnerPassword=owner", "-dEncryptionR=3", "-dKeyLength=128", `-sOutputFile=${DIR}/enc.pdf`, `${DIR}/plain.pdf`]);
  r = await build([
    { role: "exhibit", title: "Good one", format: "pdf", data: await srcPdf("GOOD-ONE") },
    { role: "exhibit", title: "Encrypted statement", format: "pdf", data: new Uint8Array(readFileSync(`${DIR}/enc.pdf`)) },
    { role: "exhibit", title: "Lost file", format: "missing" },
    { role: "exhibit", title: "推荐信", format: "markdown", text: "# Letter\n\nBody.\n" },
    { role: "exhibit", title: "Last", format: "pdf", data: await srcPdf("LAST-ONE") },
  ], "problems");
  ok("encrypted: a protected PDF is reported instead of producing blank pages", r.warnings.some((w) => w.includes("Exhibit 2") && w.includes("加密")), r.warnings);
  ok("missing: a file that cannot be found keeps its number and is reported", r.warnings.some((w) => w.includes("Exhibit 3") && w.includes("找不到")), r.warnings);
  ok("untitled: a title with no English is pointed out", r.warnings.some((w) => w.includes("Exhibit 4") && w.includes("没有英文")), r.warnings);
  const seps = r.text.map((p, i) => (/^\s*Exhibit (\d)\s*$/m.exec(p) && !p.includes("List of Exhibits") ? i : -1)).filter((i) => i > 0);
  ok("numbering: five separators in order; the last exhibit is still number 5", seps.length === 5 && r.text[seps[4] + 1].includes("LAST-ONE") && r.text[seps[0] + 1].includes("GOOD-ONE"), seps);
  ok("list: all five exhibits listed", ["Exhibit 1:", "Exhibit 2:", "Exhibit 3:", "Exhibit 4:", "Exhibit 5:"].every((x) => r.text[1].includes(x)), r.text[1]);

  // ---------- 旋转、裁剪、原点偏移的页面：页眉页码写在看得见的地方 ----------
  const rot = async (angle: number) => srcPdf(`ROT-${angle}`, (d) => d.getPage(0).setRotation(degrees(angle)));
  const offset = await srcPdf("OFFSET", (d) => { const p = d.getPage(0); p.setMediaBox(100, 100, 612, 792); });
  const crop = await srcPdf("CROPPED", (d) => { const p = d.getPage(0); p.setCropBox(50, 50, 400, 500); });
  r = await build([{ role: "exhibit", title: "R90", format: "pdf", data: await rot(90) }, { role: "exhibit", title: "R180", format: "pdf", data: await rot(180) }, { role: "exhibit", title: "R270", format: "pdf", data: await rot(270) },
    { role: "exhibit", title: "Offset box", format: "pdf", data: offset }, { role: "exhibit", title: "Crop box", format: "pdf", data: crop }], "rotated");
  const n = r.text.length;
  const missing = r.text.map((p, i) => (p.includes("Permanent Residence Petition for Jane Doe") && p.includes(`Page ${i + 1} of ${n}`) ? -1 : i + 1)).filter((i) => i > 0);
  ok("stamps: header and page number readable on every page, including rotated and cropped ones", missing.length === 0, { missing, n });
  // 看得见的位置：页眉在看上去的顶部、页码在底部（按排版顺序，页眉先于正文，页码在最后）
  const order = r.text.filter((p) => /ROT-|OFFSET|CROPPED/.test(p)).map((p) => { const a = p.indexOf("Permanent Residence"); const b = p.search(/ROT-|OFFSET|CROPPED/); const c2 = p.search(/Page \d+ of/); return a < b && b < c2; });
  ok("stamps: header above the content and page number below it on those pages", order.length === 5 && order.every(Boolean), order);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
