/**
 * 聊天里的「操作」：模型在回复中输出 <action>{JSON}</action>，页面把它变成一张确认卡片，
 * 用户点「应用」后才真的生效。模型的输出不可信，所以这里对每个字段做白名单和长度限制。
 *
 * 支持的操作：
 *   profile     「我的档案」的基本资料：填、清空，学位的增删改
 *   soc         「贡献总结」：填、追加、清空，项目和审稿记录的增删改
 *   endeavor    「拟从事事业」（NIW）：填、追加、清空
 *   case        新建案件
 *   caseEdit    改案件：改名、EB-2 走哪条路、主张哪些标准、材料清单打勾
 *   caseDelete  删除案件（连同里面的文档和文件，不能撤销）
 *   saveFile    把这次对话里用户上传的文件存进案件的文件里（案件文件打包时默认就是 Exhibit）
 *   caseFile    案件里的文件：改名、删除
 *   doc         在案件里新建文档（内容由模型给出，或者用档案里的内容生成）
 *   docEdit     文档：改名、删除
 *   chat        会话：新建、给当前会话改名、把当前会话关联到案件、删除别的会话
 *   go          带用户去某一页（聊天里做不了的事，比如获取学术数据、打包下载、充值）
 *
 * 除了删除案件 / 文件 / 文档 / 会话之外，应用过的卡片都可以撤销（见 lib/undo.ts）。
 */

import { DEGREE_TYPES, ENDEAVOR_KEYS, REVIEW_OPTIONS, citationReport, emptyEndeavor, emptySoc, endeavorReport, notableReport, socReport } from "./profile";
import type { Degree, Endeavor, Profile, Related, Soc, SocProject, SocReview } from "./profile";
import { CHECKLISTS } from "./checklists";
import { EB1A_CRITERIA, EXCEPTIONAL_CRITERIA } from "./claims";
import { DOC_KINDS, REPORT_TITLE } from "./docKinds";
import type { Attachment, CaseType, DocFile, ImmigrationCase } from "./types";
import { uid } from "./types";
import type { Change } from "./undo";

/* ---------- 字段白名单 ---------- */

const PROFILE_TEXT = {
  firstName: "名（First name）",
  lastName: "姓（Last name）",
  chineseName: "中文姓名",
  field: "主要领域",
  currentPosition: "当前职位",
  scholarUrl: "Google Scholar 主页",
  s2Url: "Semantic Scholar 主页",
  fieldFrom: "原领域",
  fieldTo: "新领域",
  nextPaper: "预计下一篇论文发表时间",
  papers: "论文数（手动填写）",
  citations: "总引用数（手动填写）",
  hIndex: "h-index（手动填写）",
} as const;
/** 手动填的三个数字：一改就不再跟着某个数据来源走 */
const NUMBERS = ["papers", "citations", "hIndex"];
const PROFILE_CHOICE = {
  reviews: { label: "审稿次数", options: REVIEW_OPTIONS as readonly string[] },
  sameField: { label: "未来是否仍在同一领域", options: ["yes", "no"] },
  activeResearch: { label: "是否仍在做研究、发表论文", options: ["yes", "no"] },
} as const;
const DEGREE_TEXT = { type: "学位类型", major: "专业", university: "学校", year: "年份", related: "与拟从事事业是否相关" } as const;
const SOC_TEXT = {
  subareas: "细分方向",
  importance: "工作的重要性、益处和应用",
  awards: "奖项",
  openSource: "开源贡献",
  media: "媒体报道",
  other: "其他成就",
} as const;
const PROJECT_TEXT = {
  title: "项目名称",
  start: "开始时间",
  end: "结束时间",
  outputs: "成果",
  funding: "经费来源",
  summary: "工作概述",
  impact: "意义和影响",
} as const;
const ENDEAVOR_TEXT: Record<(typeof ENDEAVOR_KEYS)[number], string> = {
  statement: "要做的事（一两句话）",
  plan: "未来三到五年的计划",
  role: "在哪里、以什么身份做",
  progress: "已有的进展和外部支持",
  waiver: "为什么豁免对美国有利",
};
const YESNO: Record<string, string> = { yes: "是", no: "否", unsure: "不确定", other: "其他" };
const EB2_TEXT = { advanced: "高等学位（advanced degree）", exceptional: "特殊能力（exceptional ability）" } as const;
const REPORTS = {
  soc: { kind: "Summary of Contributions", make: socReport, where: "贡献总结" },
  endeavor: { kind: "Proposed Endeavor 陈述", make: endeavorReport, where: "拟从事事业" },
  citations: { kind: "论文与引用记录", make: citationReport, where: "学术记录" },
  notable: { kind: "重要引用", make: notableReport, where: "重要引用分析" },
} as const;
const GO = {
  "profile.basic": "我的档案 · 基本资料",
  "profile.scholar": "我的档案 · 学术记录与引用",
  "profile.soc": "我的档案 · 贡献总结",
  "profile.endeavor": "我的档案 · 拟从事事业",
  cases: "全部案件",
  "case.guide": "申请向导",
  "case.docs": "文档",
  "case.files": "文件",
  "case.checklist": "材料清单",
  "case.pack": "打包下载",
  doc: "文档",
  account: "账户与充值",
} as const;
const ALL_CLAIMS = [...EB1A_CRITERIA, ...EXCEPTIONAL_CRITERIA];
const itemsOf = (type: CaseType) => CHECKLISTS[type].flatMap((g) => g.items);
const ALL_ITEMS = [...itemsOf("NIW"), ...itemsOf("EB-1A")];

type ProfileTextKey = keyof typeof PROFILE_TEXT;
type ProfileChoiceKey = keyof typeof PROFILE_CHOICE;
type ProfileKey = ProfileTextKey | ProfileChoiceKey;
type DegreeKey = keyof typeof DEGREE_TEXT;
type SocTextKey = keyof typeof SOC_TEXT;
type ProjectKey = keyof typeof PROJECT_TEXT;
type EndeavorKey = keyof typeof ENDEAVOR_TEXT;
type DegreeIn = Omit<Degree, "id">;
type ReportKey = keyof typeof REPORTS;
type GoKey = keyof typeof GO;

/** 带问号的字段是后来加的：以前存下来的卡片里没有，用的时候要当作空的 */
export type ChatAction =
  | {
      type: "profile";
      set: Partial<Record<ProfileKey, string>>;
      addDegrees: DegreeIn[];
      enrolled?: DegreeIn;
      clear?: (ProfileKey | "enrolled" | "degrees")[];
      updateDegrees?: { match: string; set: Partial<DegreeIn> }[];
      removeDegrees?: string[];
    }
  | {
      type: "soc";
      set: Partial<Record<SocTextKey, string>>;
      append: Partial<Record<SocTextKey, string>>;
      addProjects: Omit<SocProject, "id">[];
      updateProjects: { match: string; set: Partial<Record<ProjectKey, string>>; clear?: ProjectKey[] }[];
      addReviews: Omit<SocReview, "id">[];
      clear?: (SocTextKey | "projects" | "reviews")[];
      removeProjects?: string[];
      removeReviews?: string[];
    }
  | { type: "endeavor"; set: Partial<Record<EndeavorKey, string>>; append: Partial<Record<EndeavorKey, string>>; clear?: EndeavorKey[] }
  | { type: "case"; name: string; caseType: CaseType }
  | {
      type: "caseEdit";
      case: string;
      rename: string;
      eb2: "" | "advanced" | "exceptional";
      addClaims: string[];
      removeClaims: string[];
      check: string[];
      uncheck: string[];
    }
  | { type: "caseDelete"; case: string }
  | { type: "saveFile"; file: string; case: string; title: string }
  | { type: "caseFile"; case: string; file: string; rename: string; remove: boolean }
  | { type: "doc"; case: string; title: string; kind: string; content: string; from: "" | ReportKey }
  | { type: "docEdit"; case: string; doc: string; rename: string; remove: boolean }
  | { type: "chat"; op: "new" | "rename" | "link" | "delete"; title: string; case: string; match: string }
  | { type: "go"; to: GoKey; case: string; doc: string };

