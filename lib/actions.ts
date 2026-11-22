/**
 * 聊天里的「操作」：模型在回复中输出 <action>{JSON}</action>，页面把它变成一张确认卡片，
 * 用户点「应用」后才真的写进档案 / 案件。模型的输出不可信，所以这里对每个字段做白名单和长度限制。
 *
 * 支持的操作：
 *   profile   填「我的档案」的基本资料
 *   soc       填「贡献总结」
 *   case      新建案件
 *   saveFile  把这次对话里用户上传的文件存进案件的文件里（案件文件打包时默认就是 Exhibit）
 */

import { DEGREE_TYPES, REVIEW_OPTIONS, emptySoc } from "./profile";
import type { Degree, Profile, Related, Soc, SocProject, SocReview } from "./profile";
import type { Attachment, CaseType, ImmigrationCase } from "./types";
import { uid } from "./types";

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
} as const;
const PROFILE_CHOICE = {
  reviews: { label: "审稿次数", options: REVIEW_OPTIONS as readonly string[] },
  sameField: { label: "未来是否仍在同一领域", options: ["yes", "no"] },
  activeResearch: { label: "是否仍在做研究、发表论文", options: ["yes", "no"] },
} as const;
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
const YESNO: Record<string, string> = { yes: "是", no: "否", unsure: "不确定", other: "其他" };

type ProfileTextKey = keyof typeof PROFILE_TEXT;
type ProfileChoiceKey = keyof typeof PROFILE_CHOICE;
type SocTextKey = keyof typeof SOC_TEXT;
type ProjectKey = keyof typeof PROJECT_TEXT;
type DegreeIn = Omit<Degree, "id">;

export type ChatAction =
  | {
      type: "profile";
      set: Partial<Record<ProfileTextKey | ProfileChoiceKey, string>>;
      addDegrees: DegreeIn[];
      enrolled?: DegreeIn;
    }
  | {
      type: "soc";
      set: Partial<Record<SocTextKey, string>>;
      append: Partial<Record<SocTextKey, string>>;
      addProjects: Omit<SocProject, "id">[];
      updateProjects: { match: string; set: Partial<Record<ProjectKey, string>> }[];
      addReviews: Omit<SocReview, "id">[];
    }
  | { type: "case"; name: string; caseType: CaseType }
  | { type: "saveFile"; file: string; case: string; title: string };

/** 存在聊天消息上的操作及其状态 */
export type ActionItem = { id: string; action: ChatAction; status: "pending" | "applied" | "skipped"; note?: string };

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

function pickText<K extends string>(raw: unknown, keys: Record<K, string>, max: number): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of Object.keys(keys) as K[]) {
    const v = str((raw as Record<string, unknown>)[k], max);
    if (v) out[k] = v;
  }
  return out;
}

function degree(raw: Record<string, unknown>): DegreeIn | null {
  const t = str(raw.type, 60);
  // 模型可能只写 PhD / 博士，对到下拉框里的选项上
  const type =
    DEGREE_TYPES.find((d) => d === t) ??
    DEGREE_TYPES.find((d) => /phd|博士|doctor/i.test(t) && d.includes("PhD")) ??
    DEGREE_TYPES.find((d) => /master|硕士|m\.?s\b|m\.?a\b|meng|mba/i.test(t) && d.includes("Master")) ??
    DEGREE_TYPES.find((d) => /bachelor|学士|本科|b\.?s\b|b\.?a\b|beng/i.test(t) && d.includes("Bachelor")) ??
    DEGREE_TYPES.find((d) => d === t.toUpperCase()) ??
    "其他";
  const related = str(raw.related, 10);
  const d: DegreeIn = {
    type,
    major: str(raw.major, 200),
    university: str(raw.university, 200),
    year: str(raw.year, 40),
    related: (["yes", "no", "unsure"].includes(related) ? related : "") as Related,
  };
  return d.major || d.university ? d : null;
}

