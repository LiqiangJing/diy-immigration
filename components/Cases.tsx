"use client";

import { useState } from "react";
import { CHECKLISTS, totalItems } from "@/lib/checklists";
import { uid } from "@/lib/types";
import type { CaseType, ImmigrationCase } from "@/lib/types";

type Props = {
  cases: ImmigrationCase[];
  setCases: React.Dispatch<React.SetStateAction<ImmigrationCase[]>>;
};

export default function Cases({ cases, setCases }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<CaseType>("NIW");

  const open = cases.find((c) => c.id === openId);

  function create() {
    const c: ImmigrationCase = {
      id: uid(),
      name: name.trim() || `我的 ${type} 案件`,
      type,
      createdAt: Date.now(),
      done: [],
    };
    setCases((list) => [c, ...list]);
    setCreating(false);
    setName("");
    setOpenId(c.id);
  }

  function toggle(caseId: string, itemId: string) {
    setCases((list) =>
      list.map((c) =>
        c.id !== caseId
          ? c
          : {
              ...c,
              done: c.done.includes(itemId)
                ? c.done.filter((x) => x !== itemId)
                : [...c.done, itemId],
            },
      ),
    );
  }

  const form = (
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
  );

  if (open) {
    const total = totalItems(open.type);
    const pct = Math.round((open.done.length / total) * 100);
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
              已完成 {open.done.length} / {total} 项
            </p>
          </div>
          <button
            className="btn-ghost danger"
            onClick={() => {
              if (!confirm(`删除案件「${open.name}」？此操作无法撤销。`)) return;
              setCases((list) => list.filter((c) => c.id !== open.id));
              setOpenId(null);
            }}
          >
            删除案件
          </button>
        </div>
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
                  onChange={() => toggle(open.id, it.id)}
                />
                <span>
                  {it.label}
                  {it.hint && <small>{it.hint}</small>}
                </span>
              </label>
            ))}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="cases">
      <div className="case-head">
        <div>
          <h2>我的案件</h2>
          <p>在这里管理你的移民申请案件，跟踪每一份材料的准备进度。</p>
        </div>
        {cases.length > 0 && !creating && (
          <button className="btn-accent" onClick={() => setCreating(true)}>
            + 新建案件
          </button>
        )}
      </div>

      {creating && form}

      {cases.length === 0 && !creating ? (
        <div className="empty">
          <h3>暂无案件</h3>
          <p>创建一个 NIW 或 EB-1A 案件，按清单逐项准备材料。</p>
          <button className="btn-accent" onClick={() => setCreating(true)}>
            + 创建第一个案件
          </button>
        </div>
      ) : (
        <div className="case-list">
          {cases.map((c) => {
            const total = totalItems(c.type);
            return (
              <button key={c.id} className="case-card" onClick={() => setOpenId(c.id)}>
                <span className="tag">{c.type}</span>
                <strong>{c.name}</strong>
                <span className="case-meta">
                  已完成 {c.done.length} / {total} 项 · 创建于{" "}
                  {new Date(c.createdAt).toLocaleDateString("zh-CN")}
                </span>
                <div className="progress">
                  <div style={{ width: `${(c.done.length / total) * 100}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
