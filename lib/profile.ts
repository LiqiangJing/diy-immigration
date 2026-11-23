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

/** 别人引用这篇论文的方式 */
export const CITE_CATEGORIES = {
  praise: { zh: "高度评价", en: "Praised the work" },
  builds: { zh: "在此基础上扩展", en: "Built upon the work" },
  baseline: { zh: "作为 baseline / benchmark", en: "Used as a baseline or benchmark" },
  uses: { zh: "使用了方法或数据", en: "Used the method or data" },
  mention: { zh: "简单提及", en: "Mentioned" },
  critical: { zh: "指出不足", en: "Critical" },
} as const;
export type CiteCategory = keyof typeof CITE_CATEGORIES;

export type NotableCitation = {
  citingTitle: string;
  authors: string;
  venue: string;
  year: number | null;
  citations: number; // 引用方论文自己的被引次数
  url: string;
  topAuthor: string; // 引用方作者里的资深学者，没有则为空
  contexts: string[]; // 引用方论文里提到这篇论文的原句，来自 Semantic Scholar，未经改写
  category: CiteCategory;
  importance: "high" | "medium" | "low";
  reason: string;
  selected?: boolean; // 用户手动勾选 / 取消；未设置时 high 默认选中
};

/** 一篇论文的引用分析结果 */
export type CitationAnalysis = {
  title: string;
  year: number | null;
  paperUrl: string;
  analyzedAt: number;
  total: number; // Semantic Scholar 里的引用总数
  scanned?: number; // 实际检查了多少条（引用特别多时只看前几千条）
  selfCitations: number;
  withContext: number; // 能拿到引用原文的独立引用数
  analyzed: number; // 实际交给模型判断的条数
  items: NotableCitation[];
};

/** 贡献总结（Summary of Contributions）：NIW 和 EB-1A 共用的事实底稿 */
/** 引用地图：引用方作者单位的国家和机构分布（OpenAlex） */
export type CiteMap = {
  fetchedAt: number;
  papers: number; // 统计了申请人的几篇论文
  citing: number; // 引用这些论文的文章总数
  selfExcluded: boolean; // 是否排除了申请人本人参与的文章
  countries: { code: string; name: string; count: number }[];
  institutions: { name: string; count: number }[];
};

export type SocProject = {
  id: string;
  title: string;
  start: string;
  end: string;
  outputs: string;
  funding: string;
  summary: string;
  impact: string;
};
export type SocReview = { id: string; venue: string; count: string; invited: "" | "yes" | "no" | "other" };
export type Soc = {
  subareas: string;
  importance: string;
  projects: SocProject[];
  awards: string;
  reviews: SocReview[];
  openSource: string;
  media: string;
  other: string;
};
export const emptySoc = (): Soc => ({
  subareas: "",
  importance: "",
  projects: [],
  awards: "",
  reviews: [],
  openSource: "",
  media: "",
  other: "",
});
export const socFilled = (s: Soc | undefined) =>
  Boolean(s && (s.importance.trim() || s.projects.some((x) => x.title.trim() || x.summary.trim())));

/**
 * 拟从事事业（Proposed Endeavor）：NIW 的核心，写的是到美国之后打算做什么。
 * 「为什么重要」那一段和贡献总结里的 importance 是同一份内容，不在这里另存。
 */
export type Endeavor = {
  statement: string; // 一两句话说明要做的事
  plan: string; // 未来三到五年的具体计划
  role: string; // 在哪里、以什么身份做
  progress: string; // 已有的进展和外部支持
  waiver: string; // 为什么免掉工作邀请和劳工证对美国有利
};
export const ENDEAVOR_KEYS = ["statement", "plan", "role", "progress", "waiver"] as const;
export const emptyEndeavor = (): Endeavor => ({ statement: "", plan: "", role: "", progress: "", waiver: "" });
export const endeavorFilled = (e: Endeavor | undefined) => Boolean(e && (e.statement.trim() || e.plan.trim()));