function one(raw: unknown): ChatAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.type === "profile") {
    const set: Partial<Record<ProfileTextKey | ProfileChoiceKey, string>> = pickText(a.set, PROFILE_TEXT, 300);
    for (const k of Object.keys(PROFILE_CHOICE) as ProfileChoiceKey[]) {
      const v = str((a.set as Record<string, unknown> | undefined)?.[k], 20);
      if ((PROFILE_CHOICE[k].options as readonly string[]).includes(v)) set[k] = v;
    }
    const addDegrees = arr(a.addDegrees, 6).map(degree).filter((d): d is DegreeIn => d !== null);
    const enrolled = a.enrolled && typeof a.enrolled === "object" ? (degree(a.enrolled as Record<string, unknown>) ?? undefined) : undefined;
    if (!Object.keys(set).length && !addDegrees.length && !enrolled) return null;
    return { type: "profile", set, addDegrees, enrolled };
  }
  if (a.type === "soc") {
    const set = pickText(a.set, SOC_TEXT, 8000);
    const append = pickText(a.append, SOC_TEXT, 8000);
    const addProjects = arr(a.addProjects, 5)
      .map((p) => ({ title: "", start: "", end: "", outputs: "", funding: "", summary: "", impact: "", ...pickText(p, PROJECT_TEXT, 6000) }))
      .filter((p) => p.title || p.summary);
    const updateProjects = arr(a.updateProjects, 5)
      .map((p) => ({ match: str(p.match, 300), set: pickText(p.set, PROJECT_TEXT, 6000) }))
      .filter((p) => p.match && Object.keys(p.set).length);
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
    if (!Object.keys(set).length && !Object.keys(append).length && !addProjects.length && !updateProjects.length && !addReviews.length)
      return null;
    return { type: "soc", set, append, addProjects, updateProjects, addReviews };
  }
  if (a.type === "case") {
    const caseType: CaseType = a.caseType === "EB-1A" ? "EB-1A" : "NIW";
    return { type: "case", name: str(a.name, 60) || `我的 ${caseType} 案件`, caseType };
  }
  if (a.type === "saveFile") {
    const file = str(a.file, 300);
    return file ? { type: "saveFile", file, case: str(a.case, 60), title: str(a.title, 200) } : null;
  }
  return null;
}

/** 从完整的回复里取出所有格式正确的操作；看不懂的直接丢掉 */
export function parseActions(raw: string): ChatAction[] {
  const out: ChatAction[] = [];
  for (const m of raw.matchAll(BLOCK)) {
    try {
      const a = one(JSON.parse(m[1].trim().replace(/^```(?:json)?\s*|\s*```$/g, "")));
      if (a) out.push(a);
    } catch {
      // JSON 不完整或写错了，跳过
    }
  }
  return out.slice(0, 8);
}

/* ---------- 展示 ---------- */

export type Row = { label: string; value: string; old?: string };
export type World = { profile: Profile; cases: ImmigrationCase[]; linkedCaseId?: string | null; attachments: Attachment[] };

const degreeText = (d: DegreeIn) => [d.type, d.major, d.university, d.year].filter(Boolean).join("，");
const projectOf = (soc: Soc, match: string) => {
  const m = match.trim().toLowerCase();
  return soc.projects.find((p) => p.title.trim().toLowerCase() === m) ?? soc.projects.find((p) => p.title.toLowerCase().includes(m) || (p.title.trim() && m.includes(p.title.trim().toLowerCase())));
};
const targetCase = (w: World, name: string) => {
  const n = name.trim().toLowerCase();
  return (
    (n && (w.cases.find((c) => c.name.toLowerCase() === n) ?? w.cases.find((c) => c.name.toLowerCase().includes(n)))) ||
    w.cases.find((c) => c.id === w.linkedCaseId) ||
    (w.cases.length === 1 ? w.cases[0] : undefined)
  );
};
const attachmentOf = (w: World, name: string) => {
  const n = name.trim().toLowerCase();
  const list = [...w.attachments].reverse();
  return list.find((a) => a.name.toLowerCase() === n) ?? list.find((a) => a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase()));
};
const ext = (name: string) => name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "";