/**
 * 存在聊天消息上的操作及其状态。place 是应用时实际改到的那一页，之后点「去看」就去那里；
 * undo 是应用时改了哪些地方，点「撤销」时按它改回去（删除类的操作没有）
 */
export type ActionItem = {
  id: string;
  action: ChatAction;
  status: "pending" | "applied" | "skipped";
  note?: string;
  place?: Place;
  undo?: Change[];
  /** 应用那一刻卡片上显示的内容：应用之后数据变了，再按现在的数据去描述就对不上了 */
  shown?: { title: string; rows: Row[] };
};

/* ---------- 解析 ---------- */

const BLOCK = /<action>([\s\S]*?)<\/action>/g;

/** 去掉回复里的操作标签，只留给用户看的文字；回复还在流式输出时也能用 */
export function stripActions(raw: string): string {
  let s = raw.replace(BLOCK, "");
  const open = s.indexOf("<action>");
  if (open !== -1) s = s.slice(0, open);
  s = s.replace(/<(a(c(t(i(o(n)?)?)?)?)?)?$/, "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const arr = (v: unknown, max: number): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === "object").slice(0, max) as Record<string, unknown>[]) : [];
/** 一串文字（去掉空的和重复的） */
const strs = (v: unknown, max: number, len = 300): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => str(x, len)).filter(Boolean))].slice(0, max) : [];
/** 一串字段名，只留认识的 */
const keysIn = <K extends string>(v: unknown, allowed: readonly K[]): K[] => strs(v, 40, 40).filter((k): k is K => (allowed as readonly string[]).includes(k));
const yes = (v: unknown) => v === true || v === "true" || v === "yes";

function pickText<K extends string>(raw: unknown, keys: Record<K, string>, max: number): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of Object.keys(keys) as K[]) {
    const v = str((raw as Record<string, unknown>)[k], max);
    if (v) out[k] = v;
  }
  return out;
}

// 模型可能只写 PhD / 博士，对到下拉框里的选项上。先认 JD、MD：它们的全称里也有 Doctor，不能当成 PhD
const degreeType = (t: string) =>
  DEGREE_TYPES.find((d) => d === t) ??
  (/juris|\bj\.?d\.?\b|法律博士|法学博士（jd）/i.test(t) ? "JD" : undefined) ??
  (/doctor of medicine|\bm\.?d\.?\b|医学博士/i.test(t) ? "MD" : undefined) ??
  DEGREE_TYPES.find((d) => /phd|ph\.d|博士|doctor/i.test(t) && d.includes("PhD")) ??
  DEGREE_TYPES.find((d) => /master|硕士|\bm\.?(s|a|sc|eng|phil|ed)\.?\b|\bmba\b|\bllm\b/i.test(t) && d.includes("Master")) ??
  DEGREE_TYPES.find((d) => /bachelor|学士|本科|\bb\.?(s|a|sc|eng)\.?\b|\bllb\b/i.test(t) && d.includes("Bachelor")) ??
  DEGREE_TYPES.find((d) => d === t.toUpperCase()) ??
  "其他";
const relatedOf = (v: unknown) => (["yes", "no", "unsure"].includes(str(v, 10)) ? str(v, 10) : "") as Related;

function degree(raw: Record<string, unknown>): DegreeIn | null {
  const d: DegreeIn = {
    type: degreeType(str(raw.type, 60)),
    major: str(raw.major, 200),
    university: str(raw.university, 200),
    year: str(raw.year, 40),
    related: relatedOf(raw.related),
  };
  return d.major || d.university ? d : null;
}
/** 只改学位的某几项 */
function degreePatch(raw: unknown): Partial<DegreeIn> {
  const out: Partial<DegreeIn> = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (str(r.type, 60)) out.type = degreeType(str(r.type, 60));
  for (const k of ["major", "university", "year"] as const) if (str(r[k], 200)) out[k] = str(r[k], 200);
  if (relatedOf(r.related)) out.related = relatedOf(r.related);
  return out;
}

/** 模型写的可能是编号，也可能是中文名称：都对到编号上，不认识的丢掉 */
const idsOf = (v: unknown, list: { id: string; label: string }[]) =>
  [...new Set(strs(v, 30, 120).map((s) => list.find((x) => x.id === s || x.label === s)?.id).filter((x): x is string => Boolean(x)))];