export const isSelected = (c: NotableCitation) => c.selected ?? c.importance === "high";

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
  analyses: CitationAnalysis[]; // 各篇论文的重要引用分析
  soc: Soc; // 贡献总结
  endeavor: Endeavor; // 拟从事事业（NIW）
  citeMap?: CiteMap; // 引用地图
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
  analyses: [],
  soc: emptySoc(),
  endeavor: emptyEndeavor(),
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
  if (!Array.isArray(p.analyses)) p.analyses = [];
  p.soc = { ...emptySoc(), ...(raw.soc && typeof raw.soc === "object" ? raw.soc : {}) };
  if (!Array.isArray(p.soc.projects)) p.soc.projects = [];
  if (!Array.isArray(p.soc.reviews)) p.soc.reviews = [];
  const e = raw.endeavor && typeof raw.endeavor === "object" ? raw.endeavor : {};
  p.endeavor = emptyEndeavor();
  for (const k of ENDEAVOR_KEYS) if (typeof e[k] === "string") p.endeavor[k] = e[k];
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

const ENDEAVOR_ZH: Record<(typeof ENDEAVOR_KEYS)[number], string> = {
  statement: "要做的事",
  plan: "未来三到五年的计划",
  role: "在哪里、以什么身份做",
  progress: "已有的进展和外部支持",
  waiver: "为什么免掉工作邀请和劳工证对美国有利",
};

/**
 * 把档案转成发给模型的文字；没填任何内容时返回空串。
 * fullEndeavor：把拟从事事业全文带上（在 NIW 案件里聊天、写文书时用）；否则只带那一句话。
 */
