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
};

export type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
};

export type CaseType = "NIW" | "EB-1A";

export type ImmigrationCase = {
  id: string;
  name: string;
  type: CaseType;
  createdAt: number;
  done: string[]; // 已完成的材料项 id
};

/** 发给 /api/chat 的消息结构 */
export type ApiMessage = {
  role: "user" | "assistant";
  text: string;
  attachments?: { name: string; type: string; data?: string }[]; // data 为 base64
};

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
