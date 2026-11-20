export type Related = "" | "yes" | "no" | "unsure";

export type Degree = {
  id: string;
  type: string;
  major: string;
  university: string;
  year: string; // 已获学位：授予年份；在读：预计毕业时间
  related: Related;
};

export type Publication = { title: string; year: number | null; venue: string; citations: number };

export type Profile = {
  firstName: string;
  lastName: string;
  chineseName: string;
  field: string;
  degrees: Degree[];
  enrolled: Degree | null; // 在读的高等学位
  scholarUrl: string;
  papers: string;
  citations: string;
  hIndex: string;
  publications: Publication[];
  scholarSource: { name: string; fetchedAt: number; source?: string; more?: boolean } | null; // 一键获取的数据来源
  reviews: string;
  currentPosition: string;
  sameField: "" | "yes" | "no";
  fieldFrom: string;
  fieldTo: string;
  activeResearch: "" | "yes" | "no";
  nextPaper: string;
  updatedAt: number;
};

export const DEGREE_TYPES = ["学士（Bachelor）", "硕士（Master）", "博士（PhD）", "MD", "JD", "其他"];
export const REVIEW_OPTIONS = ["0", "1–5", "6–10", ">10"];

export const emptyProfile = (): Profile => ({
  firstName: "",
  lastName: "",
  chineseName: "",
  field: "",
  degrees: [],
  enrolled: null,
  scholarUrl: "",
  papers: "",
  citations: "",
  hIndex: "",
  publications: [],
  scholarSource: null,
  reviews: "",
  currentPosition: "",
  sameField: "",
  fieldFrom: "",
  fieldTo: "",
  activeResearch: "",
  nextPaper: "",
  updatedAt: 0,
});

const REL: Record<string, string> = { yes: "相关", no: "不相关", unsure: "不确定是否相关" };

/** 把档案转成发给模型的文字；没填任何内容时返回空串 */
export function profileToText(p: Profile): string {
  const lines: string[] = [];
  const add = (label: string, v: string) => {
    if (v.trim()) lines.push(`${label}：${v.trim()}`);
  };
  const deg = (d: Degree, yearLabel: string) =>
    [
      d.type,
      d.major,
      d.university,
      d.year && `${yearLabel} ${d.year}`,
      d.related && `与拟从事事业${REL[d.related]}`,
    ]
      .filter(Boolean)
      .join("，");

  add("英文姓名", `${p.firstName} ${p.lastName}`);
  add("中文姓名", p.chineseName);
  add("研究 / 工作领域", p.field);
  p.degrees.forEach((d) => add("已获学位", deg(d, "授予年份")));
  if (p.enrolled) add("在读学位", deg(p.enrolled, "预计毕业"));
  add("当前在美职位", p.currentPosition);
  add("学术主页链接", p.scholarUrl);
  add("论文数", p.papers);
  add("总引用数", p.citations);
  add("h-index", p.hIndex);
  if (p.publications.length) {
    lines.push(
      `引用最多的论文（数据来自 ${p.scholarSource?.source ?? "OpenAlex"}，共 ${p.publications.length} 篇，列出前 15 篇）：`,
    );
    p.publications.slice(0, 15).forEach((w, i) =>
      lines.push(`  ${i + 1}. ${w.title}${w.venue ? `，${w.venue}` : ""}${w.year ? `，${w.year}` : ""}，被引 ${w.citations} 次`),
    );
  }
  add("审稿次数", p.reviews);
  if (p.sameField === "yes") lines.push("未来工作：将继续在同一或相近领域工作");
  if (p.sameField === "no")
    lines.push(`未来工作：领域有变化，从「${p.fieldFrom || "未填"}」转到「${p.fieldTo || "未填"}」`);
  if (p.activeResearch === "yes")
    lines.push(`仍在持续做研究、发表论文${p.nextPaper ? `，预计下一篇发表时间 ${p.nextPaper}` : ""}`);
  if (p.activeResearch === "no") lines.push("已不再做研究或发表论文");
  return lines.join("\n");
}

/** 英文的论文与引用记录，可作为案件文档（Exhibit）使用；没有数据时返回空串 */
export function citationReport(p: Profile): string {
  if (!p.publications.length) return "";
  const name = `${p.firstName} ${p.lastName}`.trim() || "the Petitioner";
  const date = p.scholarSource
    ? new Date(p.scholarSource.fetchedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "";
  return [
    `# Publication and Citation Record of ${name}`,
    "",
    `**Total publications:** ${p.papers || p.publications.length}`,
    "",
    `**Total citations:** ${p.citations || "N/A"}`,
    "",
    `**h-index:** ${p.hIndex || "N/A"}`,
    "",
    `Source: ${p.scholarSource?.source === "Google Scholar" ? "Google Scholar (scholar.google.com)" : "OpenAlex (openalex.org)"}${date ? `, retrieved ${date}` : ""}. Publications are listed by number of citations.`,
    "",
    "## Publications",
    "",
    ...p.publications.map(
      (w, i) =>
        `${i + 1}. ${w.title}.${w.venue ? ` ${w.venue},` : ""}${w.year ? ` ${w.year}.` : ""} Cited by ${w.citations}.`,
    ),
    "",
  ].join("\n");
}
