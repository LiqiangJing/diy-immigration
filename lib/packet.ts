import { PDFDocument, StandardFonts } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";

/**
 * 把一个案件的文书和材料合成一份递交用的 PDF：
 *   首页（标题 + 目录）→ 正文文书 → List of Exhibits → 各个 Exhibit（分隔页 + 内容）
 * 每页左上角有页眉，右下角有 "Page X of N"。
 */

export type PacketItem = {
  role: "body" | "exhibit";
  title: string;
  /** markdown：我们自己排版；pdf / png / jpg：原样并入 */
  format: "markdown" | "pdf" | "png" | "jpg";
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

class Layout {
  page!: PDFPage;
  y = 0;
  pages = 0;
  dropped = false; // 有字符无法写入（如中文）
  private cache = new Map<string, boolean>();

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

  /** 去掉标准字体写不了的字符 */
  clean(s: string): string {
    let out = "";
    for (const ch of s.replace(/\t/g, "  ").replace(/[‐‑]/g, "-").replace(/ /g, " ")) {
      let ok = this.cache.get(ch);
      if (ok === undefined) {
        try {
          this.font.encodeText(ch);
          ok = true;
        } catch {
          ok = false;
        }
        this.cache.set(ch, ok);
      }
      if (ok) out += ch;
      else this.dropped = true;
    }
    return out;
  }

  /** 自动换行地画一段文字，返回后 y 停在段落下方 */
  para(runs: Run[], opts: { size?: number; indent?: number; hang?: number; lead?: number; center?: boolean } = {}) {
    const size = opts.size ?? SIZE;
    const lead = opts.lead ?? LEAD * (size / SIZE);
    const left = MX + (opts.indent ?? 0);
    const max = W - MX - left;

    type Word = { text: string; font: PDFFont; w: number; space: boolean };
    const words: Word[] = [];
    for (const r of runs) {
      const font = r.bold ? this.bold : this.font;
      const parts = this.clean(r.text).split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          if (words.length) words[words.length - 1].space = true;
          continue;
        }
        // 超长的词（网址等）按字符拆开
        let rest = part;
        while (font.widthOfTextAtSize(rest, size) > max && rest.length > 1) {
          let n = rest.length - 1;
          while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > max) n--;
          words.push({ text: rest.slice(0, n), font, w: font.widthOfTextAtSize(rest.slice(0, n), size), space: false });
          rest = rest.slice(n);
        }
        words.push({ text: rest, font, w: font.widthOfTextAtSize(rest, size), space: false });
      }
    }
    if (!words.length) return;

    const spaceW = this.font.widthOfTextAtSize(" ", size);
    let line: Word[] = [];
    let lineW = 0;
    let first = true;
    const flush = () => {
      if (!line.length) return;
      this.need(lead);
      const hang = first ? 0 : (opts.hang ?? 0);
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
    for (const w of words) {
      const hang = first ? 0 : (opts.hang ?? 0);
      const add = (line.length && line[line.length - 1].space ? spaceW : 0) + w.w;
      if (line.length && lineW + add > max - hang) flush();
      lineW += (line.length && line[line.length - 1].space ? spaceW : 0) + w.w;
      line.push(w);
    }
    flush();
  }

  gap(h: number) {
    this.y -= h;
  }
}

