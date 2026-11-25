"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { uid } from "@/lib/types";
import type { ApiMessage, Attachment, ChatMessage, Conversation } from "@/lib/types";
import { ACCEPT, fmtSize, getFile, putFile, saveUploads, textToBase64 } from "@/lib/files";
import { useAccount } from "@/lib/account";
import { applyEdits, liveWrite, parseEdits, stripDocBlocks } from "@/lib/docEdits";
import { apply, describe, irreversible, placeOf, readActions, stripActions, worldText } from "@/lib/actions";
import { diff, revert } from "@/lib/undo";
import { splitNotice } from "@/lib/notice";
import type { ActionItem, Place, World } from "@/lib/actions";
import type { Profile } from "@/lib/profile";
import type { DocFile, ImmigrationCase } from "@/lib/types";

/** 让聊天可以替用户操作系统（改档案、案件、文档、会话）；每个操作都要用户确认 */
export type Ops = {
  profile: Profile;
  cases: ImmigrationCase[];
  docs: DocFile[];
  linkedCaseId: string | null;
  convs: { id: string; title: string }[]; // 除了现在这个之外的会话
  commit: (r: { profile?: Profile; cases?: ImmigrationCase[]; docs?: DocFile[] }) => void;
  open: (place: Place) => void; // 跳到被修改的那一页
  newChat: (o: { title: string; caseId?: string }) => void;
  deleteChat: (id: string) => void;
};

