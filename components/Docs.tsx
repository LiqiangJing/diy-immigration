"use client";

import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Chat from "@/components/Chat";
import type { DocContext } from "@/components/Chat";
import { uid } from "@/lib/types";
import type { Conversation, DocFile } from "@/lib/types";

export const DOC_KINDS = [
  { kind: "Petition Letter", desc: "申请信，整个案件的核心论证" },
  { kind: "推荐信", desc: "Recommendation Letter 草稿" },
  { kind: "Proposed Endeavor 陈述", desc: "NIW 拟从事事业的说明" },
  { kind: "Summary of Contributions", desc: "个人贡献总结" },
  { kind: "其他文档", desc: "RFE 回复、个人陈述等" },
];

const SUGGESTIONS = [
  "根据我的档案起草一份初稿",
  "先问我几个问题，再开始写",
  "检查全文有没有夸大或缺少证据支撑的表述",
];

type Props = {
  docs: DocFile[];
  setDocs: React.Dispatch<React.SetStateAction<DocFile[]>>;
  fileData: Map<string, string>;
  profileText: string;
};

export default function Docs({ docs, setDocs, fileData, profileText }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [pane, setPane] = useState<"doc" | "chat">("doc"); // 窄屏时切换
  const [copied, setCopied] = useState(false);

  const doc = docs.find((d) => d.id === openId) ?? null;
  // 流式输出期间 Chat 需要读到最新内容，而不是发消息那一刻的闭包
  const latest = useRef({ content: "", snapshotted: false });
  if (doc) latest.current.content = doc.content;

  const patch = (id: string, fn: (d: DocFile) => DocFile) =>
    setDocs((list) => list.map((d) => (d.id === id ? fn(d) : d)));

  const ctx: DocContext | undefined = useMemo(() => {
    if (!doc) return undefined;
    const id = doc.id;
    return {
      title: doc.title,
      kind: doc.kind,
      getContent: () => latest.current.content,
      beginTurn: () => {
        latest.current.snapshotted = false;
      },
      setContent: (content: string) => {
        const first = !latest.current.snapshotted;
        const before = latest.current.content;
        latest.current.snapshotted = true;
        latest.current.content = content;
        patch(id, (d) => ({
          ...d,
          content,
          updatedAt: Date.now(),
          undo: first ? before : d.undo,
        }));
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, doc?.title, doc?.kind]);

  function create(kind: string) {
    const d: DocFile = { id: uid(), title: kind, kind, content: "", updatedAt: Date.now(), chat: [] };
    setDocs((list) => [d, ...list]);
    setOpenId(d.id);
    setMode("edit");
  }

  if (!doc || !ctx) {
    return (
      <div className="cases">
        <div className="case-head">
          <div>
            <h2>文档</h2>
            <p>在这里写申请文书：左边是文档，右边和 AI 对话，它会直接在文档里起草和修改。</p>
          </div>
        </div>
        <h3 className="section-title">新建文档</h3>
        <div className="case-list">
          {DOC_KINDS.map((k) => (
            <button key={k.kind} className="case-card" onClick={() => create(k.kind)}>
              <strong>+ {k.kind}</strong>
              <span className="case-meta">{k.desc}</span>
            </button>
          ))}
        </div>
        {docs.length > 0 && (
          <>
            <h3 className="section-title">我的文档</h3>
            <div className="case-list">
              {[...docs]
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((d) => (
                  <button key={d.id} className="case-card" onClick={() => setOpenId(d.id)}>
                    <span className="tag">{d.kind}</span>
                    <strong>{d.title}</strong>
                    <span className="case-meta">
                      {d.content.length} 字符 · 更新于 {new Date(d.updatedAt).toLocaleString("zh-CN")}
                    </span>
                  </button>
                ))}
            </div>
          </>
        )}
      </div>
    );
  }

  const conv: Conversation = { id: doc.id, title: doc.title, updatedAt: doc.updatedAt, messages: doc.chat };

  return (
    <div className={`workspace show-${pane}`}>
      <div className="pane-tabs">
        <button className={pane === "doc" ? "on" : ""} onClick={() => setPane("doc")}>
          文档
        </button>
        <button className={pane === "chat" ? "on" : ""} onClick={() => setPane("chat")}>
          聊天
        </button>
      </div>

      <section className="doc-pane">
        <div className="doc-bar">
          <button className="back" onClick={() => setOpenId(null)}>
            ← 全部文档
          </button>
          <input
            className="doc-title"
            value={doc.title}
            aria-label="文档标题"
            onChange={(e) => patch(doc.id, (d) => ({ ...d, title: e.target.value, updatedAt: Date.now() }))}
          />
          <div className="doc-actions">
            {doc.undo !== undefined && (
              <button
                className="btn-ghost small"
                title="恢复到 AI 上一次修改之前的内容"
                onClick={() => patch(doc.id, (d) => ({ ...d, content: d.undo ?? d.content, undo: undefined }))}
              >
                ↩ 撤销 AI 修改
              </button>
            )}
            <div className="seg small">
              <button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>
                编辑
              </button>
              <button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>
                预览
              </button>
            </div>
            <button
              className="btn-ghost small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(doc.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {}
              }}
            >
              {copied ? "已复制" : "复制"}
            </button>
            <button
              className="btn-ghost small"
              onClick={() => {
                const url = URL.createObjectURL(new Blob([doc.content], { type: "text/markdown" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = `${doc.title || "document"}.md`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              下载
            </button>
            <button
              className="btn-ghost small danger"
              onClick={() => {
                if (!confirm(`删除文档「${doc.title}」？此操作无法撤销。`)) return;
                setDocs((list) => list.filter((d) => d.id !== doc.id));
                setOpenId(null);
              }}
            >
              删除
            </button>
          </div>
        </div>

        <div className="doc-body">
          {mode === "edit" ? (
            <textarea
              className="doc-editor"
              value={doc.content}
              placeholder={"在这里直接写，或者在右边让 AI 起草。\n\n支持 Markdown：# 标题、**加粗**、- 列表"}
              onChange={(e) => patch(doc.id, (d) => ({ ...d, content: e.target.value, updatedAt: Date.now() }))}
            />
          ) : doc.content.trim() ? (
            <div className="doc-preview md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
            </div>
          ) : (
            <div className="doc-preview doc-empty">文档还是空的。</div>
          )}
        </div>
      </section>

      <section className="chat-pane">
        <Chat
          key={doc.id}
          conv={conv}
          addConv={() => {}}
          patchConv={(_, fn) =>
            patch(doc.id, (d) => ({
              ...d,
              chat: fn({ id: d.id, title: d.title, updatedAt: d.updatedAt, messages: d.chat }).messages,
            }))
          }
          fileData={fileData}
          profileText={profileText}
          firstName=""
          docCtx={ctx}
          intro={{
            title: `和 AI 一起写「${doc.kind}」`,
            desc: "它能看到左边文档的最新内容，并直接在文档里起草和修改。",
            suggestions: SUGGESTIONS,
          }}
        />
      </section>
    </div>
  );
}
