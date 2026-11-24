import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";

/**
 * 把一个案件的文书和材料合成一份递交用的 PDF：
 *   首页（标题 + 目录）→ 正文文书 → List of Exhibits → 各个 Exhibit（分隔页 + 内容）
 * 每页左上角有页眉，右下角有 "Page X of N"。
 */

export type PacketItem = {
  role: "body" | "exhibit";
  title: string;
  /**
   * markdown：我们自己排版；text：纯文本，逐行照排；pdf / png / jpg：原样并入；
   * missing：文件内容找不到了（Exhibit 仍然保留分隔页，编号才不会和页面上、申请信里的对不上）
   */
  format: "markdown" | "text" | "pdf" | "png" | "jpg" | "missing";
  text?: string;
  data?: Uint8Array;
};

export type PacketOptions = {
  caseType: "NIW" | "EB-1A";
  petitioner: string;
  items: PacketItem[];
};

const W = 612;
const H = 792;
const MX = 72;
const TOP = 80;
const BOTTOM = 72;
const SIZE = 11.5;
const LEAD = 16;

type Run = { text: string; bold: boolean };

// 标准字体（Times，WinAnsi 编码）写不了的常见字符，换成能写的近似写法；换不了的才略去
const SUBST: Record<string, string> = {
  "−": "-", "‐": "-", "‑": "-", "‒": "-", "―": "-", "⁃": "-",
  "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "⇔": "<=>",
  "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "∼": "~", "∞": "infinity", "√": "sqrt",
  "′": "'", "″": '"', "∗": "*", "∙": "·", "⋅": "·", "∘": "°", "✕": "x", "✓": "v", "✔": "v",
  "μ": "µ", "µ": "µ",
  "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon", "ζ": "zeta", "η": "eta",
  "θ": "theta", "κ": "kappa", "λ": "lambda", "ν": "nu", "ξ": "xi", "π": "pi", "ρ": "rho",
  "σ": "sigma", "τ": "tau", "φ": "phi", "χ": "chi", "ψ": "psi", "ω": "omega",
  "Γ": "Gamma", "Δ": "Delta", "Θ": "Theta", "Λ": "Lambda", "Π": "Pi", "Σ": "Sigma", "Φ": "Phi", "Ψ": "Psi", "Ω": "Omega",
  "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ı": "i", "ℓ": "l",
};
const ZERO_WIDTH = /[​-‏⁠﻿­]/;
const CJK = /[⺀-鿿가-힯豈-﫿＀-￯]/;

