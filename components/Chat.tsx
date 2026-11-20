"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { uid } from "@/lib/types";
import type { ApiMessage, Attachment, ChatMessage, Conversation } from "@/lib/types";
import { ACCEPT, fmtSize, getFile, putFile, saveUploads, textToBase64 } from "@/lib/files";
import { useAccount } from "@/lib/account";
import { applyEdits, liveWrite, parseEdits, stripDocBlocks } from "@/lib/docEdits";

/** 在文档工作区里使用时，Chat 通过它读写左侧的文档 */
export type DocContext = {
  title: string;
  kind: string;
  skill?: string;
  caseType?: string;
  getContent: () => string;
  setContent: (content: string) => void;
  beginTurn: () => void;
};

const SUGGESTIONS = [
  "NIW 和 EB-1A 我更适合哪个？",
  "帮我评估一下我的背景有哪些薄弱点",
  "EB-1A 十项标准我可能满足哪几项？",
  "从准备到递交大概要多久？",
];

/** 聊天里可以引用的案件资料 */
export type Library = {
  files: Attachment[];
  docs: { id: string; title: string; content: string }[];
};

type Props = {
  conv: Conversation | null;
  addConv: (c: Conversation) => void;
  patchConv: (id: string, fn: (c: Conversation) => Conversation) => void;
  profileText: string;
  firstName: string;
  docCtx?: DocContext;
  intro?: { title: string; desc: string; suggestions: string[] };
  library?: Library;
  /** 会话还是空的时候，预先放进输入框的附件（例如工作流自动引用案件的全部文件） */
  initialPending?: Attachment[];
  contextLine?: string; // 例如「当前案件：xxx（NIW）」，会随档案一起发给模型
  caseLink?: {
    cases: { id: string; name: string }[];
    value: string | null;
    onChange: (id: string | null) => void;
  };
};