/** 把一行里的 Markdown 行内标记转成粗体 / 普通文字 */
function inline(s: string): Run[] {
  s = s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
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

/** 把 Markdown 排进 PDF（标题、段落、列表、引用、简单表格） */
function renderMarkdown(lay: Layout, md: string) {
  let buf: string[] = [];
  const flush = (gap = 8) => {
    if (!buf.length) return;
    lay.para(inline(buf.join(" ")));
    lay.gap(gap);
    buf = [];
  };
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      flush();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      const level = m[1].length;
      const size = level === 1 ? 15 : level === 2 ? 13 : 12;
      lay.need(size * 3);
      lay.gap(level === 1 ? 6 : 4);
      lay.para([{ text: m[2].replace(/\*\*/g, ""), bold: true }], { size, center: level === 1 });
      lay.gap(8);
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      lay.gap(8);
    } else if ((m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
      flush();
      const depth = Math.min(3, Math.floor(m[1].length / 2));
      const label = /\d/.test(m[2]) ? m[2].replace(")", ".") : "•";
      const indent = 14 + depth * 18;
      lay.para([{ text: `${label}  `, bold: false }, ...inline(m[3])], { indent, hang: 16 });
      lay.gap(4);
    } else if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-") && line.includes("|")) {
      // 表格的分隔行，跳过
    } else if (line.trim().startsWith("|")) {
      flush();
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      lay.para(inline(cells.join("     ")));
      lay.gap(2);
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

function truncate(font: PDFFont, s: string, size: number, max: number) {
  if (font.widthOfTextAtSize(s, size) <= max) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + "...", size) > max) s = s.slice(0, -1);
  return s + "...";
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
  const label = (i: PacketItem, fallback: string) => lay.clean(i.title).trim() || fallback;

  // 把一份材料并入，返回它占的页数
  async function append(item: PacketItem): Promise<number> {
    const before = out.getPageCount();
    if (item.format === "markdown") {
      lay.newPage();
      renderMarkdown(lay, item.text ?? "");
    } else if (item.format === "pdf") {
      const src = await PDFDocument.load(item.data!, { ignoreEncryption: true });
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));
    } else {
      const img = item.format === "png" ? await out.embedPng(item.data!) : await out.embedJpg(item.data!);
      const page = out.addPage([W, H]);
      const scale = Math.min((W - 2 * MX) / img.width, (H - TOP - BOTTOM) / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (W - w) / 2, y: BOTTOM + (H - TOP - BOTTOM - h) / 2, width: w, height: h });
    }
    return out.getPageCount() - before;
  }

  // 第 1 页先占位，等页码都确定了再填目录
  const cover = out.addPage([W, H]);

  const toc: { page: number; text: string }[] = [];
  for (const [i, item] of body.entries()) {
    const start = out.getPageCount() + 1;
    try {
      await append(item);
      toc.push({ page: start, text: label(item, `Document ${i + 1}`) + "." });
    } catch {
      warnings.push(`「${item.title}」无法并入，已跳过`);
    }
  }

  if (exhibits.length) {
    // List of Exhibits
    const listStart = out.getPageCount() + 1;
    lay.newPage();
    lay.para([{ text: "List of Exhibits", bold: true }], { size: 13 });
    lay.gap(10);
    exhibits.forEach((e, i) => {
      lay.para([{ text: `Exhibit ${i + 1}:  ${label(e, "")}`, bold: false }], { hang: 58 });
      lay.gap(2);
    });
    toc.push({ page: listStart, text: `Exhibits 1–${exhibits.length}.` });

    for (const [i, e] of exhibits.entries()) {
      // 分隔页：居中 "Exhibit N"，左下角是标题
      const sep = out.addPage([W, H]);
      const head = `Exhibit ${i + 1}`;
      sep.drawText(head, { x: (W - bold.widthOfTextAtSize(head, 18)) / 2, y: H / 2 + 20, size: 18, font: bold });
      sep.drawText(truncate(font, label(e, ""), 12, W - 2 * MX), { x: MX, y: BOTTOM + 12, size: 12, font });
      try {
        await append(e);
      } catch {
        warnings.push(`Exhibit ${i + 1}「${e.title}」的内容无法并入（文件可能已损坏或加密），只保留了分隔页`);
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
    const { width, height } = page.getSize();
    const foot = `Page ${i + 1} of ${total}`;
    page.drawText(header, { x: 36, y: height - 30, size: 8, font });
    page.drawText(foot, { x: width - 36 - font.widthOfTextAtSize(foot, 9), y: 24, size: 9, font });
  });

  const todo = opts.items.reduce((n, i) => n + (i.text?.match(/\[(待补充|待核实|TODO)/g)?.length ?? 0), 0);
  if (todo) {
    warnings.unshift(`文书里还有 ${todo} 处 [待补充] 或 [待核实] 没有填。它们会原样留在 PDF 里（其中的中文会被略去），递交前必须逐个补上`);
  }
  if (lay.dropped) warnings.push("文书或标题里有无法写入 PDF 的字符（例如中文），已被略去。递交给 USCIS 的材料应为英文");
  out.setTitle(`${opts.caseType} Petition - ${name}`);
  return { bytes: await out.save(), pages: total, warnings };
}