class Layout {
  page!: PDFPage;
  y = 0;
  pages = 0;
  cjkDropped = false; // 有中日韩文字被略去
  dropped = new Set<string>(); // 其他被略去的字符
  private cache = new Map<string, string | null>();

  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {}

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.y = H - TOP;
    this.pages++;
  }

  need(h: number) {
    if (this.y - h < BOTTOM) this.newPage();
  }

  private encodable(s: string): boolean {
    try {
      this.font.encodeText(s);
      return true;
    } catch {
      return false;
    }
  }

  /** 一个字符在 PDF 里怎么写：原样、换成近似写法，或者写不了（返回 null） */
  private one(ch: string): string | null {
    const hit = this.cache.get(ch);
    if (hit !== undefined) return hit;
    let out: string | null;
    if (ch === "\n") out = "\n";
    else if (/\s/.test(ch)) out = " "; // 各种宽度的空格、制表符
    else if (ZERO_WIDTH.test(ch)) out = "";
    else if (this.encodable(ch)) out = ch;
    else if (SUBST[ch] !== undefined && this.encodable(SUBST[ch])) out = SUBST[ch];
    else {
      // 连字（ﬁ）、上下标、带音调符号的字母等：拆成基本字符再试
      const plain = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out = plain && plain !== ch && [...plain].every((c) => this.encodable(c)) ? plain : null;
    }
    this.cache.set(ch, out);
    return out;
  }

  /** 换成标准字体写得了的字符；实在写不了的略去并记下来 */
  clean(s: string): string {
    let out = "";
    for (const ch of s) {
      const v = this.one(ch);
      if (v !== null) out += v;
      else if (CJK.test(ch)) this.cjkDropped = true;
      else this.dropped.add(ch);
    }
    return out;
  }

  /** 把一个比行宽还长的词（网址、一长串字符）按宽度切开。逐字累加宽度，不重复测量 */
  private chop(text: string, font: PDFFont, size: number, max: number): string[] {
    const out: string[] = [];
    let cur = "";
    let w = 0;
    for (const ch of text) {
      const cw = font.widthOfTextAtSize(ch, size);
      if (cur && w + cw > max) {
        out.push(cur);
        cur = "";
        w = 0;
      }
      cur += ch;
      w += cw;
    }
    if (cur) out.push(cur);
    return out;
  }

  /** 自动换行地画一段文字，返回后 y 停在段落下方 */
  para(runs: Run[], opts: { size?: number; indent?: number; hang?: number; lead?: number; center?: boolean } = {}) {
    const size = opts.size ?? SIZE;
    const lead = opts.lead ?? LEAD * (size / SIZE);
    const left = MX + (opts.indent ?? 0);
    const max = W - MX - left;
    const hangW = opts.hang ?? 0;

    // glue：紧跟在上一个词后面、中间没有空格（比如粗体后面的右括号），换行时不能和它分开
    type Word = { text: string; font: PDFFont; w: number; space: boolean; glue: boolean };
    const words: Word[] = [];
    for (const r of runs) {
      const font = r.bold ? this.bold : this.font;
      for (const part of this.clean(r.text).split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          if (words.length) words[words.length - 1].space = true;
          continue;
        }
        const glue = words.length > 0 && !words[words.length - 1].space;
        // 超长的词按宽度拆开；拆的时候按带悬挂缩进的行宽算，免得续行冲出右边距
        const pieces = font.widthOfTextAtSize(part, size) > max - hangW ? this.chop(part, font, size, max - hangW) : [part];
        pieces.forEach((p, i) => words.push({ text: p, font, w: font.widthOfTextAtSize(p, size), space: false, glue: i === 0 && glue }));
      }
    }
    if (!words.length) return;

    // 粘在一起的词合成一个不可拆的单元
    const units: Word[][] = [];
    for (const w of words) {
      if (w.glue && units.length) units[units.length - 1].push(w);
      else units.push([w]);
    }
    const spaceW = this.font.widthOfTextAtSize(" ", size);
    const widthOf = (u: Word[]) => u.reduce((n, w) => n + w.w, 0);
    let line: Word[] = [];
    let lineW = 0;
    let first = true;
    const flush = () => {
      if (!line.length) return;
      this.need(lead);
      const hang = first ? 0 : hangW;
      let x = opts.center ? (W - lineW) / 2 : left + hang;
      for (const w of line) {
        this.page.drawText(w.text, { x, y: this.y - size, size, font: w.font });
        x += w.w + (w.space ? spaceW : 0);
      }
      this.y -= lead;
      first = false;
      line = [];
      lineW = 0;
    };
    const put = (u: Word[]) => {
      const room = max - (first ? 0 : hangW);
      const gap = line.length && line[line.length - 1].space ? spaceW : 0;
      if (line.length && lineW + gap + widthOf(u) > room) flush();
      const room2 = max - (first ? 0 : hangW);
      if (!line.length && widthOf(u) > room2 && u.length > 1) {
        // 这个单元本身比一行还宽：只好在词之间拆
        u.forEach((w) => put([w]));
        return;
      }
      lineW += (line.length && line[line.length - 1].space ? spaceW : 0) + widthOf(u);
      line.push(...u);
    };
    units.forEach(put);
    flush();
  }

  gap(h: number) {
    this.y -= h;
  }

  /** 简单的表格：按内容分配列宽，单元格里自动换行，表头加粗 */
  table(rows: string[][]) {
    const cols = Math.max(...rows.map((r) => r.length));
    if (!cols) return;
    const size = 10;
    const lead = 13.5;
    const pad = 5;
    const total = W - 2 * MX;
    const cells = rows.map((r) => Array.from({ length: cols }, (_, c) => this.clean(r[c] ?? "").replace(/\s+/g, " ").trim()));
    // 每列想要的宽度：最长的单元格，但不超过整行的一半；然后按比例压进页面
    const want = Array.from({ length: cols }, (_, c) =>
      Math.max(30, Math.min(total / 2, Math.max(...cells.map((r, i) => (i === 0 ? this.bold : this.font).widthOfTextAtSize(r[c], size))))),
    );
    const room = total - 2 * pad * cols;
    const sum = want.reduce((a, b) => a + b, 0);
    const widths = sum <= room ? want : want.map((w) => Math.max(24, (w * room) / sum));
    const wrap = (text: string, font: PDFFont, max: number): string[] => {
      const lines: string[] = [];
      let cur = "";
      for (const word of text.split(" ").flatMap((w) => (font.widthOfTextAtSize(w, size) > max ? this.chop(w, font, size, max) : [w]))) {
        const next = cur ? `${cur} ${word}` : word;
        if (cur && font.widthOfTextAtSize(next, size) > max) {
          lines.push(cur);
          cur = word;
        } else cur = next;
      }
      if (cur) lines.push(cur);
      return lines.length ? lines : [""];
    };
    const line = (y: number, shade: number) =>
      this.page.drawLine({ start: { x: MX, y }, end: { x: W - MX, y }, thickness: 0.5, color: rgb(shade, shade, shade) });
    cells.forEach((row, i) => {
      const font = i === 0 ? this.bold : this.font;
      const wrapped = row.map((t, c) => wrap(t, font, widths[c]));
      const h = Math.max(...wrapped.map((l) => l.length)) * lead + 6;
      if (this.y - h < BOTTOM) this.newPage();
      if (i === 0) line(this.y, 0.55);
      let x = MX;
      wrapped.forEach((lines, c) => {
        lines.forEach((t, k) => this.page.drawText(t, { x: x + pad, y: this.y - 3 - size - k * lead, size, font }));
        x += widths[c] + 2 * pad;
      });
      this.y -= h;
      line(this.y, i === 0 ? 0.55 : 0.82);
    });
    this.gap(8);
  }
}

