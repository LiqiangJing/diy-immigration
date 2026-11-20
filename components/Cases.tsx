"use client";

import { useEffect, useRef, useState } from "react";
import { DocList, DocWorkspace } from "@/components/Docs";
import type { Library } from "@/components/Chat";
import Packer from "@/components/Packer";
import { CHECKLISTS, totalItems } from "@/lib/checklists";
import { ACCEPT, dropFile, fmtSize, saveUploads } from "@/lib/files";
import { uid } from "@/lib/types";
import type { CaseType, DocFile, ImmigrationCase } from "@/lib/types";

type Props = {
  cases: ImmigrationCase[];
  setCases: React.Dispatch<React.SetStateAction<ImmigrationCase[]>>;
  docs: DocFile[];
  setDocs: React.Dispatch<React.SetStateAction<DocFile[]>>;
  profileText: string;
  petitioner: string;
};

type Tab = "docs" | "files" | "checklist" | "pack";

export const caseLine = (c: ImmigrationCase) => `当前案件：${c.name}（${c.type}）`;

/** 一个案件里可供聊天引用的资料 */
export function caseLibrary(c: ImmigrationCase, docs: DocFile[], exceptDocId?: string): Library {
  return {
    files: c.files ?? [],
    docs: docs
      .filter((d) => d.caseId === c.id && d.id !== exceptDocId)
      .map((d) => ({ id: d.id, title: d.title, content: d.content })),
  };
}

export default function Cases({ cases, setCases, docs, setDocs, profileText, petitioner }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  // 刚新建、还没有内容的文档：先不存进列表，写了内容或发了消息才保存
  const [draft, setDraft] = useState<DocFile | null>(null);
  const [tab, setTab] = useState<Tab>("docs");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<CaseType>("NIW");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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
    setTab("docs");
    setOpenId(c.id);
  }

  function createDoc(kind: string) {
    const d: DocFile = {
      id: uid(),
      title: kind,
      kind,
      content: "",
      updatedAt: Date.now(),
      chat: [],
      caseId: open?.id,
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
          setDocs((list) => list.filter((d) => d.id !== openDoc.id));
          setDraft(null);
          setOpenDocId(null);
        }}
        backLabel={owner ? owner.name : "全部案件"}
        library={owner ? caseLibrary(owner, docs, openDoc.id) : undefined}
        contextLine={owner ? caseLine(owner) : undefined}
        profileText={profileText}
      />
    );
  }

  // ---------- 单个案件 ----------
  if (open) {
    const total = totalItems(open.type);
    const pct = Math.round((open.done.length / total) * 100);
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
              {caseDocs.length} 份文档 · {files.length} 个文件 · 清单完成 {open.done.length} / {total}
            </p>
          </div>
          <button
            className="btn-ghost danger"
            onClick={() => {
              if (!confirm(`删除案件「${open.name}」以及里面的文档和文件？此操作无法撤销。`)) return;
              files.forEach((f) => dropFile(f.id));
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

        {tab === "docs" && (
          <>
            <p className="group-note">
              申请文书在这里写。打开文档后右边可以和 AI 对话，它能引用这个案件里的文件和其他文档。
            </p>
            <DocList docs={caseDocs} onCreate={createDoc} onOpen={setOpenDocId} />
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
            {files.length === 0 ? (
              <p className="group-note">还没有文件。</p>
            ) : (
              <ul className="file-list">
                {files.map((f) => (
                  <li key={f.id}>
                    <span className="file-name">{f.name}</span>
                    <span className="case-meta">{fmtSize(f.size)}</span>
                    <button
                      className="link-danger"
                      onClick={() => {
                        if (!confirm(`删除文件「${f.name}」？`)) return;
                        dropFile(f.id);
                        patchCase(open.id, (c) => ({ ...c, files: (c.files ?? []).filter((x) => x.id !== f.id) }));
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
            {CHECKLISTS[open.type].map((g) => (
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
            const total = totalItems(c.type);
            const n = docs.filter((d) => d.caseId === c.id).length;
            return (
              <button
                key={c.id}
                className="case-card"
                onClick={() => {
                  setTab("docs");
                  setNotice("");
                  setOpenId(c.id);
                }}
              >
                <span className="tag">{c.type}</span>
                <strong>{c.name}</strong>
                <span className="case-meta">
                  {n} 份文档 · {(c.files ?? []).length} 个文件 · 清单 {c.done.length} / {total}
                </span>
                <div className="progress">
                  <div style={{ width: `${(c.done.length / total) * 100}%` }} />
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
