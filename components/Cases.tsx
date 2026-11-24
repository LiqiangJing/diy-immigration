"use client";

import { useEffect, useRef, useState } from "react";
import { DocList, DocWorkspace } from "@/components/Docs";
import type { Library } from "@/components/Chat";
import Guide from "@/components/Guide";
import Packer from "@/components/Packer";
import PaperFetch from "@/components/PaperFetch";
import { endeavorFilled, profileToText } from "@/lib/profile";
import type { Profile } from "@/lib/profile";
import type { ProfileTab } from "@/components/Profile";
import { CHECKLISTS } from "@/lib/checklists";
import type { ChecklistGroup } from "@/lib/checklists";
import { claimsLine } from "@/lib/claims";
import { workflowsFor } from "@/lib/skills";
import type { Workflow } from "@/lib/skills";
import { ACCEPT, fmtSize, replaceUpload, saveUploads } from "@/lib/files";
import { useAccount } from "@/lib/account";
import { fileIds } from "@/lib/sync";
import { EB1A_CRITERIA } from "@/lib/claims";
import { isPaperFile } from "@/components/PaperFetch";
import { uid } from "@/lib/types";
import type { CaseType, DocFile, ImmigrationCase } from "@/lib/types";

type Props = {
  cases: ImmigrationCase[];
  setCases: React.Dispatch<React.SetStateAction<ImmigrationCase[]>>;
  docs: DocFile[];
  setDocs: React.Dispatch<React.SetStateAction<DocFile[]>>;
  profile: Profile;
  goProfile: (tab?: ProfileTab) => void;
  petitioner: string;
  citationReport: string; // 由「我的档案」的学术数据生成，可能为空
  notableReport: string; // 由「我的档案」的重要引用分析生成，可能为空
  socReport: string; // 由「我的档案」的贡献总结生成，可能为空
  endeavorReport: string; // 由「我的档案」的拟从事事业生成，可能为空
  initialOpen?: { caseId?: string; tab: "guide" | "files" }; // 从聊天里点「去查看」过来时，直接打开对应的案件
};

type Tab = "guide" | "docs" | "files" | "checklist" | "pack";

// EB-1A 清单里十项标准各有一条，和申请向导里「选择申报条件」的十个选项一一对应
const CRITERION_ITEM: Record<string, string> = {
  awards: "eb1-awards", membership: "eb1-membership", media: "eb1-media", judging: "eb1-judging", contributions: "eb1-contrib",
  articles: "eb1-articles", exhibitions: "eb1-exhibit", leading: "eb1-leading", salary: "eb1-salary", commercial: "eb1-commercial",
};

/**
 * 这个案件的材料清单。EB-1A 只要满足十项标准里的三项，所以选了申报条件之后只列出选中的那几项；
 * 不然没打算主张的标准永远勾不上，进度到不了 100%。
 */
export function checklistFor(c: ImmigrationCase): ChecklistGroup[] {
  const groups = CHECKLISTS[c.type];
  if (c.type !== "EB-1A") return groups;
  const picked = new Set((c.claims ?? []).filter((id) => EB1A_CRITERIA.some((k) => k.id === id)).map((id) => CRITERION_ITEM[id]));
  if (!picked.size) return groups;
  return groups.map((g, i) =>
    i === 0 ? { ...g, title: "你选择主张的标准", note: "只列出你在「申请向导」里选的标准；要增减请到向导的「选择申报条件」里改。" + (g.note ? ` ${g.note}` : ""), items: g.items.filter((it) => picked.has(it.id)) } : g,
  );
}

export const caseLine = (c: ImmigrationCase) =>
  [`当前案件：${c.name}（${c.type}）`, claimsLine(c)].filter(Boolean).join("\n");

/** 一个案件里可供聊天引用的资料 */
export function caseLibrary(c: ImmigrationCase, docs: DocFile[], exceptDocId?: string): Library {
  return {
    files: c.files ?? [],
    docs: docs
      .filter((d) => d.caseId === c.id && d.id !== exceptDocId)
      .map((d) => ({ id: d.id, title: d.title, content: d.content })),
  };
}

// 用档案里的内容自动生成的文档：种类 → 生成后的标题
const REPORT_TITLE: Record<string, string> = {
  论文与引用记录: "Publication and Citation Record",
  重要引用: "Notable Citations",
  "Summary of Contributions": "Summary of Contributions",
  "Proposed Endeavor 陈述": "Proposed Endeavor",
};

