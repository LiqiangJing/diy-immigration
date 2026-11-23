"use client";

import type { Guide } from "@/lib/socGuide";

/** 用户的案件只有一种类型时，只显示那一种的说明；两种都有或还没有案件时都显示 */
export type Only = "NIW" | "EB-1A" | null;

/** 一项的详细填写说明，默认收起 */
export function GuideBox({ g, only = null }: { g: Guide | undefined; only?: Only }) {
  if (!g) return null;
  return (
    <details className="tips">
      <summary>查看填写说明和示例</summary>
      <ul>
        {g.points.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      {g.example && (
        <>
          <strong>示例（内容是虚构的，只示范写法）</strong>
          <pre>{g.example}</pre>
        </>
      )}
      {g.niw && only !== "EB-1A" && (
        <p>
          <strong>申请 NIW：</strong>
          {g.niw}
        </p>
      )}
      {g.eb1a && only !== "NIW" && (
        <p>
          <strong>申请 EB-1A：</strong>
          {g.eb1a}
        </p>
      )}
      {g.evidence && (
        <p>
          <strong>之后要准备的证据：</strong>
          {g.evidence}
        </p>
      )}
      {g.avoid && (
        <p>
          <strong>常见问题：</strong>
          {g.avoid.join("；")}。
        </p>
      )}
    </details>
  );
}

/** 带说明的多行输入框 */
export function Area({
  label,
  hint,
  value,
  onChange,
  rows = 4,
  placeholder,
  guide,
  only,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  guide?: Guide;
  only?: Only;
}) {
  return (
    <div className="field">
      <label>
        {label}
        {hint && <small>{hint}</small>}
        <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      </label>
      <GuideBox g={guide} only={only} />
    </div>
  );
}
