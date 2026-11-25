"use client";

import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Chat from "@/components/Chat";
import type { DocContext, Library } from "@/components/Chat";
import { isPaperFile } from "@/components/PaperFetch";
import { useAccount } from "@/lib/account";
import { fileIds } from "@/lib/sync";
import { workflowById } from "@/lib/skills";
import type { Workflow } from "@/lib/skills";
import type { Conversation, DocFile } from "@/lib/types";
import { DOC_KINDS } from "@/lib/docKinds";


// 这些工作流一开始就自动引用案件里的全部文件
const AUTO_CITE = new Set([
  "case-strength-assessor",
  "niw-petition-narrative",
  "eb1a-petition-narrative",
  "petition-audit",
  "form-guide",
  "cover-letter",
]);

const SUGGESTIONS = [
  "根据我的档案起草一份初稿",
  "先问我几个问题，再开始写",
  "检查全文有没有夸大或缺少证据支撑的表述",
];
// 个别种类的文档有更贴切的开场建议
const KIND_SUGGESTIONS: Record<string, string[]> = {
  "Proposed Endeavor 陈述": [
    "把这些要点写成一份正式的英文 Proposed Endeavor 陈述，缺的信息先问我",
    "帮我看看「要做的事」那句话够不够具体，给我两三个写法比较",
    "检查计划和我已有的成果是否接得上，哪些地方还缺证据",
  ],
};

