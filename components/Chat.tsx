"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { uid } from "@/lib/types";
import type { ApiMessage, Attachment, ChatMessage, Conversation } from "@/lib/types";

const SUGGESTIONS = [
  "NIW 和 EB-1A 我更适合哪个？",
  "帮我评估一下我的背景有哪些薄弱点",
  "EB-1A 十项标准我可能满足哪几项？",
  "从准备到递交大概要多久？",
];

const ACCEPT = ".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.gif";
const MAX_FILE = 20 * 1024 * 1024;
const TEXT_EXT = /\.(txt|md)$/i;

function mimeOf(f: File): string | null {
  if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) return "application/pdf";
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(f.type)) return f.type;
  if (f.type.startsWith("text/") || TEXT_EXT.test(f.name)) return "text/plain";
  return null;
}

function toBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

const fmtSize = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

type Props = {
  conv: Conversation | null;
  addConv: (c: Conversation) => void;
  patchConv: (id: string, fn: (c: Conversation) => Conversation) => void;
  fileData: Map<string, string>;
  profileText: string;
  firstName: string;
};

export default function Chat({ conv, addConv, patchConv, fileData, profileText, firstName }: Props) {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const messages = conv?.messages ?? [];

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, messages[messages.length - 1]?.text]);

  async function addFiles(files: FileList | File[]) {
    const problems: string[] = [];
    const added: Attachment[] = [];
    for (const f of Array.from(files)) {
      const type = mimeOf(f);
      if (!type) {
        problems.push(`「${f.name}」格式暂不支持（目前支持 PDF、图片、TXT、Markdown）`);
        continue;
      }
      if (f.size > MAX_FILE) {
        problems.push(`「${f.name}」超过 20 MB`);
        continue;
      }
      try {
        const id = uid();
        fileData.set(id, await toBase64(f));
        added.push({ id, name: f.name, type, size: f.size });
      } catch {
        problems.push(`「${f.name}」读取失败`);
      }
    }
    if (added.length) setPending((p) => [...p, ...added]);
    setNotice(problems.join("；"));
  }

  async function send(text: string) {
    text = text.trim();
    if (busy || (!text && pending.length === 0)) return;

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
    const setBot = (fn: (prev: string) => string) =>
      patchConv(id, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === botMsg.id ? { ...m, text: fn(m.text) } : m)),
      }));

    setInput("");
    setPending([]);
    setNotice("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;

    const payload: ApiMessage[] = history
      .filter((m) => m.text.trim() || m.attachments?.length)
      .map((m) => ({
        role: m.role,
        text: m.text,
        attachments: m.attachments?.map((a) => ({
          name: a.name,
          type: a.type,
          data: fileData.get(a.id),
        })),
      }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload, profile: profileText }),
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
        if (chunk) setBot((prev) => prev + chunk);
      }
    } catch (e) {
      if (ctrl.signal.aborted) {
        setBot((prev) => prev + (prev ? "\n\n" : "") + "> 已停止生成。");
      } else {
        const msg = e instanceof Error ? e.message : "请求失败";
        setBot((prev) => prev + (prev ? "\n\n" : "") + `> ⚠️ ${msg}`);
      }
    } finally {
      setBusy(false);
      abort.current = null;
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
                onClick={() => {
                  fileData.delete(a.id);
                  setPending((p) => p.filter((x) => x.id !== a.id));
                }}
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
        placeholder="关于 NIW / EB-1A 的一切，尽管问。可以拖入或上传简历、推荐信等材料"
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
      <div className="chat chat-empty">
        <div className="hero">
          <h1>你好{firstName ? ` ${firstName}` : ""}，我是 DIY Immigration</h1>
          <p>帮你自己准备 NIW 和 EB-1A 申请：评估背景、分析材料、修改文书</p>
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="composer-wrap">
          {composer}
          <div className="disclaimer">AI 生成内容仅供参考，不构成法律意见，请核实重要信息</div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat">
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
        <div className="disclaimer">AI 生成内容仅供参考，不构成法律意见，请核实重要信息</div>
      </div>
    </div>
  );
}