export default function Chat({
  conv,
  addConv,
  patchConv,
  profileText,
  firstName,
  docCtx,
  intro,
  library,
  initialPending,
  contextLine,
  caseLink,
}: Props) {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Attachment[]>(() =>
    conv?.messages.length ? [] : (initialPending ?? []),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [picking, setPicking] = useState(false);
  const account = useAccount();
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const messages = conv?.messages ?? [];

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, messages[messages.length - 1]?.text]);

  async function addFiles(files: FileList | File[]) {
    const { added, problems } = await saveUploads(files);
    if (added.length) setPending((p) => [...p, ...added]);
    setNotice(problems.join("；"));
  }

  const addPending = (a: Attachment) =>
    setPending((p) => (p.some((x) => x.id === a.id) ? p : [...p, a]));

  // 引用案件里的文档：把它此刻的内容存成一个文本附件
  async function citeDoc(d: Library["docs"][number]) {
    const att: Attachment = {
      id: uid(),
      name: `${d.title || "文档"}.md`,
      type: "text/plain",
      size: new Blob([d.content]).size,
    };
    await putFile(att.id, textToBase64(d.content));
    addPending(att);
  }

  async function send(text: string) {
    text = text.trim();
    if (busy || (!text && pending.length === 0)) return;
    if (!account.guard()) return;

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      text,
      attachments: pending.length ? pending : undefined,
    };
    const botMsg: ChatMessage = { id: uid(), role: "assistant", text: "" };
    const history = [...messages, userMsg];

    let convId = conv?.id;
    if (convId) {
      patchConv(convId, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: [...c.messages, userMsg, botMsg],
      }));
    } else {
      convId = uid();
      addConv({
        id: convId,
        title: (text || pending[0]?.name || "新会话").slice(0, 24),
        updatedAt: Date.now(),
        messages: [userMsg, botMsg],
      });
    }
    const id = convId;
    const setBot = (text: string) =>
      patchConv(id, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === botMsg.id ? { ...m, text } : m)),
      }));

    setInput("");
    setPending([]);
    setNotice("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;

    const payload: ApiMessage[] = await Promise.all(
      history
        .filter((m) => m.text.trim() || m.attachments?.length)
        .map(async (m) => ({
          role: m.role,
          text: m.text,
          attachments:
            m.attachments &&
            (await Promise.all(
              m.attachments.map(async (a) => ({
                name: a.name,
                type: a.type,
                data: await getFile(a.id),
              })),
            )),
        })),
    );

    let raw = "";
    let suffix = "";
    // 文档模式下，回复里的文档标签不显示在聊天里
    const visible = () =>
      docCtx ? stripDocBlocks(raw) || (raw.includes("<doc_") ? "_正在修改文档…_" : "") : raw;
    docCtx?.beginTurn();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: payload,
          profile: [profileText, contextLine].filter(Boolean).join("\n"),
          doc: docCtx
            ? {
                title: docCtx.title,
                kind: docCtx.kind,
                skill: docCtx.skill,
                caseType: docCtx.caseType,
                content: docCtx.getContent(),
              }
            : undefined,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `请求失败（${res.status}）`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        raw += chunk;
        if (docCtx) {
          const written = liveWrite(raw);
          if (written !== null) docCtx.setContent(written);
        }
        setBot(visible());
      }
    } catch (e) {
      suffix = ctrl.signal.aborted
        ? "\n\n> 已停止生成。"
        : `\n\n> ⚠️ ${e instanceof Error ? e.message : "请求失败"}`;
    } finally {
      let body = raw;
      if (docCtx) {
        const notes: string[] = [];
        if (liveWrite(raw) !== null) notes.push("已写入文档");
        const edits = parseEdits(raw);
        if (edits.length) {
          const r = applyEdits(docCtx.getContent(), edits);
          if (r.applied) {
            docCtx.setContent(r.content);
            notes.push(`已修改文档 ${r.applied} 处`);
          }
          if (r.failed) notes.push(`有 ${r.failed} 处修改没能在文档里定位到原文，已跳过`);
        }
        body = stripDocBlocks(raw);
        if (notes.length) body += `\n\n> ✏️ ${notes.join("；")}（可在文档上方撤销）`;
      }
      setBot((body + suffix).trim());
      setBusy(false);
      abort.current = null;
      account.refresh(); // 更新余额
    }
  }

  const empty = messages.length === 0;

  const composer = (
    <div
      className={`composer ${dragging ? "drag" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      {pending.length > 0 && (
        <div className="chips">
          {pending.map((a) => (
            <span key={a.id} className="chip">
              <span className="chip-name">{a.name}</span>
              <span className="chip-size">{fmtSize(a.size)}</span>
              <button
                aria-label={`移除 ${a.name}`}
                onClick={() => setPending((p) => p.filter((x) => x.id !== a.id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        value={input}
        rows={2}
        placeholder={
          docCtx
            ? "告诉 AI 怎么写、怎么改，比如「把第二段改得更具体」"
            : "关于 NIW / EB-1A 的一切，尽管问。可以拖入或上传简历、推荐信等材料"
        }
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send(input);
          }
        }}
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            addFiles(e.clipboardData.files);
          }
        }}
      />
      <div className="composer-bar">
        <button className="attach" onClick={() => fileInput.current?.click()} title="上传文件">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l9-9a3.7 3.7 0 015.2 5.2l-9 9a1.8 1.8 0 01-2.6-2.6l8.3-8.3" />
          </svg>
          <span>上传文件</span>
        </button>
        {library && (
          <div className="picker-wrap">
            <button className="attach" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
              @ <span>引用案件资料</span>
            </button>
            {picking && (
              <div className="picker">
                {library.files.length + library.docs.length === 0 && (
                  <div className="picker-empty">这个案件里还没有文件或其他文档。</div>
                )}
                {library.docs.length > 0 && <div className="picker-label">文档</div>}
                {library.docs.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      citeDoc(d);
                      setPicking(false);
                    }}
                  >
                    {d.title || "未命名文档"}
                  </button>
                ))}
                {library.files.length > 0 && <div className="picker-label">文件</div>}
                {library.files.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      addPending(f);
                      setPicking(false);
                    }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {caseLink && caseLink.cases.length > 0 && (
          <select
            className="case-link"
            aria-label="关联案件"
            value={caseLink.value ?? ""}
            onChange={(e) => caseLink.onChange(e.target.value || null)}
          >
            <option value="">不关联案件</option>
            {caseLink.cases.map((c) => (
              <option key={c.id} value={c.id}>
                关联：{c.name}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept={ACCEPT}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {busy ? (
          <button className="send stop" onClick={() => abort.current?.abort()} aria-label="停止生成">
            ■
          </button>
        ) : (
          <button
            className="send"
            disabled={!input.trim() && pending.length === 0}
            onClick={() => send(input)}
            aria-label="发送"
          >
            ↑
          </button>
        )}
      </div>
      {notice && <div className="notice">{notice}</div>}
    </div>
  );

  if (empty) {
    return (
      <div className={`chat chat-empty ${docCtx ? "compact" : ""}`}>
        <div className="hero">
          <h1>{intro?.title ?? `你好${firstName ? ` ${firstName}` : ""}，我是 DIY Immigration`}</h1>
          <p>{intro?.desc ?? "帮你自己准备 NIW 和 EB-1A 申请：评估背景、分析材料、修改文书"}</p>
          <div className="suggestions">
            {(intro?.suggestions ?? SUGGESTIONS).map((s) => (
              <button key={s} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="composer-wrap">
          {composer}
        </div>
      </div>
    );
  }

  return (
    <div className={`chat ${docCtx ? "compact" : ""}`}>
      <div className="messages">
        <div className="messages-inner">
          {messages.map((m, i) => (
            <div key={m.id} className={`msg ${m.role}`}>
              {m.attachments && (
                <div className="chips">
                  {m.attachments.map((a) => (
                    <span key={a.id} className="chip">
                      <span className="chip-name">{a.name}</span>
                      <span className="chip-size">{fmtSize(a.size)}</span>
                    </span>
                  ))}
                </div>
              )}
              {m.role === "user" ? (
                m.text && <div className="bubble">{m.text}</div>
              ) : m.text ? (
                <div className="md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                </div>
              ) : busy && i === messages.length - 1 ? (
                <div className="typing" aria-label="正在思考">
                  <i />
                  <i />
                  <i />
                </div>
              ) : null}
            </div>
          ))}
          <div ref={bottom} />
        </div>
      </div>
      <div className="composer-wrap">
        {composer}
      </div>
    </div>
  );
}
