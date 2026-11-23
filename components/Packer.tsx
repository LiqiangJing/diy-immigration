"use client";

import { useState } from "react";
import { getFile } from "@/lib/files";
import { buildPacket } from "@/lib/packet";
import type { PacketItem } from "@/lib/packet";
import type { DocFile, ImmigrationCase, PackConfig } from "@/lib/types";

type Props = {
  c: ImmigrationCase;
  docs: DocFile[]; // 这个案件里的文档
  petitioner: string; // 英文姓名
  patchCase: (fn: (c: ImmigrationCase) => ImmigrationCase) => void;
};

type Row = {
  id: string;
  source: "文档" | "文件";
  defaultTitle: string;
  defaultRole: "body" | "exhibit";
  defaultOn: boolean; // 默认放不放进包里
  weight: number; // 默认顺序：小的排前面
  format: PacketItem["format"] | null; // null = 这种格式并不进 PDF
  doc?: DocFile;
};

// 只给申请人自己和 AI 看的工作底稿，默认不放进递交的材料包（用户可以自己勾上）
const INTERNAL_KINDS = new Set(["Summary of Contributions", "重要引用"]);
const INTERNAL_SKILLS = new Set(["case-strength-assessor", "petition-audit", "form-guide"]);
const isInternal = (d: DocFile) => INTERNAL_KINDS.has(d.kind) || Boolean(d.skill && INTERNAL_SKILLS.has(d.skill));
// 作为证据附在后面的文档；其余的（Cover Letter、Petition Letter 等）是正文
const isLetter = (d: DocFile) => d.kind === "推荐信" || d.skill === "expert-letter-drafter";
const EXHIBIT_KINDS = new Set(["论文与引用记录", "Proposed Endeavor 陈述"]);
const isPetition = (d: DocFile) => d.kind === "Petition Letter" || d.skill === "niw-petition-narrative" || d.skill === "eb1a-petition-narrative";