/** 把一行里的 Markdown 行内标记转成粗体 / 普通文字 */
function inline(s: string): Run[] {
  s = s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // 链接：打印出来的材料点不了，网址本身就是出处，所以留在文字后面
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, text: string, url: string) =>
      /^https?:\/\//i.test(url) && !text.includes(url.replace(/^https?:\/\//i, "").replace(/\/$/, "")) ? `${text} (${url})` : text,
    )
    .replace(/`([^`]+)`/g, "$1");
  const runs: Run[] = [];
  s.split(/(\*\*[^*]+\*\*|__[^_]+__)/).forEach((part) => {
    if (!part) return;
    const bold = /^(\*\*|__)/.test(part);
    const text = (bold ? part.slice(2, -2) : part).replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2");
    runs.push({ text, bold });
  });
  return runs;
}

const isRule = (line: string) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
const isTableRow = (line: string) => line.trim().startsWith("|");
const isTableSep = (line: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-") && line.includes("|");

/** 把 Markdown 排进 PDF（标题、段落、列表、引用、表格） */
function renderMarkdown(lay: Layout, md: string) {
  let buf: string[] = [];
  const flush = (gap = 8) => {
    if (!buf.length) return;
    lay.para(inline(buf.join(" ")));
    lay.gap(gap);
    buf = [];
  };
  const lines = md.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      flush();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      const level = m[1].length;
      const size = level === 1 ? 15 : level === 2 ? 13 : 12;
      // 标题后面至少还要放得下两行正文，不然标题会孤零零留在页底
      lay.need(size * 1.4 + 14 + LEAD * 2);
      lay.gap(level === 1 ? 6 : 4);
      lay.para(inline(m[2]).map((r) => ({ text: r.text, bold: true })), { size, center: level === 1 });
      lay.gap(8);
    } else if (isRule(line)) {
      flush();
      lay.gap(8);
    } else if ((m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
      flush();
      const depth = Math.min(3, Math.floor(m[1].length / 2));
      const label = /\d/.test(m[2]) ? m[2].replace(")", ".") : "•";
      const indent = 14 + depth * 18;
      lay.para([{ text: `${label}  `, bold: false }, ...inline(m[3])], { indent, hang: 16 });
      lay.gap(4);
    } else if (isTableRow(line)) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && isTableRow(lines[i]); i++) {
        if (isTableSep(lines[i])) continue;
        rows.push(
          lines[i]
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((c) => inline(c.trim()).map((r) => r.text).join("")),
        );
      }
      i--;
      if (rows.length) lay.table(rows);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flush();
      lay.para(inline(m[1]), { indent: 18 });
      lay.gap(6);
    } else {
      buf.push(line.trim().replace(/\\$/, ""));
      // 行尾两个空格或反斜杠是 Markdown 的强制换行（信头、地址、落款常用），这一行单独成行
      if (/( {2,}|\\)$/.test(raw)) flush(2);
    }
  }
  flush();
}

/** 纯文本文件：一行一行照排，空行留空 */
function renderText(lay: Layout, text: string) {
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    if (!raw.trim()) lay.gap(8);
    else {
      lay.para([{ text: raw, bold: false }]);
      lay.gap(1);
    }
  }
}

function truncate(font: PDFFont, s: string, size: number, max: number) {
  if (font.widthOfTextAtSize(s, size) <= max) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + "...", size) > max) s = s.slice(0, -1);
  return s + "...";
}

/**
 * 在一页「看上去」的坐标里写字（原点在看上去的左下角）。并进来的 PDF 可能带旋转（横向扫描件）、
 * 裁剪框或者原点不在 0 的页面框，直接用页面自己的坐标写会写歪、写到看不见的地方。
 */
function stamp(page: PDFPage, text: string, font: PDFFont, size: number, at: (vw: number, vh: number) => { x: number; y: number }) {
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const box = page.getCropBox();
  const side = rot === 90 || rot === 270;
  const vw = side ? box.height : box.width;
  const vh = side ? box.width : box.height;
  const v = at(vw, vh);
  const p =
    rot === 90
      ? { x: box.x + box.width - v.y, y: box.y + v.x }
      : rot === 180
        ? { x: box.x + box.width - v.x, y: box.y + box.height - v.y }
        : rot === 270
          ? { x: box.x + v.y, y: box.y + box.height - v.x }
          : { x: box.x + v.x, y: box.y + v.y };
  page.drawText(text, { ...p, size, font, rotate: degrees(rot) });
}

export async function buildPacket(opts: PacketOptions) {
  const warnings: string[] = [];
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.TimesRoman);
  const bold = await out.embedFont(StandardFonts.TimesRomanBold);
  const lay = new Layout(out, font, bold);

  const name = lay.clean(opts.petitioner).trim() || "the Petitioner";
  const body = opts.items.filter((i) => i.role === "body");
  const exhibits = opts.items.filter((i) => i.role === "exhibit");
  const untitled: string[] = []; // 标题里没有能印出来的字符的
  const label = (i: PacketItem, fallback: string, what: string) => {
    const t = lay.clean(i.title).replace(/\s+/g, " ").trim();
    if (t) return t;
    untitled.push(what);
    return fallback;
  };

  // 把一份材料并入，返回它占的页数
  async function append(item: PacketItem): Promise<number> {
    const before = out.getPageCount();
    if (item.format === "markdown" || item.format === "text") {
      lay.newPage();
      (item.format === "markdown" ? renderMarkdown : renderText)(lay, item.text ?? "");
    } else if (item.format === "pdf") {
      const src = await PDFDocument.load(item.data!, { ignoreEncryption: true });
      // 加密的 PDF 即使不用密码就能打开，页面内容也是加密的，并进来会是白页
      if (src.isEncrypted) throw new Error("encrypted");
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));
    } else if (item.format === "png" || item.format === "jpg") {
      const img = item.format === "png" ? await out.embedPng(item.data!) : await out.embedJpg(item.data!);
      const page = out.addPage([W, H]);
      const scale = Math.min((W - 2 * MX) / img.width, (H - TOP - BOTTOM) / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (W - w) / 2, y: BOTTOM + (H - TOP - BOTTOM - h) / 2, width: w, height: h });
    } else {
      throw new Error("missing");
    }
    return out.getPageCount() - before;
  }
  const why = (e: unknown) =>
    e instanceof Error && e.message === "encrypted"
      ? "是加密的 PDF（设了权限保护），内容并不进来。请用「打印 → 另存为 PDF」另存一份不加密的，再在「文件」里点「替换」"
      : e instanceof Error && e.message === "missing"
        ? "的文件内容找不到了，请到「文件」里重新上传"
        : "的内容无法并入（文件可能已损坏）";

  // 第 1 页先占位，等页码都确定了再填目录
  const cover = out.addPage([W, H]);

  const toc: { page: number; text: string }[] = [];
  for (const [i, item] of body.entries()) {
    const start = out.getPageCount() + 1;
    try {
      await append(item);
      toc.push({ page: start, text: label(item, `Document ${i + 1}`, `正文第 ${i + 1} 份`) + "." });
    } catch (e) {
      warnings.push(`「${item.title}」${why(e)}，这次没有放进去`);
    }
  }

  if (exhibits.length) {
    const titles = exhibits.map((e, i) => label(e, "(untitled)", `Exhibit ${i + 1}`));
    // List of Exhibits
    const listStart = out.getPageCount() + 1;
    lay.newPage();
    lay.para([{ text: "List of Exhibits", bold: true }], { size: 13 });
    lay.gap(10);
    exhibits.forEach((_, i) => {
      lay.para([{ text: `Exhibit ${i + 1}:  ${titles[i]}`, bold: false }], { hang: 58 });
      lay.gap(2);
    });
    toc.push({ page: listStart, text: exhibits.length === 1 ? "Exhibit 1." : `Exhibits 1–${exhibits.length}.` });

    for (const [i, e] of exhibits.entries()) {
      // 分隔页：居中 "Exhibit N"，左下角是标题
      const sep = out.addPage([W, H]);
      const head = `Exhibit ${i + 1}`;
      sep.drawText(head, { x: (W - bold.widthOfTextAtSize(head, 18)) / 2, y: H / 2 + 20, size: 18, font: bold });
      sep.drawText(truncate(font, titles[i], 12, W - 2 * MX), { x: MX, y: BOTTOM + 12, size: 12, font });
      try {
        await append(e);
      } catch (err) {
        warnings.push(`Exhibit ${i + 1}「${e.title}」${why(err)}。这次只保留了分隔页`);
      }
    }
  }

  // 首页：标题 + 目录
  const center = (text: string, y: number, size: number, f: PDFFont) =>
    cover.drawText(text, { x: (W - f.widthOfTextAtSize(text, size)) / 2, y, size, font: f });
  let y = H - 150;
  center("Immigrant Petition for Alien Worker", y, 14, bold);
  y -= 20;
  center(
    opts.caseType === "NIW"
      ? "National Interest Waiver of the Job Offer (EB2-NIW)"
      : "Alien of Extraordinary Ability (EB-1A)",
    y,
    14,
    bold,
  );
  y -= 70;
  center("TABLE OF CONTENTS", y, 12, bold);
  y -= 36;
  for (const t of toc) {
    const p = `p. ${t.page}`;
    cover.drawText(p, { x: MX + 46 - font.widthOfTextAtSize(p, SIZE), y, size: SIZE, font });
    cover.drawText(truncate(font, t.text, SIZE, W - MX - (MX + 56)), { x: MX + 56, y, size: SIZE, font });
    y -= 24;
    if (y < BOTTOM) break;
  }

  // 页眉、页码
  const total = out.getPageCount();
  const header = `Permanent Residence Petition for ${name}`;
  out.getPages().forEach((page, i) => {
    const foot = `Page ${i + 1} of ${total}`;
    stamp(page, header, font, 8, (_, vh) => ({ x: 36, y: vh - 30 }));
    stamp(page, foot, font, 9, (vw) => ({ x: vw - 36 - font.widthOfTextAtSize(foot, 9), y: 24 }));
  });

  const todo = opts.items.reduce((n, i) => n + (i.text?.match(/\[(待补充|待核实|TODO)/g)?.length ?? 0), 0);
  if (todo) {
    warnings.unshift(`文书里还有 ${todo} 处 [待补充] 或 [待核实] 没有填。它们会原样留在 PDF 里（其中的中文会被略去），递交前必须逐个补上`);
  }
  if (untitled.length) {
    warnings.push(`${untitled.join("、")} 的标题里没有英文，目录里显示不出来。请在上面把标题改成英文`);
  }
  if (lay.cjkDropped) warnings.push("文书或标题里有无法写入 PDF 的字符（例如中文），已被略去。递交给 USCIS 的材料应为英文");
  if (lay.dropped.size) {
    warnings.push(
      `有 ${lay.dropped.size} 种特殊符号写不进 PDF，已被略去：${[...lay.dropped].slice(0, 20).join(" ")}。请在文书里把它们换成普通的写法（比如把符号写成英文单词）后重新生成`,
    );
  }
  out.setTitle(`${opts.caseType} Petition - ${name}`);
  return { bytes: await out.save(), pages: total, warnings };
}