/** 应用之后卡片上留的内容：太长的截短，免得每条会话里都存一大份 */
const brief = (rows: { label: string; value: string; danger?: boolean }[]) =>
  rows.map((r) => ({ label: r.label, value: r.value.length > 1500 ? `${r.value.slice(0, 1500)}…` : r.value, danger: r.danger }));

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
  "帮我通过聊天把档案填好",
  "帮我梳理 NIW 的拟从事事业",
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
  ops?: Ops;
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
  ops,
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
  const allAttachments = (list: ChatMessage[]) => list.flatMap((m) => m.attachments ?? []);
  /** msg：正在看的是哪一条回复的卡片。它里面还没应用的「新建案件」要记下来，存文件的卡片得等它 */
  const world = (list: ChatMessage[] = messages, msg?: ChatMessage): World | null =>
    ops
      ? {
          profile: ops.profile,
          cases: ops.cases,
          docs: ops.docs,
          linkedCaseId: ops.linkedCaseId,
          conv: conv ? { id: conv.id, title: conv.title, caseId: conv.caseId } : null,
          convs: ops.convs,
          attachments: allAttachments(list),
          creating: (msg?.actions ?? []).flatMap((x) => (x.status === "pending" && x.action.type === "case" ? [x.action.name] : [])),
        }
      : null;

  /** 用户点了「应用」：依次执行，前一个的结果（比如新建的案件）后一个能用上 */
  const applying = useRef(false);
  async function runActions(msgId: string, ids: string[]) {
    if (!ops || !conv || applying.current) return; // 正在应用时不重复执行（连点两下）
    applying.current = true;
    try {
      const w = world(messages, messages.find((m) => m.id === msgId))!;
      const start = { profile: w.profile, cases: w.cases, docs: w.docs, title: conv.title, caseId: conv.caseId };
      // 撤销时要对照的那几份数据
      const snap = () => ({ profile: w.profile, cases: w.cases, docs: w.docs ?? [], conv: { title: w.conv?.title, caseId: w.conv?.caseId } });
      const release: string[] = [];
      const effects: NonNullable<ReturnType<typeof apply>["effect"]>[] = [];
      const done: Record<string, Pick<ActionItem, "status" | "note" | "place" | "undo" | "shown">> = {};
      for (const item of messages.find((m) => m.id === msgId)?.actions ?? []) {
        if (!ids.includes(item.id) || item.status !== "pending" || item.action.type === "go") continue;
        const before = snap();
        const card = describe(item.action, w);
        const r = apply(item.action, w);
        if (r.error) {
          done[item.id] = { status: "pending", note: r.error };
          continue;
        }
        if (r.copy) {
          const data = await getFile(r.copy.from);
          if (!data) {
            done[item.id] = { status: "pending", note: "文件内容已经不在了，请重新上传。" };
            continue;
          }
          await putFile(r.copy.to, data);
        }
        if (r.profile) w.profile = r.profile;
        if (r.cases) w.cases = r.cases;
        if (r.docs) w.docs = r.docs;
        if (r.conv && w.conv) {
          w.conv = { ...w.conv, title: r.conv.title, caseId: r.conv.caseId };
          w.linkedCaseId = r.conv.caseId ?? null;
        }
        if (r.release) release.push(...r.release);
        if (r.effect) effects.push(r.effect);
        // 记下实际改到了哪一页（之后点「去看」不用再按现在的数据重新猜）和改了哪些地方（撤销用）
        done[item.id] = {
          status: "applied",
          note: undefined,
          place: r.place ?? placeOf(item.action, w),
          undo: r.final ? undefined : diff(before, snap()),
          shown: { title: card.title, rows: brief(card.rows) },
        };
      }
      // 只提交确实改了的那一份，免得把这期间别处的改动盖掉
      ops.commit({
        profile: w.profile !== start.profile ? w.profile : undefined,
        cases: w.cases !== start.cases ? w.cases : undefined,
        docs: w.docs !== start.docs ? w.docs : undefined,
      });
      const renamed = w.conv && (w.conv.title !== start.title || w.conv.caseId !== start.caseId) ? { title: w.conv.title, caseId: w.conv.caseId } : null;
      patchConv(conv.id, (c) => ({
        ...c,
        ...(renamed ?? {}),
        messages: c.messages.map((m) =>
          m.id === msgId ? { ...m, actions: m.actions?.map((x) => (done[x.id] ? { ...x, ...done[x.id] } : x)) } : m,
        ),
      }));
      account.releaseFiles(release);
      // 新开会话会离开这个聊天框，放在最后
      for (const e of effects) if ("deleteChat" in e) ops.deleteChat(e.deleteChat);
      for (const e of effects) if ("newChat" in e) ops.newChat(e.newChat);
    } finally {
      applying.current = false;
    }
  }

  /** 撤销一张已经应用的卡片：只把还保持着卡片写入内容的地方改回去，之后用户自己又改过的不动 */
  function undoAction(msgId: string, id: string) {
    const item = messages.find((m) => m.id === msgId)?.actions?.find((x) => x.id === id);
    if (!ops || !conv || !item?.undo?.length || applying.current) return;
    const now = { profile: ops.profile, cases: ops.cases, docs: ops.docs, conv: { title: conv.title, caseId: conv.caseId } as { title: string; caseId?: string } };
    const r = revert(now, item.undo);
    const s = r.state;
    ops.commit({
      profile: s.profile !== now.profile ? { ...s.profile, updatedAt: Date.now() } : undefined,
      cases: s.cases !== now.cases ? s.cases : undefined,
      docs: s.docs !== now.docs ? s.docs : undefined,
    });
    // 撤销「存进案件」时，案件里那份文件的内容也清掉
    account.releaseFiles(r.removed.filter((x) => x.path.includes("files")).map((x) => (x.item as { id: string }).id));
    const all = r.left.length === item.undo.length;
    const patch: Partial<ActionItem> = r.left.length
      ? {
          undo: r.left,
          note: all
            ? "这些内容在应用之后又改过，没有改回去。如果是后面的卡片改的，请先撤销后面那张。"
            : `有 ${r.left.length} 处在应用之后又改过，没有改回去；其余的已经撤销。`,
        }
      : { status: "pending", undo: undefined, shown: undefined, place: undefined, note: "已撤销，内容恢复成了应用之前的样子。" };
    patchConv(conv.id, (c) => ({
      ...c,
      ...(s.conv !== now.conv ? { title: s.conv.title, caseId: s.conv.caseId } : {}),
      messages: c.messages.map((m) => (m.id === msgId ? { ...m, actions: m.actions?.map((x) => (x.id === id ? { ...x, ...patch } : x)) } : m)),
    }));
  }
  const skipAction = (msgId: string, id: string) =>
    conv &&
    patchConv(conv.id, (c) => ({
      ...c,
      messages: c.messages.map((m) =>
        m.id === msgId ? { ...m, actions: m.actions?.map((x) => (x.id === id ? { ...x, status: "skipped" as const, note: undefined } : x)) } : m,
      ),
    }));

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, messages[messages.length - 1]?.text]);

  // 离开这个会话或文档时（聊天框被卸载），正在生成的回复也停下：不然它会在后台继续写、继续计费，回来时页面上却看不出来
  useEffect(() => () => abort.current?.abort(), []);

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
    // 每次发送都要把这个对话里所有的附件一起带上，太大的话服务器收不下
    const bytes = [...allAttachments(messages), ...pending].reduce((n, a) => n + (a.size || 0), 0);
    if (bytes > 55 * 1024 * 1024) {
      setNotice(
        `这个对话里的文件加起来有 ${Math.round(bytes / 1024 / 1024)} MB，超过了一次能发送的上限（约 55 MB）。请去掉一些文件${docCtx ? "，或者点上方的「清空对话」" : "，或者新开一个对话"}再试。`,
      );
      return;
    }

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
    const setBot = (text: string, actions?: ActionItem[]) =>
      patchConv(id, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === botMsg.id ? { ...m, text, ...(actions?.length ? { actions } : {}) } : m)),
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
    // 模型写的部分（服务端追加的提示有记号隔开，不能当成文档或操作的内容）
    const model = () => splitNotice(raw).body;
    // 文档模式下，回复里的文档标签不显示在聊天里
    const visible = () => {
      const t = model();
      return docCtx
        ? stripDocBlocks(t) || (t.includes("<doc_") ? "_正在修改文档…_" : "")
        : ops
          ? stripActions(t) || (t.includes("<action>") ? "_正在整理要填入的内容…_" : "")
          : t;
    };
    docCtx?.beginTurn();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: payload,
          profile: [profileText, contextLine].filter(Boolean).join("\n"),
          actions: ops && !docCtx ? worldText(world(history)!) : undefined,
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
          const written = liveWrite(model());
          if (written !== null) docCtx.setContent(written);
        }
        setBot(visible());
      }
    } catch (e) {
      suffix = ctrl.signal.aborted
        ? "\n\n> 已停止生成。"
        : `\n\n> ⚠️ ${e instanceof Error ? e.message : "请求失败"}`;
    } finally {
      const { body: text0, notice } = splitNotice(raw);
      let body = text0;
      if (docCtx) {
        const notes: string[] = [];
        const written = liveWrite(text0);
        // 写到一半就断了（回复被截断、出错或被停止）：文档里是没写完的内容，要明说
        const cut = /<doc_(write|edit)>/.test(text0.replace(/<doc_(write|edit)>[\s\S]*?<\/doc_\1>/g, ""));
        if (written !== null) notes.push(cut && !text0.includes("</doc_write>") ? "文档只写了一部分就中断了" : "已写入文档");
        const edits = parseEdits(text0);
        if (edits.length) {
          const r = applyEdits(docCtx.getContent(), edits);
          if (r.applied) {
            docCtx.setContent(r.content);
            notes.push(`已修改文档 ${r.applied} 处`);
          }
          if (r.failed) notes.push(`有 ${r.failed} 处修改没能在文档里定位到原文，已跳过`);
        }
        if (cut && written === null) notes.push("有一处修改没写完就中断了，没有应用");
        body = stripDocBlocks(text0);
        if (notes.length) body += `\n\n> ✏️ ${notes.join("；")}（可在文档上方撤销）`;
      }
      let items: ActionItem[] | undefined;
      if (ops && !docCtx) {
        const read = readActions(text0);
        items = read.actions.map((action) => ({ id: uid(), action, status: "pending" as const }));
        body = stripActions(text0);
        if (!body && items.length) body = "我整理成了下面的卡片，确认无误后点「应用」。";
        if (read.failed) body += `\n\n> 有 ${read.failed} 项要填的内容没能整理成卡片，可以让我「重新整理一次」。`;
      }
      if (notice) body += `\n\n${notice}`;
      if (!(body + suffix).trim() && !items?.length) body = "> 没有收到回复，请再试一次。";
      setBot((body + suffix).trim(), items);
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
                onClick={() => {
                  setPending((p) => p.filter((x) => x.id !== a.id));
                  account.releaseFiles([a.id]); // 刚上传还没发出去的文件不留在云端；从案件里引用的文件有案件在用，不会被删
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
        placeholder={
          docCtx
            ? "告诉 AI 怎么写、怎么改，比如「把第二段改得更具体」"
            : "关于 NIW / EB-1A 的一切，尽管问。也可以说「帮我填档案」，或上传简历、媒体报道等材料让我整理归档"
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
              {m.actions && m.actions.length > 0 && (
                <div className="actions">
                  {m.actions.map((item) => {
                    const w = world(messages, m);
                    const live = w ? describe(item.action, w) : { title: "操作", rows: [], problem: undefined };
                    // 已经应用的卡片显示应用那一刻的内容
                    const d = item.status === "applied" && item.shown ? { ...live, ...item.shown, problem: undefined } : live;
                    const pending = item.status === "pending";
                    const go = item.action.type === "go";
                    const final = irreversible(item.action);
                    const place = !final && w ? (item.place ?? placeOf(item.action, w)) : undefined;
                    return (
                      <div key={item.id} className={`action-card ${item.status}${d.danger ? " danger" : ""}`}>
                        <div className="action-head">
                          <strong>{d.title}</strong>
                          {item.status === "applied" && <span className="tag">已应用</span>}
                          {item.status === "applied" && ops && place && (
                            <button className="link" onClick={() => ops.open(place)}>
                              去看填好的页面 →
                            </button>
                          )}
                          {item.status === "applied" && ops && Boolean(item.undo?.length) && (
                            <button className="link undo" onClick={() => undoAction(m.id, item.id)}>
                              撤销
                            </button>
                          )}
                          {item.status === "skipped" && <span className="tag">已忽略</span>}
                        </div>
                        {d.rows.map((r, k) => (
                          <div className={`action-row${r.danger ? " danger" : ""}`} key={k}>
                            <span>{r.label}</span>
                            <div>
                              {r.value}
                              {pending && r.old && <small>会替换掉原来的内容：{r.old}</small>}
                            </div>
                          </div>
                        ))}
                        {pending && d.danger && !d.problem && <div className="notice">删除后不能恢复，请确认。</div>}
                        {pending && d.problem ? <div className="notice">{d.problem}</div> : item.note ? <div className="action-note">{item.note}</div> : null}
                        {pending && ops && (
                          <div className="form-actions">
                            <button className="btn-ghost" onClick={() => skipAction(m.id, item.id)}>
                              忽略
                            </button>
                            {go ? (
                              <button className="btn-accent" disabled={Boolean(d.problem)} onClick={() => w && ops.open(placeOf(item.action, w)!)}>
                                打开 →
                              </button>
                            ) : (
                              <button className={d.danger ? "btn-accent danger" : "btn-accent"} disabled={Boolean(d.problem)} onClick={() => runActions(m.id, [item.id])}>
                                {d.button ?? "应用"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* 删除类的操作要一张一张确认，不放进「全部应用」 */}
                  {ops && m.actions.filter((x) => x.status === "pending" && !irreversible(x.action)).length > 1 && (
                    <button className="btn-accent" onClick={() => runActions(m.id, m.actions!.filter((x) => !irreversible(x.action)).map((x) => x.id))}>
                      全部应用
                    </button>
                  )}
                </div>
              )}
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