function one(raw: unknown): ChatAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.type === "profile") {
    const set: Partial<Record<ProfileKey, string>> = pickText(a.set, PROFILE_TEXT, 300);
    for (const k of Object.keys(PROFILE_CHOICE) as ProfileChoiceKey[]) {
      const v = str((a.set as Record<string, unknown> | undefined)?.[k], 20);
      if ((PROFILE_CHOICE[k].options as readonly string[]).includes(v)) set[k] = v;
    }
    const addDegrees = arr(a.addDegrees, 6).map(degree).filter((d): d is DegreeIn => d !== null);
    const enrolled = a.enrolled && typeof a.enrolled === "object" ? (degree(a.enrolled as Record<string, unknown>) ?? undefined) : undefined;
    const clear = keysIn(a.clear, [...(Object.keys(PROFILE_TEXT) as ProfileKey[]), ...(Object.keys(PROFILE_CHOICE) as ProfileKey[]), "enrolled", "degrees"] as const);
    const updateDegrees = arr(a.updateDegrees, 6)
      .map((d) => ({ match: str(d.match, 300), set: degreePatch(d.set) }))
      .filter((d) => d.match && Object.keys(d.set).length);
    const removeDegrees = strs(a.removeDegrees, 6);
    if (!Object.keys(set).length && !addDegrees.length && !enrolled && !clear.length && !updateDegrees.length && !removeDegrees.length) return null;
    return { type: "profile", set, addDegrees, enrolled, clear, updateDegrees, removeDegrees };
  }
  if (a.type === "soc") {
    const set = pickText(a.set, SOC_TEXT, 8000);
    const append = pickText(a.append, SOC_TEXT, 8000);
    const addProjects = arr(a.addProjects, 5)
      .map((p) => ({ title: "", start: "", end: "", outputs: "", funding: "", summary: "", impact: "", ...pickText(p, PROJECT_TEXT, 6000) }))
      .filter((p) => p.title || p.summary);
    const updateProjects = arr(a.updateProjects, 5)
      .map((p) => ({ match: str(p.match, 300), set: pickText(p.set, PROJECT_TEXT, 6000), clear: keysIn(p.clear, Object.keys(PROJECT_TEXT) as ProjectKey[]) }))
      .filter((p) => p.match && (Object.keys(p.set).length || p.clear.length));
    const addReviews = arr(a.addReviews, 60)
      .map((r) => {
        const invited = str(r.invited, 10);
        return {
          venue: str(r.venue, 200),
          count: str(r.count, 10).replace(/\D/g, ""),
          invited: (["yes", "no", "other"].includes(invited) ? invited : "") as SocReview["invited"],
        };
      })
      .filter((r) => r.venue);
    const clear = keysIn(a.clear, [...(Object.keys(SOC_TEXT) as SocTextKey[]), "projects", "reviews"] as const);
    const removeProjects = strs(a.removeProjects, 10);
    const removeReviews = strs(a.removeReviews, 60);
    if (
      !Object.keys(set).length && !Object.keys(append).length && !addProjects.length && !updateProjects.length && !addReviews.length &&
      !clear.length && !removeProjects.length && !removeReviews.length
    )
      return null;
    return { type: "soc", set, append, addProjects, updateProjects, addReviews, clear, removeProjects, removeReviews };
  }
  if (a.type === "endeavor") {
    const set = pickText(a.set, ENDEAVOR_TEXT, 8000);
    const append = pickText(a.append, ENDEAVOR_TEXT, 8000);
    const clear = keysIn(a.clear, ENDEAVOR_KEYS);
    if (!Object.keys(set).length && !Object.keys(append).length && !clear.length) return null;
    return { type: "endeavor", set, append, clear };
  }
  if (a.type === "case") {
    const caseType: CaseType = a.caseType === "EB-1A" ? "EB-1A" : "NIW";
    return { type: "case", name: str(a.name, 60) || `我的 ${caseType} 案件`, caseType };
  }
  if (a.type === "caseEdit") {
    const eb2 = a.eb2 === "advanced" || a.eb2 === "exceptional" ? a.eb2 : "";
    const e = {
      type: "caseEdit" as const,
      case: str(a.case, 60),
      rename: str(a.rename, 60),
      eb2: eb2 as "" | "advanced" | "exceptional",
      addClaims: idsOf(a.addClaims, ALL_CLAIMS),
      removeClaims: idsOf(a.removeClaims, ALL_CLAIMS),
      check: idsOf(a.check, ALL_ITEMS),
      uncheck: idsOf(a.uncheck, ALL_ITEMS),
    };
    return e.rename || e.eb2 || e.addClaims.length || e.removeClaims.length || e.check.length || e.uncheck.length ? e : null;
  }
  if (a.type === "caseDelete") {
    const name = str(a.case, 60);
    return name ? { type: "caseDelete", case: name } : null;
  }
  if (a.type === "saveFile") {
    const file = str(a.file, 300);
    return file ? { type: "saveFile", file, case: str(a.case, 60), title: str(a.title, 200) } : null;
  }
  if (a.type === "caseFile") {
    const file = str(a.file, 300);
    const rename = str(a.rename, 150).replace(/[\\/:*?"<>|]/g, " ").trim();
    const remove = yes(a.remove);
    return file && (rename || remove) ? { type: "caseFile", case: str(a.case, 60), file, rename: remove ? "" : rename, remove } : null;
  }
  if (a.type === "doc") {
    const from = (Object.keys(REPORTS) as ReportKey[]).find((k) => k === a.from) ?? "";
    const content = typeof a.content === "string" ? a.content.trim().slice(0, 30000) : "";
    const kind = from ? REPORTS[from].kind : (DOC_KINDS.find((k) => k.kind === str(a.kind, 60))?.kind ?? "其他文档");
    if (!from && !content) return null;
    return { type: "doc", case: str(a.case, 60), title: str(a.title, 120), kind, content: from ? "" : content, from };
  }
  if (a.type === "docEdit") {
    const doc = str(a.doc, 200);
    const rename = str(a.rename, 120);
    const remove = yes(a.remove);
    return doc && (rename || remove) ? { type: "docEdit", case: str(a.case, 60), doc, rename: remove ? "" : rename, remove } : null;
  }
  if (a.type === "chat") {
    const op = (["new", "rename", "link", "delete"] as const).find((o) => o === a.op);
    if (!op) return null;
    const c = { type: "chat" as const, op, title: str(a.title, 40), case: str(a.case, 60), match: str(a.match, 60) };
    if ((op === "rename" && !c.title) || (op === "delete" && !c.match)) return null;
    return c;
  }
  if (a.type === "go") {
    const to = (Object.keys(GO) as GoKey[]).find((k) => k === a.to);
    return to ? { type: "go", to, case: str(a.case, 60), doc: str(a.doc, 200) } : null;
  }
  return null;
}

/**
 * 模型写的 JSON 里，字符串中间常常直接换行（多行的计划、成果列表），严格的 JSON 不允许。
 * 把字符串里面的换行、制表符换成转义写法再解析。
 */
function repairJson(s: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === "\\") {
        out += ch + (s[i + 1] ?? "");
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      out += ch === "\n" ? "\\n" : ch === "\r" ? "" : ch === "\t" ? "\\t" : ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

/** 从完整的回复里取出所有格式正确的操作。failed 是写了标签但内容看不懂的个数，页面会告诉用户 */
export function readActions(raw: string): { actions: ChatAction[]; failed: number } {
  const actions: ChatAction[] = [];
  let failed = 0;
  for (const m of raw.matchAll(BLOCK)) {
    const text = m[1].trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      try {
        parsed = JSON.parse(repairJson(text));
      } catch {
        failed++;
        continue;
      }
    }
    const a = one(parsed);
    if (a) actions.push(a);
    else failed++;
  }
  // 标签开了头却没有结束（回复被截断）也算一个没读懂的
  if (raw.replace(BLOCK, "").includes("<action>")) failed++;
  return { actions: actions.slice(0, 8), failed };
}

export const parseActions = (raw: string): ChatAction[] => readActions(raw).actions;

/* ---------- 定位 ---------- */

/** danger：这一行是要清空或删掉的内容 */
export type Row = { label: string; value: string; old?: string; danger?: boolean };
export type World = {
  profile: Profile;
  cases: ImmigrationCase[];
  docs?: DocFile[];
  linkedCaseId?: string | null;
  attachments: Attachment[];
  /** 同一条回复里还没应用的「新建案件」卡片要建的案件名 */
  creating?: string[];
  /** 现在这个会话，和别的会话 */
  conv?: { id: string; title: string; caseId?: string } | null;
  convs?: { id: string; title: string }[];
};

const cut = (s: string, n: number) => (s.trim().length > n ? `${s.trim().slice(0, n)}…` : s.trim());
const lower = (s: string) => s.trim().toLowerCase();
const degreeText = (d: DegreeIn) => [d.type, d.major, d.university, d.year].filter(Boolean).join("，");

/** 「项目 1」「Project 2」「第 3 个」「#1」这类按顺序指的写法 → 第几个（从 0 数）；不是这种写法返回 -1 */
function numberOf(match: string): number {
  const s = match.trim();
  const m =
    s.match(/^(?:第\s*)?(?:项目|project|学位|degree)?\s*#?\s*(\d{1,2})\s*(?:个|项)?\s*(?:项目|学位)?$/i) ??
    s.match(/^(?:项目|project|学位|degree)\s*#?\s*(\d{1,2})\s*[:：「"“(（-]/i);
  return m ? Number(m[1]) - 1 : -1;
}
const isBlankProject = (p: Omit<SocProject, "id">) => (Object.keys(PROJECT_TEXT) as ProjectKey[]).every((k) => !p[k].trim());
const projectName = (p: SocProject | undefined, i: number) => `项目 ${i + 1}${p?.title.trim() ? `「${p.title.trim()}」` : "（未命名）"}`;

/** 模型指的是哪个项目：先看编号，再看名称；没有名称的项目只能用编号或「未命名」来指 */
function projectAt(list: SocProject[], match: string): number {
  const n = numberOf(match);
  if (n >= 0) return n < list.length ? n : -1;
  const m = lower(match);
  if (!m) return -1;
  if (/^(未命名|untitled|unnamed)/.test(m)) {
    const blank = list.map((p, i) => (p.title.trim() ? -1 : i)).filter((i) => i >= 0);
    return blank.length === 1 ? blank[0] : -1;
  }
  const exact = list.findIndex((p) => lower(p.title) === m);
  if (exact !== -1) return exact;
  return list.findIndex((p) => {
    const t = lower(p.title);
    return Boolean(t) && (t.includes(m) || m.includes(t));
  });
}
function degreeAt(list: Degree[], match: string): number {
  const n = numberOf(match);
  if (n >= 0) return n < list.length ? n : -1;
  const m = lower(match);
  if (!m) return -1;
  const hits = list.map((d, i) => (lower(degreeText(d)).includes(m) || [d.type, d.major, d.university].some((x) => x.trim() && m.includes(lower(x))) ? i : -1)).filter((i) => i >= 0);
  return hits.length ? hits[0] : -1;
}
const reviewAt = (list: SocReview[], match: string) => {
  const m = lower(match);
  const exact = list.findIndex((r) => lower(r.venue) === m);
  return exact !== -1 || !m ? exact : list.findIndex((r) => Boolean(r.venue.trim()) && (lower(r.venue).includes(m) || m.includes(lower(r.venue))));
};

/** 按名称找案件：先找一模一样的，再找名称里包含的 */
const namedCase = (w: World, name: string) => {
  const n = lower(name);
  return n ? (w.cases.find((c) => lower(c.name) === n) ?? w.cases.find((c) => lower(c.name).includes(n))) : undefined;
};
/** 指名的案件还没建、而同一条回复里有一张「新建案件」正要建它 */
const awaitingCase = (w: World, name: string) => {
  const n = lower(name);
  return Boolean(n) && !w.cases.some((c) => lower(c.name) === n) && Boolean(w.creating?.some((x) => lower(x) === n));
};
/** 没指名（或指的名字找不到）时，用这个会话关联的案件；只有一个案件时就是它 */
const targetCase = (w: World, name: string) => {
  const named = namedCase(w, name);
  if (named) return named;
  // 要等那个案件建好：不能因为它还不存在，就先存进手头现有的另一个案件里
  if (awaitingCase(w, name)) return undefined;
  return w.cases.find((c) => c.id === w.linkedCaseId) || (w.cases.length === 1 ? w.cases[0] : undefined);
};
const noCase = (w: World, name: string) =>
  awaitingCase(w, name)
    ? `案件「${name}」还没建好，请先应用上面的「新建案件」`
    : w.cases.length
      ? "不确定是哪个案件，请告诉我案件名称"
      : "还没有案件，请先新建一个";
const attachmentOf = (w: World, name: string) => {
  const n = lower(name);
  const list = [...w.attachments].reverse();
  return list.find((a) => lower(a.name) === n) ?? list.find((a) => lower(a.name).includes(n) || n.includes(lower(a.name)));
};
const caseFileOf = (c: ImmigrationCase, name: string) => {
  const n = lower(name);
  const list = c.files ?? [];
  return list.find((f) => lower(f.name) === n) ?? list.find((f) => lower(f.name).includes(n) || n.includes(lower(f.name)));
};
const docOf = (w: World, title: string, caseName: string) => {
  const t = lower(title);
  const c = namedCase(w, caseName);
  const list = (w.docs ?? []).filter((d) => !c || d.caseId === c.id);
  return t ? (list.find((d) => lower(d.title) === t) ?? list.find((d) => Boolean(d.title.trim()) && (lower(d.title).includes(t) || t.includes(lower(d.title))))) : undefined;
};
const ext = (name: string) => name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "";
const claimsFor = (c: ImmigrationCase) => (c.type === "EB-1A" ? EB1A_CRITERIA : EXCEPTIONAL_CRITERIA);
const labelsOf = (ids: string[], list: { id: string; label: string }[]) => ids.map((id) => list.find((x) => x.id === id)?.label ?? id).join("、");

/* ---------- 贡献总结里的项目：这次操作具体改哪几个 ---------- */

type SocAction = Extract<ChatAction, { type: "soc" }>;
function planSoc(a: SocAction, soc: Soc) {
  const list = soc.projects;
  let problem: string | undefined;
  const miss = (m: string) => {
    problem ??= `贡献总结里没有找到项目「${m}」${list.length ? `（现在有 ${list.length} 个项目）` : ""}`;
  };
  const updates = a.updateProjects.map((u) => {
    const i = projectAt(list, u.match);
    if (i === -1) miss(u.match);
    return { i, set: u.set, clear: u.clear ?? [] };
  });
  const all = (a.clear ?? []).includes("projects");
  const removes = all
    ? list.map((_, i) => i)
    : [...new Set((a.removeProjects ?? []).map((m) => {
        const i = projectAt(list, m);
        if (i === -1) miss(m);
        return i;
      }).filter((i) => i >= 0))];
  // 新加的项目先填进整个是空的那一格（用户在页面上点过「添加项目」但还没写），没有空格才接在后面
  const taken = new Set([...updates.map((u) => u.i), ...removes]);
  const blanks = list.map((_, i) => i).filter((i) => !taken.has(i) && isBlankProject(list[i]));
  const after = (i: number) => i - removes.filter((r) => r < i).length + 1; // 删掉那几个之后，它排第几
  let n = list.length - removes.length;
  const adds = a.addProjects.map((data) => {
    const slot = blanks.shift();
    return slot === undefined ? { data, slot: -1, number: ++n } : { data, slot, number: after(slot) };
  });
  const dropReviews = (a.clear ?? []).includes("reviews")
    ? soc.reviews.map((_, i) => i)
    : [...new Set((a.removeReviews ?? []).map((m) => {
        const i = reviewAt(soc.reviews, m);
        if (i === -1) problem ??= `审稿记录里没有找到「${m}」`;
        return i;
      }).filter((i) => i >= 0))];
  return { updates, removes, adds, dropReviews, problem };
}

/* ---------- 展示 ---------- */

type Card = { title: string; rows: Row[]; problem?: string; danger?: boolean; button?: string };

/** 卡片标题和逐行内容；old 是会被覆盖掉的原内容。problem 不为空时这个操作没法应用；danger 是不能撤销的操作 */
export function describe(a: ChatAction, w: World): Card {
  const rows: Row[] = [];
  const nothing = (c: Card): Card => (c.rows.length || c.problem ? c : { ...c, problem: "这些内容已经是这样了，不需要再改" });
  if (a.type === "profile") {
    let problem: string | undefined;
    for (const k of Object.keys(a.set) as ProfileKey[]) {
      const choice = k in PROFILE_CHOICE;
      const label = choice ? PROFILE_CHOICE[k as ProfileChoiceKey].label : PROFILE_TEXT[k as ProfileTextKey];
      const show = (v: string) => (choice ? (YESNO[v] ?? v) : v);
      const old = String(w.profile[k] ?? "").trim();
      rows.push({ label, value: show(a.set[k]!), old: old && old !== a.set[k] ? show(old) : undefined });
    }
    for (const k of a.clear ?? []) {
      if (k === "degrees") w.profile.degrees.forEach((d, i) => rows.push({ label: `删除学位 ${i + 1}`, value: degreeText(d), danger: true }));
      else if (k === "enrolled") {
        if (w.profile.enrolled) rows.push({ label: "清空：在读学位", value: degreeText(w.profile.enrolled), danger: true });
      } else {
        const old = String(w.profile[k] ?? "").trim();
        const label = k in PROFILE_CHOICE ? PROFILE_CHOICE[k as ProfileChoiceKey].label : PROFILE_TEXT[k as ProfileTextKey];
        if (old) rows.push({ label: `清空：${label}`, value: YESNO[old] ?? old, danger: true });
      }
    }
    for (const u of a.updateDegrees ?? []) {
      const i = degreeAt(w.profile.degrees, u.match);
      if (i === -1) problem ??= `档案里没有找到学位「${u.match}」`;
      const d = w.profile.degrees[i];
      for (const k of Object.keys(u.set) as DegreeKey[]) {
        const show = (v: string) => (k === "related" ? (YESNO[v] ?? v) : v);
        const old = d?.[k].trim();
        rows.push({ label: `学位 ${i + 1} 的${DEGREE_TEXT[k]}`, value: show(u.set[k]!), old: old && old !== u.set[k] ? show(old) : undefined });
      }
    }
    if (!(a.clear ?? []).includes("degrees"))
      for (const m of a.removeDegrees ?? []) {
        const i = degreeAt(w.profile.degrees, m);
        if (i === -1) problem ??= `档案里没有找到学位「${m}」`;
        else rows.push({ label: `删除学位 ${i + 1}`, value: degreeText(w.profile.degrees[i]), danger: true });
      }
    a.addDegrees.forEach((d) => rows.push({ label: "添加已获学位", value: degreeText(d) }));
    if (a.enrolled)
      rows.push({ label: "在读学位", value: degreeText(a.enrolled), old: w.profile.enrolled ? degreeText(w.profile.enrolled) : undefined });
    return nothing({ title: "修改「我的档案 · 基本资料」", rows, problem });
  }
  if (a.type === "soc") {
    const soc = w.profile.soc ?? emptySoc();
    const plan = planSoc(a, soc);
    for (const k of Object.keys(a.set) as SocTextKey[]) {
      const old = soc[k].trim();
      rows.push({ label: SOC_TEXT[k], value: a.set[k]!, old: old && old !== a.set[k] ? old : undefined });
    }
    for (const k of Object.keys(a.append) as SocTextKey[]) rows.push({ label: `${SOC_TEXT[k]}（在原有内容后面追加）`, value: a.append[k]! });
    for (const k of a.clear ?? []) {
      if (k === "projects" || k === "reviews") continue;
      if (soc[k].trim()) rows.push({ label: `清空：${SOC_TEXT[k]}`, value: cut(soc[k], 400), danger: true });
    }
    for (const u of plan.updates) {
      const p = soc.projects[u.i];
      const name = u.i === -1 ? "项目" : projectName(p, u.i);
      for (const k of Object.keys(u.set) as ProjectKey[]) {
        const old = p?.[k].trim();
        rows.push({ label: `${name}的${PROJECT_TEXT[k]}`, value: u.set[k]!, old: old && old !== u.set[k] ? old : undefined });
      }
      for (const k of u.clear) if (p?.[k].trim()) rows.push({ label: `清空：${name}的${PROJECT_TEXT[k]}`, value: cut(p[k], 400), danger: true });
    }
    for (const i of plan.removes) {
      const p = soc.projects[i];
      rows.push({ label: `删除${projectName(p, i)}`, value: isBlankProject(p) ? "（这个项目是空的）" : cut([p.title, p.summary].filter((x) => x.trim()).join("\n"), 400), danger: true });
    }
    for (const x of plan.adds)
      rows.push({
        label: x.slot === -1 ? `添加项目（会成为项目 ${x.number}）` : `添加项目（填进现在空着的项目 ${x.slot + 1}）`,
        value: (Object.keys(PROJECT_TEXT) as ProjectKey[]).filter((k) => x.data[k]).map((k) => `${PROJECT_TEXT[k]}：${x.data[k]}`).join("\n"),
      });
    if (plan.dropReviews.length)
      rows.push({ label: "删除审稿记录", value: plan.dropReviews.map((i) => soc.reviews[i].venue || "（没写名称）").join("\n"), danger: true });
    if (a.addReviews.length)
      rows.push({
        label: "添加审稿记录",
        value: a.addReviews.map((r) => `${r.venue}${r.count ? ` × ${r.count}` : ""}${r.invited ? `（正式邀请：${YESNO[r.invited]}）` : ""}`).join("\n"),
      });
    return nothing({ title: "修改「我的档案 · 贡献总结」", rows, problem: plan.problem });
  }
  if (a.type === "endeavor") {
    const e: Endeavor = w.profile.endeavor ?? emptyEndeavor();
    for (const k of Object.keys(a.set) as EndeavorKey[]) {
      const old = e[k].trim();
      rows.push({ label: ENDEAVOR_TEXT[k], value: a.set[k]!, old: old && old !== a.set[k] ? old : undefined });
    }
    for (const k of Object.keys(a.append) as EndeavorKey[]) rows.push({ label: `${ENDEAVOR_TEXT[k]}（在原有内容后面追加）`, value: a.append[k]! });
    for (const k of a.clear ?? []) if (e[k].trim()) rows.push({ label: `清空：${ENDEAVOR_TEXT[k]}`, value: cut(e[k], 400), danger: true });
    return nothing({ title: "修改「我的档案 · 拟从事事业」", rows });
  }
  if (a.type === "case") {
    return { title: "新建案件", rows: [{ label: "名称", value: a.name }, { label: "类型", value: a.caseType }] };
  }
  if (a.type === "caseEdit") {
    const c = targetCase(w, a.case);
    if (!c) return { title: "修改案件", rows: [{ label: "案件", value: a.case }], problem: noCase(w, a.case) };
    let problem: string | undefined;
    if (a.rename && a.rename !== c.name) rows.push({ label: "名称", value: a.rename, old: c.name });
    if (a.eb2) {
      if (c.type !== "NIW") problem ??= "只有 NIW 案件需要选 EB-2 的基础资格";
      else if (a.eb2 !== c.eb2) rows.push({ label: "EB-2 基础资格", value: EB2_TEXT[a.eb2], old: c.eb2 ? EB2_TEXT[c.eb2] : undefined });
    }
    const list = claimsFor(c);
    const have = c.claims ?? [];
    const add = a.addClaims.filter((id) => list.some((x) => x.id === id) && !have.includes(id));
    const drop = a.removeClaims.filter((id) => have.includes(id));
    if ([...a.addClaims, ...a.removeClaims].some((id) => !list.some((x) => x.id === id)))
      problem ??= c.type === "EB-1A" ? "有的标准不是 EB-1A 十项标准里的" : "NIW 案件只有按「特殊能力」申报时才需要选标准，而且只能从特殊能力的六项里选";
    else if (c.type === "NIW" && add.length && (a.eb2 || c.eb2) !== "exceptional") problem ??= "这个 NIW 案件不是按「特殊能力」申报的，不需要选标准";
    if (add.length) rows.push({ label: "主张的标准：添加", value: labelsOf(add, list) });
    if (drop.length) rows.push({ label: "主张的标准：去掉", value: labelsOf(drop, list), danger: true });
    const items = itemsOf(c.type);
    const on = a.check.filter((id) => items.some((x) => x.id === id) && !c.done.includes(id));
    const off = a.uncheck.filter((id) => c.done.includes(id));
    if ([...a.check, ...a.uncheck].some((id) => !items.some((x) => x.id === id))) problem ??= `有的材料不在 ${c.type} 的清单里`;
    if (on.length) rows.push({ label: "材料清单：勾上", value: labelsOf(on, items) });
    if (off.length) rows.push({ label: "材料清单：取消勾选", value: labelsOf(off, items), danger: true });
    return nothing({ title: `修改案件「${c.name}」`, rows, problem });
  }
  if (a.type === "caseDelete") {
    const c = namedCase(w, a.case);
    if (!c) return { title: "删除案件", rows: [{ label: "案件", value: a.case }], problem: awaitingCase(w, a.case) ? noCase(w, a.case) : `没有找到案件「${a.case}」`, danger: true, button: "确认删除" };
    const n = (w.docs ?? []).filter((d) => d.caseId === c.id).length;
    return {
      title: "删除案件",
      rows: [
        { label: "案件", value: `${c.name}（${c.type}）`, danger: true },
        { label: "会一起删掉", value: `${n} 份文档、${(c.files ?? []).length} 个文件` },
      ],
      danger: true,
      button: "确认删除",
    };
  }
  if (a.type === "saveFile") {
    const c = targetCase(w, a.case);
    const f = attachmentOf(w, a.file);
    rows.push({ label: "文件", value: f?.name ?? a.file });
    rows.push({ label: "存到案件", value: c?.name ?? a.case ?? "" });
    if (a.title) rows.push({ label: "Exhibit 标题", value: a.title });
    return {
      title: "把文件存进案件（打包时作为 Exhibit）",
      rows,
      problem: !f ? `这次对话里没有找到文件「${a.file}」，请重新上传` : !c ? noCase(w, a.case) : undefined,
    };
  }
  if (a.type === "caseFile") {
    const c = targetCase(w, a.case);
    const title = a.remove ? "删除案件里的文件" : "给案件里的文件改名";
    if (!c) return { title, rows: [{ label: "文件", value: a.file }], problem: noCase(w, a.case), danger: a.remove, button: a.remove ? "确认删除" : undefined };
    const f = caseFileOf(c, a.file);
    rows.push({ label: "案件", value: c.name });
    if (a.remove) rows.push({ label: "文件", value: f?.name ?? a.file, danger: true });
    else rows.push({ label: "新名称", value: a.rename + (ext(a.rename) ? "" : ext(f?.name ?? "")), old: f?.name ?? a.file });
    return { title, rows, problem: f ? undefined : `案件「${c.name}」里没有找到文件「${a.file}」`, danger: a.remove, button: a.remove ? "确认删除" : undefined };
  }
  if (a.type === "doc") {
    const c = targetCase(w, a.case);
    const content = a.from ? REPORTS[a.from].make(w.profile) : a.content;
    rows.push({ label: "标题", value: a.title || REPORT_TITLE[a.kind] || a.kind });
    rows.push({ label: "类型", value: a.kind });
    rows.push({ label: "放进案件", value: c?.name ?? a.case });
    rows.push({ label: "内容", value: a.from ? `用「我的档案」里的${REPORTS[a.from].where}自动生成（${content.length} 字）` : `${cut(content, 500)}${content.length > 500 ? `（共 ${content.length} 字）` : ""}` });
    return {
      title: "在案件里新建文档",
      rows,
      problem: !c ? noCase(w, a.case) : !content.trim() ? `「我的档案」里的${a.from ? REPORTS[a.from].where : "这部分"}还没有内容，生成不出文档` : undefined,
    };
  }
  if (a.type === "docEdit") {
    const d = docOf(w, a.doc, a.case);
    const title = a.remove ? "删除文档" : "给文档改名";
    if (a.remove) rows.push({ label: "文档", value: d?.title || a.doc, danger: true });
    else rows.push({ label: "新标题", value: a.rename, old: d?.title || a.doc });
    if (d && a.remove) rows.push({ label: "内容", value: d.content.trim() ? `${d.content.trim().length} 字` : "（空的）" });
    return { title, rows, problem: d ? undefined : `没有找到文档「${a.doc}」`, danger: a.remove, button: a.remove ? "确认删除" : undefined };
  }
  if (a.type === "chat") {
    if (a.op === "new") {
      const c = a.case ? targetCase(w, a.case) : undefined;
      if (a.title) rows.push({ label: "标题", value: a.title });
      rows.push({ label: "关联案件", value: c?.name ?? (a.case ? a.case : "不关联") });
      return { title: "新建会话", rows, problem: a.case && !c ? noCase(w, a.case) : undefined, button: "新建并打开" };
    }
    if (!w.conv) return { title: "修改会话", rows, problem: "现在不在一个已保存的会话里" };
    if (a.op === "rename") {
      return nothing({ title: "给这个会话改名", rows: a.title === w.conv.title ? [] : [{ label: "新标题", value: a.title, old: w.conv.title }] });
    }
    if (a.op === "link") {
      const c = a.case ? namedCase(w, a.case) : undefined;
      const now = w.cases.find((x) => x.id === w.conv?.caseId);
      if (a.case && !c) return { title: "把这个会话关联到案件", rows: [{ label: "案件", value: a.case }], problem: noCase(w, a.case) };
      return nothing({
        title: c ? "把这个会话关联到案件" : "取消这个会话关联的案件",
        rows: (c?.id ?? "") === (now?.id ?? "") ? [] : [{ label: "关联案件", value: c?.name ?? "不关联", old: now?.name }],
      });
    }
    const m = lower(a.match);
    const mine = lower(w.conv.title) === m;
    const hit = (w.convs ?? []).find((x) => lower(x.title) === m) ?? (w.convs ?? []).find((x) => lower(x.title).includes(m));
    return {
      title: "删除会话",
      rows: [{ label: "会话", value: hit?.title ?? a.match, danger: true }],
      problem: hit ? undefined : mine ? "不能在这个会话里删除它自己，请在左边「历史会话」里点它后面的 ×" : `没有找到会话「${a.match}」`,
      danger: true,
      button: "确认删除",
    };
  }
  const { place, problem } = goPlace(a, w);
  const caseId = place.view === "cases" ? place.caseId : undefined;
  const c = caseId ? w.cases.find((x) => x.id === caseId) : undefined;
  const d = a.to === "doc" ? docOf(w, a.doc, a.case) : undefined;
  return { title: `打开「${a.to === "doc" ? (d?.title ?? a.doc) : c ? `${c.name} · ${GO[a.to]}` : GO[a.to]}」`, rows: [], problem, button: "打开 →" };
}

/** 不能撤销的操作（删除案件、文件、文档、会话），以及本来就没有东西可撤销的（新建会话、打开页面） */
export const irreversible = (a: ChatAction) =>
  a.type === "caseDelete" || a.type === "go" || ((a.type === "caseFile" || a.type === "docEdit") && a.remove) || (a.type === "chat" && (a.op === "new" || a.op === "delete"));

/** 应用之后可以带用户去看的那一页 */
export type Place =
  | { view: "profile"; tab: "basic" | "scholar" | "soc" | "endeavor" }
  | { view: "cases"; caseId?: string; tab: "guide" | "docs" | "files" | "checklist" | "pack"; docId?: string }
  | { view: "account" };

type GoAction = Extract<ChatAction, { type: "go" }>;
function goPlace(a: GoAction, w: World): { place: Place; problem?: string } {
  if (a.to === "account") return { place: { view: "account" } };
  if (a.to === "cases") return { place: { view: "cases", tab: "guide" } };
  if (a.to.startsWith("profile.")) return { place: { view: "profile", tab: a.to.slice(8) as "basic" | "scholar" | "soc" | "endeavor" } };
  if (a.to === "doc") {
    const d = docOf(w, a.doc, a.case);
    return { place: { view: "cases", caseId: d?.caseId, tab: "docs", docId: d?.id }, problem: d ? undefined : `没有找到文档「${a.doc}」` };
  }
  const c = targetCase(w, a.case);
  return { place: { view: "cases", caseId: c?.id, tab: a.to.slice(5) as "guide" | "docs" | "files" | "checklist" | "pack" }, problem: c ? undefined : noCase(w, a.case) };
}

/** 这个操作改的是哪一页（应用之前按现在的数据估计；应用时 apply 会给出更准的）。没有可看的页面时返回 undefined */
export function placeOf(a: ChatAction, w: World): Place | undefined {
  if (a.type === "profile") return { view: "profile", tab: "basic" };
  if (a.type === "soc") return { view: "profile", tab: "soc" };
  if (a.type === "endeavor") return { view: "profile", tab: "endeavor" };
  if (a.type === "case") return { view: "cases", caseId: w.cases.find((c) => c.name === a.name)?.id, tab: "guide" };
  if (a.type === "caseEdit") return { view: "cases", caseId: namedCase(w, a.rename || a.case)?.id ?? targetCase(w, a.case)?.id, tab: a.check.length || a.uncheck.length ? "checklist" : "guide" };
  if (a.type === "caseDelete") return { view: "cases", tab: "guide" };
  if (a.type === "saveFile" || a.type === "caseFile") return { view: "cases", caseId: targetCase(w, a.case)?.id, tab: "files" };
  if (a.type === "doc") return { view: "cases", caseId: targetCase(w, a.case)?.id, tab: "docs" };
  if (a.type === "docEdit") {
    const d = docOf(w, a.rename || a.doc, a.case);
    return { view: "cases", caseId: d?.caseId ?? targetCase(w, a.case)?.id, tab: "docs", docId: a.remove ? undefined : d?.id };
  }
  if (a.type === "go") return goPlace(a, w).place;
  return undefined;
}

/* ---------- 应用 ---------- */

export type Applied = {
  profile?: Profile;
  cases?: ImmigrationCase[];
  docs?: DocFile[];
  /** 当前会话的标题和关联的案件 */
  conv?: { title: string; caseId?: string };
  /** saveFile 要复制文件内容：把 from 的内容另存为 to */
  copy?: { from: string; to: string };
  /** 这些文件不再用了（调用方确认别处也没在用之后清掉内容） */
  release?: string[];
  /** 不是改数据的动作：新开一个会话、删掉一个会话 */
  effect?: { newChat: { title: string; caseId?: string } } | { deleteChat: string };
  place?: Place;
  /** 删除类的操作：不能撤销 */
  final?: boolean;
  error?: string;
};

/** 把操作应用到档案、案件、文档上，返回新的数据（没变的那几份不返回） */
export function apply(a: ChatAction, w: World): Applied {
  const problem = describe(a, w).problem;
  if (problem) return { error: problem };
  const now = Date.now();
  if (a.type === "profile") {
    const p = w.profile;
    const next: Record<string, unknown> = { ...p, ...a.set };
    let degrees = p.degrees;
    let enrolled = p.enrolled;
    const drop = new Set<string>();
    for (const k of a.clear ?? []) {
      if (k === "degrees") degrees.forEach((d) => drop.add(d.id));
      else if (k === "enrolled") enrolled = null;
      else next[k] = "";
    }
    for (const u of a.updateDegrees ?? []) {
      const id = p.degrees[degreeAt(p.degrees, u.match)].id;
      degrees = degrees.map((d) => (d.id === id ? { ...d, ...u.set } : d));
    }
    for (const m of a.removeDegrees ?? []) {
      const d = p.degrees[degreeAt(p.degrees, m)];
      if (d) drop.add(d.id);
    }
    degrees = [...degrees.filter((d) => !drop.has(d.id)), ...a.addDegrees.map((d) => ({ ...d, id: uid() }))];
    if (a.enrolled) enrolled = { ...a.enrolled, id: p.enrolled?.id ?? uid() };
    // 手动改了数字：这组数字就不再算作取自某个数据来源
    if ([...Object.keys(a.set), ...(a.clear ?? [])].some((k) => NUMBERS.includes(k))) next.primarySource = "";
    return { profile: { ...(next as Profile), degrees, enrolled, updatedAt: now } };
  }
  if (a.type === "soc") {
    const old: Soc = { ...emptySoc(), ...w.profile.soc };
    const plan = planSoc(a, old);
    const soc: Soc = { ...old, ...a.set };
    for (const k of Object.keys(a.append) as SocTextKey[]) soc[k] = [soc[k].trim(), a.append[k]].filter(Boolean).join("\n");
    for (const k of a.clear ?? []) if (k !== "projects" && k !== "reviews") soc[k] = "";
    const patch = new Map<number, Partial<SocProject>>();
    for (const u of plan.updates) patch.set(u.i, { ...patch.get(u.i), ...u.set, ...Object.fromEntries(u.clear.map((k) => [k, ""])) });
    for (const x of plan.adds) if (x.slot !== -1) patch.set(x.slot, x.data);
    soc.projects = [
      ...old.projects.map((p, i) => (patch.has(i) ? { ...p, ...patch.get(i) } : p)).filter((_, i) => !plan.removes.includes(i)),
      ...plan.adds.filter((x) => x.slot === -1).map((x) => ({ ...x.data, id: uid() })),
    ];
    soc.reviews = [...old.reviews.filter((_, i) => !plan.dropReviews.includes(i)), ...a.addReviews.map((r) => ({ ...r, id: uid() }))];
    return { profile: { ...w.profile, soc, updatedAt: now } };
  }
  if (a.type === "endeavor") {
    const endeavor: Endeavor = { ...emptyEndeavor(), ...w.profile.endeavor, ...a.set };
    for (const k of Object.keys(a.append) as EndeavorKey[]) endeavor[k] = [endeavor[k].trim(), a.append[k]].filter(Boolean).join("\n");
    for (const k of a.clear ?? []) endeavor[k] = "";
    return { profile: { ...w.profile, endeavor, updatedAt: now } };
  }
  if (a.type === "case") {
    const c: ImmigrationCase = { id: uid(), name: a.name, type: a.caseType, createdAt: now, done: [], files: [] };
    return { cases: [c, ...w.cases], place: { view: "cases", caseId: c.id, tab: "guide" } };
  }
  const swap = (c: ImmigrationCase, next: ImmigrationCase) => w.cases.map((x) => (x.id === c.id ? next : x));
  if (a.type === "caseEdit") {
    const c = targetCase(w, a.case)!;
    const list = claimsFor(c);
    const eb2 = a.eb2 && c.type === "NIW" ? a.eb2 : c.eb2;
    const claims = [...(c.claims ?? []).filter((id) => !a.removeClaims.includes(id)), ...a.addClaims.filter((id) => list.some((x) => x.id === id) && !(c.claims ?? []).includes(id))];
    const done = [...c.done.filter((id) => !a.uncheck.includes(id)), ...a.check.filter((id) => !c.done.includes(id))];
    const next: ImmigrationCase = { ...c, name: a.rename || c.name, done };
    if (eb2) next.eb2 = eb2;
    if (c.claims || claims.length) next.claims = claims;
    return { cases: swap(c, next), place: { view: "cases", caseId: c.id, tab: a.check.length || a.uncheck.length ? "checklist" : "guide" } };
  }
  if (a.type === "caseDelete") {
    const c = namedCase(w, a.case)!;
    const gone = (w.docs ?? []).filter((d) => d.caseId === c.id);
    return {
      cases: w.cases.filter((x) => x.id !== c.id),
      docs: gone.length ? (w.docs ?? []).filter((d) => d.caseId !== c.id) : undefined,
      release: [...(c.files ?? []).map((f) => f.id), ...gone.flatMap((d) => d.chat.flatMap((m) => m.attachments ?? []).map((f) => f.id))],
      place: { view: "cases", tab: "guide" },
      final: true,
    };
  }
  if (a.type === "saveFile") {
    const c = targetCase(w, a.case)!;
    const f = attachmentOf(w, a.file)!;
    // 案件里的文件名就是打包时 Exhibit 的默认标题，所以直接用标题当文件名
    const name = a.title ? a.title.replace(/[\\/:*?"<>|]/g, " ").slice(0, 150) + ext(f.name) : f.name;
    const copy: Attachment = { ...f, id: uid(), name };
    return { cases: swap(c, { ...c, files: [...(c.files ?? []), copy] }), copy: { from: f.id, to: copy.id }, place: { view: "cases", caseId: c.id, tab: "files" } };
  }
  if (a.type === "caseFile") {
    const c = targetCase(w, a.case)!;
    const f = caseFileOf(c, a.file)!;
    const place: Place = { view: "cases", caseId: c.id, tab: "files" };
    if (a.remove) return { cases: swap(c, { ...c, files: (c.files ?? []).filter((x) => x.id !== f.id) }), release: [f.id], place, final: true };
    const name = a.rename + (ext(a.rename) ? "" : ext(f.name));
    return { cases: swap(c, { ...c, files: (c.files ?? []).map((x) => (x.id === f.id ? { ...x, name } : x)) }), place };
  }
  if (a.type === "doc") {
    const c = targetCase(w, a.case)!;
    const d: DocFile = {
      id: uid(),
      title: a.title || REPORT_TITLE[a.kind] || a.kind,
      kind: a.kind,
      content: a.from ? REPORTS[a.from].make(w.profile) : a.content,
      updatedAt: now,
      chat: [],
      caseId: c.id,
    };
    return { docs: [d, ...(w.docs ?? [])], place: { view: "cases", caseId: c.id, tab: "docs", docId: d.id } };
  }
  if (a.type === "docEdit") {
    const d = docOf(w, a.doc, a.case)!;
    if (a.remove)
      return {
        docs: (w.docs ?? []).filter((x) => x.id !== d.id),
        release: d.chat.flatMap((m) => m.attachments ?? []).map((f) => f.id),
        place: { view: "cases", caseId: d.caseId, tab: "docs" },
        final: true,
      };
    return { docs: (w.docs ?? []).map((x) => (x.id === d.id ? { ...x, title: a.rename, updatedAt: now } : x)), place: { view: "cases", caseId: d.caseId, tab: "docs", docId: d.id } };
  }
  if (a.type === "chat") {
    if (a.op === "new") return { effect: { newChat: { title: a.title, caseId: a.case ? targetCase(w, a.case)?.id : undefined } }, final: true };
    const conv = w.conv!;
    if (a.op === "rename") return { conv: { title: a.title, caseId: conv.caseId } };
    if (a.op === "link") return { conv: { title: conv.title, caseId: a.case ? namedCase(w, a.case)!.id : undefined } };
    const m = lower(a.match);
    const hit = (w.convs ?? []).find((x) => lower(x.title) === m) ?? (w.convs ?? []).find((x) => lower(x.title).includes(m))!;
    return { effect: { deleteChat: hit.id }, final: true };
  }
  return { place: goPlace(a, w).place, final: true };
}

/* ---------- 给模型看的现状 ---------- */

/** 告诉模型档案里现在有什么、哪些项还空着、用户有哪些案件和会话，方便它主动问、填，以及按编号和名称去指 */
export function worldText(w: World): string {
  const p = w.profile;
  const soc = p.soc ?? emptySoc();
  const empty: string[] = [];
  (Object.keys(PROFILE_TEXT) as ProfileTextKey[])
    .filter((k) => !["fieldFrom", "fieldTo", "nextPaper", "scholarUrl", "s2Url", ...NUMBERS].includes(k) && !String(p[k] ?? "").trim())
    .forEach((k) => empty.push(PROFILE_TEXT[k]));
  if (!p.degrees.length) empty.push("已获学位");
  if (!p.reviews) empty.push("审稿次数");
  if (!p.sameField) empty.push("未来是否仍在同一领域");
  if (!p.activeResearch) empty.push("是否仍在做研究");
  (Object.keys(SOC_TEXT) as SocTextKey[]).filter((k) => !soc[k].trim()).forEach((k) => empty.push(`贡献总结·${SOC_TEXT[k]}`));
  if (!soc.projects.length) empty.push("贡献总结·主要贡献（项目）");
  if (!soc.reviews.length) empty.push("贡献总结·审稿记录");
  const lines = [`档案里还没填的项：${empty.length ? empty.join("、") : "无"}`];
  if (p.degrees.length) lines.push(`已获学位（按页面上的顺序编号）：${p.degrees.map((d, i) => `学位 ${i + 1}：${degreeText(d)}`).join("；")}`);
  if (p.enrolled) lines.push(`在读学位：${degreeText(p.enrolled)}`);
  const filled = (Object.keys(SOC_TEXT) as SocTextKey[]).filter((k) => soc[k].trim()).map((k) => SOC_TEXT[k]);
  if (filled.length) lines.push(`贡献总结里已经有内容的项（要补充请用 append，不要用 set 覆盖）：${filled.join("、")}`);
  if (soc.projects.length) {
    lines.push("贡献总结里的项目（编号就是页面上显示的「项目 1、项目 2…」；用户说第几个项目，就是这里的第几个）：");
    soc.projects.slice(0, 12).forEach((x, i) => {
      const keys = Object.keys(PROJECT_TEXT) as ProjectKey[];
      const have = keys.filter((k) => k !== "title" && x[k].trim()).map((k) => PROJECT_TEXT[k]);
      const todo = keys.filter((k) => k !== "title" && !x[k].trim()).map((k) => PROJECT_TEXT[k]);
      lines.push(
        isBlankProject(x)
          ? `  项目 ${i + 1}：整个是空的（没有名称，也没有内容）`
          : `  项目 ${i + 1}：${x.title.trim() ? `「${cut(x.title, 120)}」` : "没有名称"}；已填：${have.join("、") || "无"}；还空着：${todo.join("、") || "无"}`,
      );
    });
  }
  if (soc.reviews.length) lines.push(`贡献总结里的审稿记录：${soc.reviews.slice(0, 40).map((r) => `${r.venue || "（没写名称）"}${r.count ? ` × ${r.count}` : ""}`).join("、")}`);
  // 拟从事事业只有 NIW 用得上：用户只有 EB-1A 案件时不提，免得模型去追问
  const niw = w.cases.some((c) => c.type === "NIW");
  if (niw || !w.cases.length) {
    const e = p.endeavor ?? emptyEndeavor();
    const todo = ENDEAVOR_KEYS.filter((k) => !e[k].trim()).map((k) => ENDEAVOR_TEXT[k]);
    const have = ENDEAVOR_KEYS.filter((k) => e[k].trim()).map((k) => ENDEAVOR_TEXT[k]);
    lines.push(
      `拟从事事业（只有申请 NIW 才需要${niw ? "，用户有 NIW 案件" : "；用户还没说要申请 NIW 时不要主动问"}）还没填的项：${todo.length ? todo.join("、") : "无"}` +
        (have.length ? `；已经有内容的项（要补充请用 append，不要用 set 覆盖）：${have.join("、")}` : ""),
    );
  }
  if (!w.cases.length) lines.push("用户还没有新建任何案件");
  else {
    lines.push("用户的案件：");
    for (const c of w.cases.slice(0, 8)) {
      const docs = (w.docs ?? []).filter((d) => d.caseId === c.id);
      const files = c.files ?? [];
      const bits = [`  「${c.name}」（${c.type}${c.id === w.linkedCaseId ? "，这个会话关联的就是它" : ""}）`];
      if (c.type === "NIW") bits.push(`EB-2 基础资格：${c.eb2 ? EB2_TEXT[c.eb2] : "还没选"}`);
      if (c.claims?.length) bits.push(`主张的标准：${c.claims.join("、")}`);
      else if (c.type === "EB-1A") bits.push("还没选主张哪些标准");
      bits.push(`清单已勾：${c.done.length ? c.done.join("、") : "无"}`);
      bits.push(`文档 ${docs.length} 份${docs.length ? `：${docs.slice(0, 12).map((d) => `「${cut(d.title || d.kind, 60)}」`).join("、")}` : ""}`);
      bits.push(`文件 ${files.length} 个${files.length ? `：${files.slice(0, 20).map((f) => cut(f.name, 70)).join("、")}${files.length > 20 ? " 等" : ""}` : ""}`);
      lines.push(bits.join("；"));
    }
  }
  if (w.conv) lines.push(`现在这个会话的标题：「${w.conv.title}」`);
  if (w.convs?.length) lines.push(`用户的其他会话：${w.convs.slice(0, 15).map((c) => `「${cut(c.title, 30)}」`).join("、")}`);
  if (w.attachments.length) lines.push(`这次对话里用户上传过的文件：${[...new Set(w.attachments.map((a) => a.name))].join("、")}`);
  return lines.join("\n");
}

/* ---------- 给模型看的固定清单（放进系统提示里） ---------- */

const listText = (list: { id: string; label: string }[]) => list.map((x) => `${x.id}（${x.label}）`).join("、");
export const ACTION_LISTS = {
  eb1a: listText(EB1A_CRITERIA),
  exceptional: listText(EXCEPTIONAL_CRITERIA),
  niwItems: listText(itemsOf("NIW")),
  eb1aItems: listText(itemsOf("EB-1A")),
  kinds: DOC_KINDS.map((k) => k.kind).join("、"),
  go: (Object.keys(GO) as GoKey[]).map((k) => `${k}（${GO[k]}）`).join("、"),
};