export function profileToText(p: Profile, fullEndeavor = false): string {
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
  add("当前职位", p.currentPosition);
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
  const picked = p.analyses.reduce((n, a) => n + a.items.filter(isSelected).length, 0);
  if (p.analyses.length) {
    lines.push(
      `重要引用：已分析 ${p.analyses.length} 篇论文的引用，选出 ${picked} 条。具体的引用原文在案件的「重要引用」文档里，写申请信时请让用户引用那份文档，不要凭空写引用评价。`,
    );
  }
  add("审稿次数", p.reviews);
  // 贡献总结只放概要，全文在案件的「Summary of Contributions」文档里，免得每次对话都带上一大段
  const soc = p.soc;
  if (socFilled(soc)) {
    const cut = (s: string, n: number) => (s.trim().length > n ? `${s.trim().slice(0, n)}…` : s.trim());
    lines.push("贡献总结（概要；完整内容在案件的「Summary of Contributions」文档里，写申请信和推荐信时请让用户引用那份文档）：");
    if (soc.subareas.trim()) lines.push(`  细分方向：${soc.subareas.trim().split("\n").filter(Boolean).join("；")}`);
    soc.projects
      .filter((x) => x.title.trim())
      .forEach((x, i) => lines.push(`  项目 ${i + 1}：${x.title.trim()}${x.summary.trim() ? `。${cut(x.summary, 220)}` : ""}`));
    const n = soc.reviews.reduce((t, r) => t + (Number(r.count) || 0), 0);
    if (n) lines.push(`  审稿：共 ${n} 次，涉及 ${soc.reviews.filter((r) => r.venue.trim()).length} 个期刊或会议`);
    if (soc.awards.trim()) lines.push(`  奖项：${cut(soc.awards.replace(/\n+/g, "；"), 300)}`);
    if (soc.media.trim()) lines.push("  有媒体报道");
    if (soc.openSource.trim()) lines.push("  有开源贡献");
  }
  const e = p.endeavor;
  if (endeavorFilled(e)) {
    const cut = (s: string, n: number) => (s.trim().length > n ? `${s.trim().slice(0, n)}…` : s.trim());
    if (fullEndeavor) {
      lines.push(
        "拟从事事业（Proposed Endeavor；用户在「我的档案」里填的要点。写 NIW 文书时以它为准，已经填了的内容不要让用户再说一遍，只追问缺的；「要做的事」那句话定稿后在各份文书里原样使用，不要改写）：",
      );
      for (const k of ENDEAVOR_KEYS) if (e[k].trim()) lines.push(`  【${ENDEAVOR_ZH[k]}】${cut(e[k], 2500)}`);
      if (soc.importance.trim()) lines.push(`  【为什么重要（实质价值和国家重要性）】${cut(soc.importance, 2500)}`);
    } else if (e.statement.trim()) {
      lines.push(`拟从事事业（NIW 用；完整内容在「我的档案」的「拟从事事业」里）：${cut(e.statement, 500)}`);
    } else {
      lines.push("拟从事事业（NIW 用）：用户在档案里写了计划，但还没有定下一句话的说法");
    }
  }
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

/** 英文的重要引用清单，可作为案件文档给 Petition Letter 引用；没有选中的引用时返回空串 */
export function notableReport(p: Profile): string {
  const papers = p.analyses
    .map((a) => ({ a, items: a.items.filter(isSelected) }))
    .filter((x) => x.items.length);
  if (!papers.length) return "";
  const name = `${p.firstName} ${p.lastName}`.trim() || "the Petitioner";
  const out = [
    `# Notable Citations of ${name}'s Work`,
    "",
    "The quotations below are taken verbatim from the citing papers, as indexed by Semantic Scholar (semanticscholar.org). Verify each quotation against the published paper before using it in the petition.",
    "",
  ];
  for (const { a, items } of papers) {
    out.push(`## ${a.title}${a.year ? ` (${a.year})` : ""}`, "");
    out.push(
      `${a.total} citations indexed by Semantic Scholar. ${items.length} notable independent citations (no shared authors with the cited paper) are listed.`,
      "",
    );
    items.forEach((c, i) => {
      out.push(
        `### ${i + 1}. ${c.citingTitle}`,
        "",
        `${[c.authors, c.venue, c.year].filter(Boolean).join(". ")}. Cited by ${c.citations}.${c.url ? ` ${c.url}` : ""}`,
        "",
        `**How it cites the work:** ${CITE_CATEGORIES[c.category].en}`,
        "",
        ...c.contexts.flatMap((q) => [`> ${q}`, ""]),
      );
    });
  }
  return out.join("\n");
}

/** 把贡献总结整理成一份文档，放进案件里供写申请信和推荐信时引用；没填时返回空串 */
export function socReport(p: Profile): string {
  const soc = p.soc;
  if (!socFilled(soc)) return "";
  const name = `${p.firstName} ${p.lastName}`.trim() || "the Petitioner";
  const out: string[] = [`# Summary of Contributions — ${name}`, ""];
  const block = (title: string, body: string) => {
    if (body.trim()) out.push(`**${title}**`, "", body.trim(), "");
  };
  out.push("## I. Background", "");
  block("Main field", p.field);
  block("Sub-areas / specializations", soc.subareas);
  block("Importance, benefits, and applications", soc.importance);
  if (soc.projects.length) out.push("## II. Top Contributions", "");
  soc.projects.forEach((x, i) => {
    out.push(`### Project ${i + 1}: ${x.title.trim() || "(untitled)"}`, "");
    if (x.start.trim() || x.end.trim()) out.push(`**Dates:** ${x.start.trim() || "?"} – ${x.end.trim() || "?"}`, "");
    block("Outputs", x.outputs);
    block("Funding", x.funding);
    block("Summary of the work", x.summary);
    block("Significance and impact", x.impact);
  });
  out.push("## III. Notable Accomplishments", "");
  block("Awards", soc.awards);
  const reviews = soc.reviews.filter((r) => r.venue.trim());
  if (reviews.length) {
    const total = reviews.reduce((t, r) => t + (Number(r.count) || 0), 0);
    const inv = { yes: "Yes", no: "No", other: "Other", "": "" } as const;
    out.push(
      `**Peer review (${total} reviews in total)**`,
      "",
      "| Journal / conference | Reviews | Formal invitation |",
      "| --- | --- | --- |",
      ...reviews.map((r) => `| ${r.venue.trim()} | ${r.count.trim()} | ${inv[r.invited]} |`),
      "",
    );
  }
  block("Open-source contributions", soc.openSource);
  block("Media coverage", soc.media);
  block("Other accomplishments", soc.other);
  return out.join("\n");
}

/** 把拟从事事业整理成一份文档，放进 NIW 案件里；AI 可以在它的基础上写成正式的陈述。没填时返回空串 */
export function endeavorReport(p: Profile): string {
  const e = p.endeavor;
  if (!endeavorFilled(e)) return "";
  const name = `${p.firstName} ${p.lastName}`.trim() || "the Petitioner";
  const out: string[] = [`# Proposed Endeavor of ${name}`, ""];
  const section = (title: string, body: string) => {
    if (body.trim()) out.push(`## ${title}`, "", body.trim(), "");
  };
  section("The Proposed Endeavor", e.statement);
  section("Substantial Merit and National Importance", p.soc.importance);
  section("Plan for the Next Three to Five Years", e.plan);
  section("Position and Capacity", e.role);
  section("Progress to Date and Outside Support", e.progress);
  section("Why Waiving the Job Offer and Labor Certification Benefits the United States", e.waiver);
  return out.join("\n");
}