/** 文档列表：新建 + 已有文档 */
export function DocList({
  docs,
  onCreate,
  onOpen,
  workflows,
  onWorkflow,
}: {
  docs: DocFile[];
  onCreate?: (kind: string) => void;
  onOpen: (id: string) => void;
  workflows?: Workflow[];
  onWorkflow?: (w: Workflow) => void;
}) {
  return (
    <>
      {docs.length > 0 && (
        <>
          {onCreate && <h3 className="section-title">已有文档</h3>}
          <div className="case-list">
            {[...docs]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((d) => (
                <button key={d.id} className="case-card" onClick={() => onOpen(d.id)}>
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
      {workflows && onWorkflow && (
        <>
          <h3 className="section-title">AI 工作流（按专业流程一步步带你做）</h3>
          <div className="case-list">
            {workflows.map((w) => (
              <button key={w.id} className="case-card workflow" onClick={() => onWorkflow(w)}>
                <strong>{w.title}</strong>
                <span className="case-meta">{w.desc}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {onCreate && (
        <>
          <h3 className="section-title">新建空白文档</h3>
          <div className="case-list">
            {DOC_KINDS.map((k) => (
              <button key={k.kind} className="case-card" onClick={() => onCreate(k.kind)}>
                <strong>+ {k.kind}</strong>
                <span className="case-meta">{k.desc}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

type WorkspaceProps = {
  doc: DocFile;
  patch: (fn: (d: DocFile) => DocFile) => void;
  onBack: () => void;
  onDelete: () => void;
  backLabel: string;
  library?: Library;
  contextLine?: string;
  caseType?: string;
  profileText: string;
  endeavorReady?: boolean; // 档案里已经填了拟从事事业
};

/** 文档工作区：左边文档，右边聊天 */
export function DocWorkspace({
  doc,
  patch,
  onBack,
  onDelete,
  backLabel,
  library,
  contextLine,
  caseType,
  profileText,
  endeavorReady,
}: WorkspaceProps) {
  const workflow = workflowById(doc.skill);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [pane, setPane] = useState<"doc" | "chat">("doc"); // 窄屏时切换
  const [copied, setCopied] = useState(false);
  const [chatRound, setChatRound] = useState(0); // 清空对话后换一个新的聊天框
  const account = useAccount();

  // 流式输出期间 Chat 需要读到最新内容，而不是发消息那一刻的闭包
  const latest = useRef({ content: doc.content, snapshotted: false, patch });
  latest.current.content = doc.content;
  latest.current.patch = patch;

  const ctx: DocContext = useMemo(
    () => ({
      title: doc.title,
      kind: doc.kind,
      skill: doc.skill,
      caseType,
      getContent: () => latest.current.content,
      beginTurn: () => {
        latest.current.snapshotted = false;
      },
      setContent: (content: string) => {
        const first = !latest.current.snapshotted;
        const before = latest.current.content;
        latest.current.snapshotted = true;
        latest.current.content = content;
        latest.current.patch((d) => ({
          ...d,
          content,
          updatedAt: Date.now(),
          undo: first ? before : d.undo,
          redo: undefined,
        }));
      },
    }),
    [doc.title, doc.kind, doc.skill, caseType],
  );

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
          <button className="back" onClick={onBack}>
            ← {backLabel}
          </button>
          <input
            className="doc-title"
            value={doc.title}
            aria-label="文档标题"
            onChange={(e) => patch((d) => ({ ...d, title: e.target.value, updatedAt: Date.now() }))}
          />
          <div className="doc-actions">
            {/* 撤销和恢复互为反操作：点哪个都不会丢内容，点错了再点一次另一个就回来 */}
            {doc.undo !== undefined && (
              <button
                className="btn-ghost small"
                title="回到 AI 上一次修改之前的内容（之后可以再恢复）"
                onClick={() => patch((d) => ({ ...d, content: d.undo ?? d.content, undo: undefined, redo: d.content, updatedAt: Date.now() }))}
              >
                ↩ 撤销 AI 修改
              </button>
            )}
            {doc.undo === undefined && doc.redo !== undefined && (
              <button
                className="btn-ghost small"
                title="回到撤销之前的内容"
                onClick={() => patch((d) => ({ ...d, content: d.redo ?? d.content, redo: undefined, undo: d.content, updatedAt: Date.now() }))}
              >
                ↪ 恢复
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
                if (confirm(`删除文档「${doc.title}」？此操作无法撤销。`)) onDelete();
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
              placeholder={"在这里直接写，或者在右边让 AI 起草。写了内容之后文档才会保存。\n\n支持 Markdown：# 标题、**加粗**、- 列表"}
              onChange={(e) => patch((d) => ({ ...d, content: e.target.value, updatedAt: Date.now() }))}
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
        {doc.chat.length > 0 && (
          <button
            className="link clear-chat"
            title="文档内容不受影响。对话太长、或者带了发不出去的文件时可以清空重来"
            onClick={() => {
              if (!confirm("清空这份文档右边的对话记录？文档内容不受影响。")) return;
              account.releaseFiles(fileIds(doc.chat));
              patch((d) => ({ ...d, chat: [] }));
              setChatRound((n) => n + 1);
            }}
          >
            清空对话
          </button>
        )}
        <Chat
          key={`${doc.id}:${chatRound}`}
          conv={conv}
          addConv={() => {}}
          patchConv={(_, fn) =>
            patch((d) => ({
              ...d,
              chat: fn({ id: d.id, title: d.title, updatedAt: d.updatedAt, messages: d.chat }).messages,
            }))
          }
          profileText={profileText}
          firstName=""
          docCtx={ctx}
          library={library}
          // 自动带上案件里的材料，但不带一键下载的论文全文：十几篇论文每轮对话都发一遍，又慢又贵；要用哪篇可以手动引用
          initialPending={workflow && AUTO_CITE.has(workflow.id) ? library?.files.filter((f) => !isPaperFile(f)) : undefined}
          contextLine={contextLine}
          intro={
            workflow
              ? {
                  title: workflow.title,
                  desc: workflow.hint,
                  suggestions: [
                    // 拟从事事业已经在档案里填过，就不再让 AI 从头问一遍
                    workflow.id === "niw-petition-narrative" && endeavorReady
                      ? "我的拟从事事业已经填在档案里了。请先检查起草还缺哪些关键信息，一次问完，信息够了再开始写。"
                      : workflow.starter,
                  ],
                }
              : {
                  title: `和 AI 一起写「${doc.kind}」`,
                  desc: "它能看到左边文档的最新内容，并直接在文档里起草和修改。点「引用」可以把案件里的文件和其他文档给它看。",
                  suggestions: KIND_SUGGESTIONS[doc.kind] ?? SUGGESTIONS,
                }
          }
        />
      </section>
    </div>
  );
}