/** 卡片标题和逐行内容；old 是会被覆盖掉的原内容。problem 不为空时这个操作没法应用 */
export function describe(a: ChatAction, w: World): { title: string; rows: Row[]; problem?: string } {
  const rows: Row[] = [];
  if (a.type === "profile") {
    for (const k of Object.keys(a.set) as (ProfileTextKey | ProfileChoiceKey)[]) {
      const choice = k in PROFILE_CHOICE;
      const label = choice ? PROFILE_CHOICE[k as ProfileChoiceKey].label : PROFILE_TEXT[k as ProfileTextKey];
      const show = (v: string) => (choice ? (YESNO[v] ?? v) : v);
      const old = String(w.profile[k] ?? "").trim();
      rows.push({ label, value: show(a.set[k]!), old: old && old !== a.set[k] ? show(old) : undefined });
    }
    a.addDegrees.forEach((d) => rows.push({ label: "添加已获学位", value: degreeText(d) }));
    if (a.enrolled)
      rows.push({ label: "在读学位", value: degreeText(a.enrolled), old: w.profile.enrolled ? degreeText(w.profile.enrolled) : undefined });
    return { title: "填入「我的档案 · 基本资料」", rows };
  }
  if (a.type === "soc") {
    const soc = w.profile.soc ?? emptySoc();
    for (const k of Object.keys(a.set) as SocTextKey[]) {
      const old = soc[k].trim();
      rows.push({ label: SOC_TEXT[k], value: a.set[k]!, old: old && old !== a.set[k] ? old : undefined });
    }
    for (const k of Object.keys(a.append) as SocTextKey[]) rows.push({ label: `${SOC_TEXT[k]}（在原有内容后面追加）`, value: a.append[k]! });
    a.addProjects.forEach((p) =>
      rows.push({
        label: "添加项目",
        value: (Object.keys(PROJECT_TEXT) as ProjectKey[]).filter((k) => p[k]).map((k) => `${PROJECT_TEXT[k]}：${p[k]}`).join("\n"),
      }),
    );
    let problem: string | undefined;
    a.updateProjects.forEach((u) => {
      const p = projectOf(soc, u.match);
      if (!p) problem = `贡献总结里没有找到项目「${u.match}」`;
      for (const k of Object.keys(u.set) as ProjectKey[]) {
        const old = p?.[k].trim();
        rows.push({ label: `项目「${p?.title || u.match}」的${PROJECT_TEXT[k]}`, value: u.set[k]!, old: old && old !== u.set[k] ? old : undefined });
      }
    });
    if (a.addReviews.length)
      rows.push({
        label: "添加审稿记录",
        value: a.addReviews.map((r) => `${r.venue}${r.count ? ` × ${r.count}` : ""}${r.invited ? `（正式邀请：${YESNO[r.invited]}）` : ""}`).join("\n"),
      });
    return { title: "填入「我的档案 · 贡献总结」", rows, problem };
  }
  if (a.type === "case") {
    return { title: "新建案件", rows: [{ label: "名称", value: a.name }, { label: "类型", value: a.caseType }] };
  }
  const c = targetCase(w, a.case);
  const f = attachmentOf(w, a.file);
  rows.push({ label: "文件", value: f?.name ?? a.file });
  rows.push({ label: "存到案件", value: c?.name ?? a.case ?? "" });
  if (a.title) rows.push({ label: "Exhibit 标题", value: a.title });
  return {
    title: "把文件存进案件（打包时作为 Exhibit）",
    rows,
    problem: !f ? `这次对话里没有找到文件「${a.file}」，请重新上传` : !c ? (w.cases.length ? "不确定存到哪个案件，请告诉我案件名称" : "还没有案件，请先新建一个") : undefined,
  };
}

/* ---------- 应用 ---------- */

/**
 * 把操作应用到档案和案件上，返回新的数据。saveFile 还需要复制文件内容，
 * 所以返回 copy：调用方按它把 from 的内容另存为 to。
 */
