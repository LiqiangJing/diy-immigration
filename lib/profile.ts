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

/** 从某一个学术数据来源获取到的一份记录；每个来源最多保留一份 */
export type ScholarRecord = {
  source: string; // Google Scholar / Semantic Scholar / OpenAlex
  url: string; // 这份数据对应的主页链接，可能为空
  name: string; // 来源里显示的作者名
  papers: string;
  citations: string;
  hIndex: string;
  publications: Publication[];
  fetchedAt: number;
  more?: boolean; // 来源主页上还有没列出来的论文
};

export type Profile = {
  firstName: string;
  lastName: string;
  chineseName: string;
  field: string;
  degrees: Degree[];
  enrolled: Degree | null; // 在读的高等学位
  scholarUrl: string; // Google Scholar 主页
  s2Url: string; // Semantic Scholar 主页
  // 下面三个数字是写文书时用的「主要数字」，可以手填，也可以取自某个来源
  papers: string;
  citations: string;
  hIndex: string;
  records: ScholarRecord[]; // 各来源获取到的记录
  primarySource: string; // 主要数字取自哪个来源；手填或没有记录时为空
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
  s2Url: "",
  records: [],
  primarySource: "",
  reviews: "",
  currentPosition: "",
  sameField: "",
  fieldFrom: "",
  fieldTo: "",
  activeResearch: "",
  nextPaper: "",
  updatedAt: 0,
});

/** 读出存档时补齐字段，并把旧版（只有一个来源）的数据转成新的多来源格式 */
export function normalizeProfile(raw: Record<string, any>): Profile {
  const p = { ...emptyProfile(), ...raw } as Profile & Record<string, any>;
  if (!Array.isArray(p.records)) p.records = [];
  if (!p.records.length && Array.isArray(raw.publications) && raw.publications.length) {
    const source = raw.scholarSource?.source ?? "OpenAlex";
    p.records = [
      {
        source,
        url: source === "Google Scholar" ? p.scholarUrl : "",
        name: raw.scholarSource?.name ?? "",
        papers: p.papers,
        citations: p.citations,
        hIndex: p.hIndex,
        publications: raw.publications,
        fetchedAt: raw.scholarSource?.fetchedAt ?? p.updatedAt,
        more: Boolean(raw.scholarSource?.more),
      },
    ];
    p.primarySource = source;
  }
  // 旧版只有一个链接框，填的如果是 Semantic Scholar 的链接就挪到它自己的框里
  if (!p.s2Url && /semanticscholar\.org/.test(p.scholarUrl)) {
    p.s2Url = p.scholarUrl;
    p.scholarUrl = "";
  }
  delete p.publications;
  delete p.scholarSource;
  return p;
}

/** 主要数字对应的那份记录；没有指定时取第一份 */
export const primaryRecord = (p: Profile): ScholarRecord | null =>
  p.records.find((r) => r.source === p.primarySource) ?? p.records[0] ?? null;

/** 把某份记录设为主要数字时要写进档案的字段 */
export const primaryPatch = (r: ScholarRecord) => ({
  primarySource: r.source,
  papers: r.papers,
  citations: r.citations,
  hIndex: r.hIndex,
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
  add("Google Scholar 主页", p.scholarUrl);
  add("Semantic Scholar 主页", p.s2Url);
  const main = primaryRecord(p);
  const from = main && p.primarySource ? `（取自 ${main.source}）` : "";
  add("论文数", p.papers && p.papers + from);
  add("总引用数", p.citations && p.citations + from);
  add("h-index", p.hIndex && p.hIndex + from);
  if (p.records.length > 1) {
    lines.push("各来源的数字（不同来源的统计口径不同，数字有出入是正常的；写文书时同一处只用同一个来源）：");
    p.records.forEach((r) =>
      lines.push(`  ${r.source}：论文 ${r.papers || "未知"}，总引用 ${r.citations || "未知"}，h-index ${r.hIndex || "未知"}`),
    );
  }
  if (main?.publications.length) {
    lines.push(`引用最多的论文（数据来自 ${main.source}，共 ${main.publications.length} 篇，列出前 15 篇）：`);
    main.publications.slice(0, 15).forEach((w, i) =>
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

const SOURCE_SITE: Record<string, string> = {
  "Google Scholar": "Google Scholar (scholar.google.com)",
  "Semantic Scholar": "Semantic Scholar (semanticscholar.org)",
  OpenAlex: "OpenAlex (openalex.org)",
};
const enDate = (t: number) =>
  new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

/** 英文的论文与引用记录，可作为案件文档（Exhibit）使用；没有数据时返回空串 */
export function citationReport(p: Profile): string {
  const main = primaryRecord(p);
  if (!main?.publications.length) return "";
  const name = `${p.firstName} ${p.lastName}`.trim() || "the Petitioner";
  const others = p.records.filter((r) => r !== main);
  return [
    `# Publication and Citation Record of ${name}`,
    "",
    `**Total publications:** ${main.papers || main.publications.length}`,
    "",
    `**Total citations:** ${main.citations || "N/A"}`,
    "",
    `**h-index:** ${main.hIndex || "N/A"}`,
    "",
    `Source: ${SOURCE_SITE[main.source] ?? main.source}, retrieved ${enDate(main.fetchedAt)}. Publications are listed by number of citations.`,
    "",
    ...(others.length
      ? [
          "## Citation Metrics by Source",
          "",
          "| Source | Publications | Citations | h-index | Retrieved |",
          "| --- | --- | --- | --- | --- |",
          ...[main, ...others].map(
            (r) =>
              `| ${r.source} | ${r.papers || "N/A"} | ${r.citations || "N/A"} | ${r.hIndex || "N/A"} | ${enDate(r.fetchedAt)} |`,
          ),
          "",
          "Indexing databases differ in coverage, so the figures differ between sources.",
          "",
        ]
      : []),
    "## Publications",
    "",
    ...main.publications.map(
      (w, i) =>
        `${i + 1}. ${w.title}.${w.venue ? ` ${w.venue},` : ""}${w.year ? ` ${w.year}.` : ""} Cited by ${w.citations}.`,
    ),
    "",
  ].join("\n");
}
