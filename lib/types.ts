export type Attachment = {
  id: string;
  name: string;
  type: string; // MIME
  size: number;
  title?: string; // 完整的标题（比如论文题目；文件名里放不下、也不能带冒号问号），打包时用它做 Exhibit 的标题
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: Attachment[];
  actions?: import("./actions").ActionItem[]; // AI 提出的操作（填档案、建案件、存文件），用户确认后才生效
};

export type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  caseId?: string; // 关联的案件
};

export type DocFile = {
  id: string;
  title: string;
  kind: string;
  content: string; // Markdown
  updatedAt: number;
  chat: ChatMessage[];
  undo?: string; // AI 上一次修改之前的内容
  redo?: string; // 点了「撤销」之后，被撤掉的那一版（可以再恢复回来）
  caseId?: string; // 所属案件
  skill?: string; // 用哪个 AI 工作流（见 lib/skills.ts）
};

/** 打包下载的设置 */
export type PackConfig = {
  order: string[]; // 材料顺序
  skip: string[]; // 不放进包里的
  keep?: string[]; // 默认不放进包里（工作底稿）、但用户勾选了要放的
  titles: Record<string, string>; // 目录里显示的标题
  roles: Record<string, "body" | "exhibit">;
};

export type CaseType = "NIW" | "EB-1A";

export type ImmigrationCase = {
  id: string;
  name: string;
  type: CaseType;
  createdAt: number;
  done: string[]; // 已完成的材料项 id
  files?: Attachment[]; // 案件文件（内容存在 IndexedDB）
  pack?: PackConfig;
  claims?: string[]; // 申报条件：选择主张的标准（见 lib/claims.ts）
  eb2?: "advanced" | "exceptional"; // NIW：按高等学位还是特殊能力满足 EB-2
  guide?: Record<string, "done" | "skip">; // 申请向导里用户手动标记的步骤
  packedAt?: number; // 上一次生成打包 PDF 的时间
};

/** 发给 /api/chat 的消息结构 */
export type ApiMessage = {
  role: "user" | "assistant";
  text: string;
  attachments?: { name: string; type: string; data?: string }[]; // data 为 base64
};

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- 读出存档（本机的或云端的）时补齐字段，丢掉不成形的项 ---------- */

type Raw = Record<string, unknown>;
const isObj = (x: unknown): x is Raw => typeof x === "object" && x !== null && !Array.isArray(x);
const text = (x: unknown) => (typeof x === "string" ? x : x === null || x === undefined ? "" : String(x));
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const same = <T,>(a: T[], b: unknown) => (Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]) ? (b as T[]) : a);

function attachments(x: unknown): Attachment[] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x.filter((a): a is Attachment => isObj(a) && typeof a.id === "string" && typeof a.name === "string" && typeof a.type === "string" && typeof a.size === "number");
}

function messages(x: unknown): ChatMessage[] {
  return list(x)
    .filter((m): m is Raw => isObj(m) && typeof m.id === "string" && (m.role === "user" || m.role === "assistant"))
    .map((m) => (typeof m.text === "string" && (m.attachments === undefined || Array.isArray(m.attachments)) ? (m as unknown as ChatMessage) : ({ ...m, text: text(m.text), attachments: attachments(m.attachments) } as unknown as ChatMessage)));
}

/** 形状没问题的项原样返回（同一个对象），所以没有变化时不会触发多余的保存和重新渲染 */
export function normalizeCases(x: unknown): ImmigrationCase[] {
  const out = list(x)
    .filter((c): c is Raw => isObj(c) && typeof c.id === "string")
    .map((c) =>
      typeof c.name === "string" && (c.type === "NIW" || c.type === "EB-1A") && Array.isArray(c.done) && (c.files === undefined || Array.isArray(c.files))
        ? (c as unknown as ImmigrationCase)
        : ({ ...c, name: text(c.name) || "案件", type: c.type === "EB-1A" ? "EB-1A" : "NIW", createdAt: Number(c.createdAt) || 0, done: list(c.done).filter((d) => typeof d === "string"), files: attachments(c.files) ?? [] } as unknown as ImmigrationCase),
    );
  return same(out, x);
}

export function normalizeDocs(x: unknown): DocFile[] {
  const out = list(x)
    .filter((d): d is Raw => isObj(d) && typeof d.id === "string")
    .map((d) =>
      typeof d.title === "string" && typeof d.kind === "string" && typeof d.content === "string" && Array.isArray(d.chat)
        ? (d as unknown as DocFile)
        : ({ ...d, title: text(d.title), kind: text(d.kind) || "其他文档", content: text(d.content), updatedAt: Number(d.updatedAt) || 0, chat: messages(d.chat) } as unknown as DocFile),
    );
  return same(out, x);
}

export function normalizeConversations(x: unknown): Conversation[] {
  const out = list(x)
    .filter((c): c is Raw => isObj(c) && typeof c.id === "string")
    .map((c) =>
      typeof c.title === "string" && typeof c.updatedAt === "number" && Array.isArray(c.messages)
        ? (c as unknown as Conversation)
        : ({ ...c, title: text(c.title) || "会话", updatedAt: Number(c.updatedAt) || 0, messages: messages(c.messages) } as unknown as Conversation),
    );
  return same(out, x);
}