export default function Cases({ cases, setCases, docs, setDocs, profile, goProfile, petitioner, citationReport, notableReport, socReport, endeavorReport, initialOpen }: Props) {
  const [openId, setOpenId] = useState<string | null>(initialOpen?.caseId ?? null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  // 刚新建、还没有内容的文档：先不存进列表，写了内容或发了消息才保存
  const [draft, setDraft] = useState<DocFile | null>(null);
  const [tab, setTab] = useState<Tab>(initialOpen?.tab ?? "guide");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<CaseType>("NIW");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const account = useAccount();

  const open = cases.find((c) => c.id === openId) ?? null;
  const openDoc = draft ?? docs.find((d) => d.id === openDocId) ?? null;

  useEffect(() => {
    if (draft && (draft.content.trim() || draft.chat.length > 0)) {
      setDocs((list) => (list.some((d) => d.id === draft.id) ? list : [draft, ...list]));
      setOpenDocId(draft.id);
      setDraft(null);
    }
  }, [draft, setDocs]);

  // 按 id 更新，不管这份文档此刻是草稿还是已保存（AI 流式写入期间可能正好发生切换）
  const patchDoc = (id: string, fn: (d: DocFile) => DocFile) => {
    setDraft((d) => (d && d.id === id ? fn(d) : d));
    setDocs((list) => list.map((d) => (d.id === id ? fn(d) : d)));
  };
  const orphanDocs = docs.filter((d) => !d.caseId || !cases.some((c) => c.id === d.caseId));

  const patchCase = (id: string, fn: (c: ImmigrationCase) => ImmigrationCase) =>
    setCases((list) => list.map((c) => (c.id === id ? fn(c) : c)));

  function create() {
    const c: ImmigrationCase = {
      id: uid(),
      name: name.trim() || `我的 ${type} 案件`,
      type,
      createdAt: Date.now(),
      done: [],
      files: [],
    };
    setCases((list) => [c, ...list]);
    setCreating(false);
    setName("");
    setTab("guide");
    setOpenId(c.id);
  }

  function createDoc(kind: string, workflow?: Workflow) {
    const report =
      kind === "论文与引用记录"
        ? citationReport
        : kind === "重要引用"
          ? notableReport
          : kind === "Summary of Contributions"
            ? socReport
            : kind === "Proposed Endeavor 陈述"
              ? endeavorReport
              : "";
    const d: DocFile = {
      id: uid(),
      title: report ? (REPORT_TITLE[kind] ?? kind) : kind,
      kind,
      content: report,
      updatedAt: Date.now(),
      chat: [],
      caseId: open?.id,
      skill: workflow?.id,
    };
    setDraft(d);
  }

  async function upload(caseId: string, files: FileList | File[]) {
    const { added, problems } = await saveUploads(files);
    if (added.length) patchCase(caseId, (c) => ({ ...c, files: [...(c.files ?? []), ...added] }));
    setNotice(problems.join("；"));
  }

  // ---------- 文档工作区 ----------
  if (openDoc) {
    const owner = cases.find((c) => c.id === openDoc.caseId) ?? null;
    return (
      <DocWorkspace
        doc={openDoc}
        patch={(fn) => patchDoc(openDoc.id, fn)}
        onBack={() => {
          setDraft(null);
          setOpenDocId(null);
        }}
        onDelete={() => {
          account.releaseFiles(fileIds(openDoc.chat));
          setDocs((list) => list.filter((d) => d.id !== openDoc.id));
          setDraft(null);
          setOpenDocId(null);
        }}
        backLabel={owner ? owner.name : "全部案件"}
        library={owner ? caseLibrary(owner, docs, openDoc.id) : undefined}
        contextLine={owner ? caseLine(owner) : undefined}
        caseType={owner?.type}
        profileText={profileToText(profile, owner?.type === "NIW")}
        endeavorReady={endeavorFilled(profile.endeavor)}
      />
    );
  }

  // ---------- 单个案件 ----------
  if (open) {
    const groups = checklistFor(open);
    const ids = new Set(groups.flatMap((g) => g.items.map((it) => it.id)));
    const total = ids.size;
    const doneCount = open.done.filter((id) => ids.has(id)).length;
    const pct = Math.round((doneCount / total) * 100);
    const caseDocs = docs.filter((d) => d.caseId === open.id);
    const files = open.files ?? [];
    return (
      <div className="cases">
        <button className="back" onClick={() => setOpenId(null)}>
          ← 全部案件
        </button>
        <div className="case-head">
          <div>
            <h2>{open.name}</h2>
            <p>
              <span className="tag">{open.type}</span>
              {caseDocs.length} 份文档 · {files.length} 个文件 · 清单完成 {doneCount} / {total}
            </p>
          </div>
          <button
            className="btn-ghost danger"
            onClick={() => {
              if (!confirm(`删除案件「${open.name}」以及里面的文档和文件？此操作无法撤销。`)) return;
              // 案件的文件和里面各份文档对话里带的附件一起清掉（别的会话还在引用的会留着）
              account.releaseFiles([...files.map((f) => f.id), ...fileIds(caseDocs.map((d) => d.chat))]);
              setDocs((list) => list.filter((d) => d.caseId !== open.id));
              setCases((list) => list.filter((c) => c.id !== open.id));
              setOpenId(null);
            }}
          >
            删除案件
          </button>
        </div>

        <div className="tabs" role="tablist">
          {(
            [
              ["guide", "申请向导"],
              ["docs", `文档 ${caseDocs.length}`],
              ["files", `文件 ${files.length}`],
              ["checklist", `材料清单 ${pct}%`],
              ["pack", "打包下载"],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>

        {tab === "guide" && (
          <Guide
            c={open}
            docs={caseDocs}
            profile={profile}
            patchCase={(fn) => patchCase(open.id, fn)}
            onWorkflow={(w) => createDoc(w.title, w)}
            onCreate={createDoc}
            onOpenDoc={setOpenDocId}
            goTab={setTab}
            goProfile={goProfile}
          />
        )}

        {tab === "docs" && (
          <>
            <p className="group-note">
              申请文书在这里写。打开文档后右边可以和 AI 对话，它能引用这个案件里的文件和其他文档。
            </p>
            <DocList
              docs={caseDocs}
              onCreate={createDoc}
              onOpen={setOpenDocId}
              workflows={workflowsFor(open.type)}
              onWorkflow={(w) => createDoc(w.title, w)}
            />
          </>
        )}

        {tab === "files" && (
          <>
            <p className="group-note">
              把简历、论文、推荐信、获奖证明等原始材料放在这里，写文档或聊天时可以随时引用。
            </p>
            <div
              className={`dropzone ${dragging ? "drag" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files.length) upload(open.id, e.dataTransfer.files);
              }}
            >
              <button className="btn-accent" onClick={() => fileInput.current?.click()}>
                + 上传文件
              </button>
              <span>或把文件拖到这里。支持 PDF、图片、TXT、Markdown，单个不超过 20 MB</span>
              <input
                ref={fileInput}
                type="file"
                hidden
                multiple
                accept={ACCEPT}
                onChange={(e) => {
                  if (e.target.files?.length) upload(open.id, e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {notice && <div className="notice">{notice}</div>}
            <PaperFetch c={open} docs={caseDocs} profile={profile} patchCase={(fn) => patchCase(open.id, fn)} />
            {files.length === 0 ? (
              <p className="group-note">还没有文件。</p>
            ) : (
              <ul className="file-list">
                {files.map((f) => (
                  <li key={f.id}>
                    <span className="file-name">
                      {f.name}
                      {f.name.includes("[arXiv preprint]") && <span className="tag preprint">预印本，建议换成正式发表版本</span>}
                    </span>
                    <span className="case-meta">{fmtSize(f.size)}</span>
                    <label className="link replace">
                      替换
                      <input
                        type="file"
                        hidden
                        accept={ACCEPT}
                        onChange={async (e) => {
                          const nf = e.target.files?.[0];
                          e.target.value = "";
                          if (!nf) return;
                          // 一键下载的论文保留原来的名字（去掉预印本标记），其他文件用新文件的名字
                          const { att, problem } = await replaceUpload(f, nf, isPaperFile(f));
                          setNotice(problem ?? "");
                          if (!att) return;
                          // 新文件是新的 id：把打包设置里记着旧 id 的地方（顺序、标题、位置、是否放进包）换成新的，再释放旧文件
                          const swap = (id: string) => (id === f.id ? att.id : id);
                          const rekey = <T,>(o: Record<string, T> | undefined) =>
                            Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [swap(k), v])) as Record<string, T>;
                          patchCase(open.id, (c) => ({
                            ...c,
                            files: (c.files ?? []).map((x) => (x.id === f.id ? att : x)),
                            pack: c.pack && {
                              ...c.pack,
                              order: c.pack.order.map(swap),
                              skip: c.pack.skip.map(swap),
                              keep: c.pack.keep?.map(swap),
                              titles: rekey(c.pack.titles),
                              roles: rekey(c.pack.roles),
                            },
                          }));
                          account.releaseFiles([f.id]);
                        }}
                      />
                    </label>
                    <button
                      className="link-danger"
                      onClick={() => {
                        if (!confirm(`删除文件「${f.name}」？`)) return;
                        patchCase(open.id, (c) => ({ ...c, files: (c.files ?? []).filter((x) => x.id !== f.id) }));
                        account.releaseFiles([f.id]);
                      }}
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === "pack" && (
          <Packer c={open} docs={caseDocs} petitioner={petitioner} patchCase={(fn) => patchCase(open.id, fn)} />
        )}

        {tab === "checklist" && (
          <>
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${pct}%` }} />
            </div>
            {groups.map((g) => (
              <section key={g.title} className="group">
                <h3>{g.title}</h3>
                {g.note && <p className="group-note">{g.note}</p>}
                {g.items.map((it) => (
                  <label key={it.id} className="item">
                    <input
                      type="checkbox"
                      checked={open.done.includes(it.id)}
                      onChange={() =>
                        patchCase(open.id, (c) => ({
                          ...c,
                          done: c.done.includes(it.id) ? c.done.filter((x) => x !== it.id) : [...c.done, it.id],
                        }))
                      }
                    />
                    <span>
                      {it.label}
                      {it.hint && <small>{it.hint}</small>}
                    </span>
                  </label>
                ))}
              </section>
            ))}
          </>
        )}
      </div>
    );
  }

  // ---------- 案件列表 ----------
  return (
    <div className="cases">
      <div className="case-head">
        <div>
          <h2>我的案件</h2>
          <p>每个案件是一个独立的项目，里面放这次申请的文档、文件和材料清单。</p>
        </div>
        {cases.length > 0 && !creating && (
          <button className="btn-accent" onClick={() => setCreating(true)}>
            + 新建案件
          </button>
        )}
      </div>

      {creating && (
        <form
          className="case-form"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <h3>新建案件</h3>
          <label>
            申请类别
            <div className="seg">
              {(["NIW", "EB-1A"] as CaseType[]).map((t) => (
                <button type="button" key={t} className={type === t ? "on" : ""} onClick={() => setType(t)}>
                  {t}
                  <small>{t === "NIW" ? "国家利益豁免" : "杰出人才"}</small>
                </button>
              ))}
            </div>
          </label>
          <label>
            案件名称
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`我的 ${type} 案件`} autoFocus />
          </label>
          <div className="form-actions">
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
              取消
            </button>
            <button type="submit" className="btn-accent">
              创建
            </button>
          </div>
        </form>
      )}

      {cases.length === 0 && !creating ? (
        <div className="empty">
          <h3>暂无案件</h3>
          <p>创建一个 NIW 或 EB-1A 案件，在里面写文书、存材料、按清单逐项准备。</p>
          <button className="btn-accent" onClick={() => setCreating(true)}>
            + 创建第一个案件
          </button>
        </div>
      ) : (
        <div className="case-list">
          {cases.map((c) => {
            const ids = new Set(checklistFor(c).flatMap((g) => g.items.map((it) => it.id)));
            const total = ids.size;
            const done = c.done.filter((id) => ids.has(id)).length;
            const n = docs.filter((d) => d.caseId === c.id).length;
            return (
              <button
                key={c.id}
                className="case-card"
                onClick={() => {
                  setTab("guide");
                  setNotice("");
                  setOpenId(c.id);
                }}
              >
                <span className="tag">{c.type}</span>
                <strong>{c.name}</strong>
                <span className="case-meta">
                  {n} 份文档 · {(c.files ?? []).length} 个文件 · 清单 {done} / {total}
                </span>
                <div className="progress">
                  <div style={{ width: `${(done / total) * 100}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {orphanDocs.length > 0 && (
        <>
          <h3 className="section-title">未归入案件的文档</h3>
          <DocList docs={orphanDocs} onOpen={setOpenDocId} />
        </>
      )}
    </div>
  );
}