export function apply(
  a: ChatAction,
  w: World,
): { profile?: Profile; cases?: ImmigrationCase[]; copy?: { from: string; to: string }; error?: string } {
  const problem = describe(a, w).problem;
  if (problem) return { error: problem };
  const now = Date.now();
  if (a.type === "profile") {
    return {
      profile: {
        ...w.profile,
        ...a.set,
        degrees: [...w.profile.degrees, ...a.addDegrees.map((d) => ({ ...d, id: uid() }))],
        enrolled: a.enrolled ? { ...a.enrolled, id: w.profile.enrolled?.id ?? uid() } : w.profile.enrolled,
        updatedAt: now,
      } as Profile,
    };
  }
  if (a.type === "soc") {
    const soc: Soc = { ...emptySoc(), ...w.profile.soc, ...a.set };
    for (const k of Object.keys(a.append) as SocTextKey[]) soc[k] = [soc[k].trim(), a.append[k]].filter(Boolean).join("\n");
    soc.projects = soc.projects.map((p) => ({ ...p }));
    for (const u of a.updateProjects) {
      const p = projectOf(soc, u.match);
      if (p) Object.assign(p, u.set);
    }
    soc.projects = [...soc.projects, ...a.addProjects.map((p) => ({ ...p, id: uid() }))];
    soc.reviews = [...soc.reviews, ...a.addReviews.map((r) => ({ ...r, id: uid() }))];
    return { profile: { ...w.profile, soc, updatedAt: now } };
  }
  if (a.type === "case") {
    const c: ImmigrationCase = { id: uid(), name: a.name, type: a.caseType, createdAt: now, done: [], files: [] };
    return { cases: [c, ...w.cases] };
  }
  const c = targetCase(w, a.case)!;
  const f = attachmentOf(w, a.file)!;
  // 案件里的文件名就是打包时 Exhibit 的默认标题，所以直接用标题当文件名
  const name = a.title ? a.title.replace(/[\\/:*?"<>|]/g, " ").slice(0, 150) + ext(f.name) : f.name;
  const copy: Attachment = { ...f, id: uid(), name };
  return {
    cases: w.cases.map((x) => (x.id === c.id ? { ...x, files: [...(x.files ?? []), copy] } : x)),
    copy: { from: f.id, to: copy.id },
  };
}

/* ---------- 给模型看的现状 ---------- */

/** 告诉模型档案里哪些项还空着、用户有哪些案件，方便它主动问和填 */
export function worldText(w: World): string {
  const p = w.profile;
  const soc = p.soc ?? emptySoc();
  const empty: string[] = [];
  (Object.keys(PROFILE_TEXT) as ProfileTextKey[])
    .filter((k) => !["fieldFrom", "fieldTo", "nextPaper", "scholarUrl", "s2Url"].includes(k) && !String(p[k] ?? "").trim())
    .forEach((k) => empty.push(PROFILE_TEXT[k]));
  if (!p.degrees.length) empty.push("已获学位");
  if (!p.reviews) empty.push("审稿次数");
  if (!p.sameField) empty.push("未来是否仍在同一领域");
  if (!p.activeResearch) empty.push("是否仍在做研究");
  (Object.keys(SOC_TEXT) as SocTextKey[]).filter((k) => !soc[k].trim()).forEach((k) => empty.push(`贡献总结·${SOC_TEXT[k]}`));
  if (!soc.projects.length) empty.push("贡献总结·主要贡献（项目）");
  if (!soc.reviews.length) empty.push("贡献总结·审稿记录");
  const lines = [`档案里还没填的项：${empty.length ? empty.join("、") : "无"}`];
  const filled = (Object.keys(SOC_TEXT) as SocTextKey[]).filter((k) => soc[k].trim()).map((k) => SOC_TEXT[k]);
  if (filled.length) lines.push(`贡献总结里已经有内容的项（要补充请用 append，不要用 set 覆盖）：${filled.join("、")}`);
  if (soc.projects.length) lines.push(`贡献总结里已有的项目：${soc.projects.map((x) => `「${x.title || "未命名"}」`).join("、")}`);
  lines.push(
    w.cases.length
      ? `用户的案件：${w.cases.map((c) => `「${c.name}」（${c.type}，${(c.files ?? []).length} 个文件）`).join("、")}`
      : "用户还没有新建任何案件",
  );
  if (w.attachments.length) lines.push(`这次对话里用户上传过的文件：${[...new Set(w.attachments.map((a) => a.name))].join("、")}`);
  return lines.join("\n");
}