const EMPTY: PackConfig = { order: [], skip: [], titles: {}, roles: {} };

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function Packer({ c, docs, petitioner, patchCase }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ pages: number; warnings: string[] } | null>(null);
  const [error, setError] = useState("");

  const pack = c.pack ?? EMPTY;
  const setPack = (fn: (p: PackConfig) => PackConfig) =>
    patchCase((x) => ({ ...x, pack: fn(x.pack ?? EMPTY) }));

  const all: Row[] = [
    ...docs.map(
      (d): Row => ({
        id: `doc:${d.id}`,
        source: "文档",
        defaultTitle: d.title,
        defaultRole: isLetter(d) || EXHIBIT_KINDS.has(d.kind) ? "exhibit" : "body",
        defaultOn: !isInternal(d),
        // 正文里 Cover Letter 在最前，然后是 Petition Letter
        weight: d.skill === "cover-letter" ? 0 : isPetition(d) ? 1 : 2,
        format: "markdown",
        doc: d,
      }),
    ),
    ...(c.files ?? []).map(
      (f): Row => ({
        id: f.id,
        source: "文件",
        // 一键下载的论文：目录里只显示论文标题，不带「Paper - 」前缀和预印本标记
        defaultTitle: f.name
          .replace(/\.[^.]+$/, "")
          .replace(" [arXiv preprint]", "")
          .replace(/^(Paper|Citing) - /, ""),
        defaultRole: "exhibit",
        defaultOn: true,
        weight: 3,
        format:
          f.type === "application/pdf" ? "pdf"
          : f.type === "image/png" ? "png"
          : f.type === "image/jpeg" ? "jpg"
          : f.type === "text/plain" ? "markdown"
          : null,
      }),
    ),
  ];
  // 按保存的顺序排，新加入的材料排在最后
  const pos = (id: string) => {
    const i = pack.order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const rows = all
    .map((r, i) => ({ r, i }))
    .sort((a, b) => pos(a.r.id) - pos(b.r.id) || a.r.weight - b.r.weight || a.i - b.i)
    .map((x) => x.r);

  const roleOf = (r: Row) => pack.roles[r.id] ?? r.defaultRole;
  const titleOf = (r: Row) => pack.titles[r.id] ?? r.defaultTitle;
  const includedIn = (p: PackConfig, r: Row) =>
    r.format !== null && !p.skip.includes(r.id) && (r.defaultOn || (p.keep ?? []).includes(r.id));
  const included = (r: Row) => includedIn(pack, r);

  function move(id: string, dir: -1 | 1) {
    const me = rows.find((r) => r.id === id)!;
    const group = rows.filter((r) => roleOf(r) === roleOf(me));
    const other = group[group.indexOf(me) + dir];
    if (!other) return;
    const order = rows.map((r) => r.id);
    const a = order.indexOf(id);
    const b = order.indexOf(other.id);
    [order[a], order[b]] = [order[b], order[a]];
    setPack((p) => ({ ...p, order }));
  }

  async function generate() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const items: PacketItem[] = [];
      const missing: string[] = [];
      for (const r of rows) {
        if (!included(r)) continue;
        const base = { role: roleOf(r), title: titleOf(r) };
        if (r.doc) {
          items.push({ ...base, format: "markdown", text: r.doc.content });
          continue;
        }
        const data = await getFile(r.id);
        if (!data) {
          missing.push(`「${titleOf(r)}」的文件内容找不到了，请重新上传`);
          continue;
        }
        const bytes = b64ToBytes(data);
        if (r.format === "markdown") items.push({ ...base, format: "markdown", text: new TextDecoder().decode(bytes) });
        else items.push({ ...base, format: r.format!, data: bytes });
      }
      if (!items.length) throw new Error("没有可以打包的内容。");
      const out = await buildPacket({ caseType: c.type, petitioner, items });
      const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${[c.type.replace("-", ""), ...petitioner.trim().split(/\s+/)].filter(Boolean).join("_")}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setResult({ pages: out.pages, warnings: [...missing, ...out.warnings] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  const group = (role: "body" | "exhibit") => rows.filter((r) => roleOf(r) === role);
  let exhibitNo = 0;

  const renderRow = (r: Row, idx: number, list: Row[]) => {
    const on = included(r);
    const no = roleOf(r) === "exhibit" && on ? ++exhibitNo : 0;
    return (
      <li key={r.id} className={on ? "" : "off"}>
        <input
          type="checkbox"
          checked={on}
          disabled={r.format === null}
          aria-label={`包含 ${titleOf(r)}`}
          onChange={() =>
            setPack((p) => {
              const skip = p.skip.filter((x) => x !== r.id);
              const keep = (p.keep ?? []).filter((x) => x !== r.id);
              return includedIn(p, r) ? { ...p, skip: [...skip, r.id], keep } : { ...p, skip, keep: [...keep, r.id] };
            })
          }
        />
        <span className="pack-no">{no ? `Exhibit ${no}` : roleOf(r) === "body" ? "正文" : "—"}</span>
        <input
          className="pack-title"
          value={titleOf(r)}
          aria-label="在目录中显示的标题"
          onChange={(e) => setPack((p) => ({ ...p, titles: { ...p.titles, [r.id]: e.target.value } }))}
        />
        <span className="tag">{r.source}</span>
        {!r.defaultOn && !on && <span className="case-meta">工作底稿，默认不递交</span>}
        {r.format === null ? (
          <span className="case-meta">此格式无法并入 PDF</span>
        ) : (
          <>
            <select
              value={roleOf(r)}
              aria-label="位置"
              onChange={(e) =>
                setPack((p) => ({ ...p, roles: { ...p.roles, [r.id]: e.target.value as "body" | "exhibit" } }))
              }
            >
              <option value="body">放在正文</option>
              <option value="exhibit">作为 Exhibit</option>
            </select>
            <button className="btn-ghost small" disabled={idx === 0} onClick={() => move(r.id, -1)} aria-label="上移">
              ↑
            </button>
            <button
              className="btn-ghost small"
              disabled={idx === list.length - 1}
              onClick={() => move(r.id, 1)}
              aria-label="下移"
            >
              ↓
            </button>
          </>
        )}
      </li>
    );
  };

  return (
    <>
      <p className="group-note">
        把这个案件的文书和材料合成一份 PDF：首页目录 → 正文文书 → List of Exhibits → 各个
        Exhibit（每个前面有分隔页），每页带页眉和页码。标题会出现在目录里，请用英文填写。
        案件评估、审计报告、表格填写指引、贡献总结、重要引用这些是给你自己和 AI 看的工作底稿，默认不放进去；确实要放的话自己勾上。
      </p>
      {!petitioner.trim() && (
        <div className="notice">还没有填英文姓名，页眉和文件名里会缺少名字。请先到「我的档案」填写。</div>
      )}
      {rows.length === 0 ? (
        <p className="group-note">这个案件里还没有文档或文件。</p>
      ) : (
        <>
          <h3 className="section-title">正文文书（按顺序排在最前面）</h3>
          {group("body").length ? <ul className="pack-list">{group("body").map(renderRow)}</ul> : <p className="group-note">无</p>}
          <h3 className="section-title">Exhibits（按顺序编号）</h3>
          {group("exhibit").length ? (
            <ul className="pack-list">{group("exhibit").map(renderRow)}</ul>
          ) : (
            <p className="group-note">无。到「文件」页上传材料后会出现在这里。</p>
          )}
          <div className="pack-actions">
            <button className="btn-accent" disabled={busy} onClick={generate}>
              {busy ? "正在生成…" : "生成并下载 PDF"}
            </button>
            {result && <span className="case-meta">已生成，共 {result.pages} 页。</span>}
          </div>
          {error && <div className="notice">{error}</div>}
          {result?.warnings.map((w) => (
            <div key={w} className="notice">
              {w}
            </div>
          ))}
          <p className="group-note">
            I-140、G-1145 等官方表格不在这里生成，需要你自己填写后放在最前面。递交前请逐页检查。
          </p>
        </>
      )}
    </>
  );
}
