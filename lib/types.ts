export type Attachment = {
  id: string;
  name: string;
  type: string; // MIME
  size: number;
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
  caseId?: string; // 所属案件
  skill?: string; // 用哪个 AI 工作流（见 lib/skills.ts）
};

/** 打包下载的设置 */
export type PackConfig = {
  order: string[]; // 材料顺序
  skip: string[]; // 不放进包里的
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
};

/** 发给 /api/chat 的消息结构 */
export type ApiMessage = {
  role: "user" | "assistant";
  text: string;
  attachments?: { name: string; type: string; data?: string }[]; // data 为 base64
};

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
