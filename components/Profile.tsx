"use client";

import { useState } from "react";
import { useAccount } from "@/lib/account";
import Notable from "@/components/Notable";
import Soc from "@/components/Soc";
import { DEGREE_TYPES, REVIEW_OPTIONS, primaryPatch, primaryRecord } from "@/lib/profile";
import type { Degree, Profile as ProfileData, Related, ScholarRecord } from "@/lib/profile";
import { uid } from "@/lib/types";

type Props = {
  profile: ProfileData;
  setProfile: React.Dispatch<React.SetStateAction<ProfileData>>;
};

const newDegree = (type = ""): Degree => ({
  id: uid(),
  type,
  major: "",
  university: "",
  year: "",
  related: "",
});

function Radio<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="radios">
      {options.map((o) => (
        <label key={o.value}>
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function DegreeFields({
  d,
  onChange,
  onRemove,
  enrolled,
}: {
  d: Degree;
  onChange: (d: Degree) => void;
  onRemove: () => void;
  enrolled?: boolean;
}) {
  const set = (patch: Partial<Degree>) => onChange({ ...d, ...patch });
  return (
    <div className="degree">
      <div className="grid2">
        <label>
          学位类型
          {enrolled ? (
            <input value={d.type} onChange={(e) => set({ type: e.target.value })} placeholder="如 博士在读（PhD in progress）" />
          ) : (
            <select value={d.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="">请选择</option>
              {DEGREE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          )}
        </label>
        <label>
          专业
          <input value={d.major} onChange={(e) => set({ major: e.target.value })} />
        </label>
        <label>
          学校
          <input value={d.university} onChange={(e) => set({ university: e.target.value })} />
        </label>
        <label>
          {enrolled ? "预计毕业时间" : "学位授予年份"}
          <input
            value={d.year}
            onChange={(e) => set({ year: e.target.value })}
            placeholder={enrolled ? "MM/YYYY" : "YYYY"}
            inputMode="numeric"
          />
        </label>
      </div>
      <div className="field">
        <span>这个学位和你拟从事的事业（或未来在美工作）相关吗？</span>
        <Radio<Related>
          name={`rel-${d.id}`}
          value={d.related}
          onChange={(related) => set({ related })}
          options={[
            { value: "yes", label: "相关" },
            { value: "no", label: "不相关" },
            { value: "unsure", label: "不确定" },
          ]}
        />
      </div>
      <button className="link-danger" onClick={onRemove}>
        移除
      </button>
    </div>
  );
}

type Candidate = {
  id: string;
  name: string;
  institution: string;
  papers: number;
  citations: number;
  hIndex: number | null;
};

type Src = "gs" | "s2" | "oa";

const SOURCE_NOTE: Record<string, string> = {
  "Google Scholar": "数字和你的 Google Scholar 主页一致。",
  "Semantic Scholar":
    "Semantic Scholar 收录的范围和 Google Scholar 不同，引用数通常偏低；它有时会把同一个人拆成几个作者页，论文不全时请到它的网站上合并。",
  OpenAlex: "OpenAlex 是按姓名匹配的，和 Google Scholar 的数字通常会有出入。",
};

export default function Profile({ profile: p, setProfile }: Props) {
  const [candidates, setCandidates] = useState<{ src: Src; list: Candidate[] } | null>(null);
  const [loading, setLoading] = useState<Src | "">("");
  const [scholarError, setScholarError] = useState("");
  const [needUpload, setNeedUpload] = useState(false);
  const isGs = /scholar\.google\./.test(p.scholarUrl) && /[?&]user=/.test(p.scholarUrl);
  const isS2 = /semanticscholar\.org\/author\/.*\d/.test(p.s2Url);
  const fullName = `${p.firstName} ${p.lastName}`.trim();
  const account = useAccount();
  const cost = account.me?.scholarCost ?? 0;
  const main = primaryRecord(p);

  async function call(query: string) {
    const res = await fetch(`/api/scholar?${query}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error(data?.error ?? "获取失败，请稍后再试。");
    return data;
  }

  // 把接口返回的结果存成这个来源的记录（同一来源重新获取时覆盖旧的）
  function apply(data: any, fallbackUrl = "") {
    const rec: ScholarRecord = {
      source: data.source,
      url: data.url || fallbackUrl,
      name: data.author.name ?? "",
      papers: `${data.author.papers ?? ""}${data.author.more ? "+" : ""}`,
      citations: String(data.author.citations ?? ""),
      hIndex: data.author.hIndex == null ? "" : String(data.author.hIndex),
      publications: data.works,
      fetchedAt: Date.now(),
      more: Boolean(data.author.more),
    };
    setProfile((prev) => {
      // 还没有主要来源，或者重新获取的就是主要来源时，同步更新上面的三个数字
      const isMain = !prev.records.some((r) => r.source === prev.primarySource) || prev.primarySource === rec.source;
      return {
        ...prev,
        records: [...prev.records.filter((r) => r.source !== rec.source), rec],
        ...(isMain ? primaryPatch(rec) : {}),
        ...(rec.source === "Semantic Scholar" && rec.url ? { s2Url: rec.url } : {}),
        updatedAt: Date.now(),
      };
    });
    setCandidates(null);
    setNeedUpload(false);
  }

  async function run(src: Src, fn: () => Promise<void>) {
    if (!account.guard(cost)) return;
    setLoading(src);
    setScholarError("");
    try {
      await fn();
    } catch (e) {
      setScholarError(e instanceof Error ? e.message : "获取失败");
    } finally {
      setLoading("");
      account.refresh();
    }
  }

  // 直接读取填写的 Google Scholar 主页
  const fetchGs = () =>
    run("gs", async () => {
      setCandidates(null);
      const res = await fetch(`/api/scholar?gs=${encodeURIComponent(p.scholarUrl)}`);
      const data = await res.json().catch(() => null);
      if (data?.blocked) setNeedUpload(true);
      if (!res.ok || !data) throw new Error(data?.error ?? "获取失败，请稍后再试。");
      apply(data, p.scholarUrl);
    });

  // 解析用户另存的 Scholar 网页
  const uploadGs = (file: File) =>
    run("gs", async () => {
      const res = await fetch("/api/scholar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: await file.text() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? "解析失败。");
      apply(data, p.scholarUrl);
    });

  // Semantic Scholar：填了主页链接就直接读，没填就按姓名找候选
  const fetchS2 = () =>
    run("s2", async () => {
      if (isS2) apply(await call(`s2=${encodeURIComponent(p.s2Url)}`));
      else setCandidates({ src: "s2", list: (await call(`s2q=${encodeURIComponent(fullName)}`)).candidates });
    });

  const searchOa = () =>
    run("oa", async () => {
      setCandidates({ src: "oa", list: (await call(`q=${encodeURIComponent(fullName)}`)).candidates });
    });

  const pickAuthor = (c: Candidate) =>
    run(candidates?.src ?? "oa", async () => {
      apply(await call(candidates?.src === "s2" ? `s2=${c.id}` : `id=${c.id}`));
    });

  const set = (patch: Partial<ProfileData>) =>
    setProfile((prev) => ({ ...prev, ...patch, updatedAt: Date.now() }));
  const [tab, setTab] = useState<"basic" | "scholar" | "soc">("basic");

  return (
    <div className="cases profile">
      <div className="case-head">
        <div>
          <h2>我的档案</h2>
          <p>
            填写你的背景。AI 在聊天和评估案件时会参考这份档案，不用每次重新介绍自己。
            {p.updatedAt > 0 && <> 上次更新：{new Date(p.updatedAt).toLocaleString("zh-CN")}（自动保存）</>}
          </p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ["basic", "基本资料"],
            ["scholar", "学术记录与引用"],
            ["soc", "贡献总结"],
          ] as const
        ).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "soc" && <Soc profile={p} setProfile={setProfile} />}

      {tab === "basic" && (<>
      <section className="card">
        <h3>基本信息</h3>
        <div className="grid2">
          <label>
            名（英文 / 拼音）
            <input value={p.firstName} onChange={(e) => set({ firstName: e.target.value })} placeholder="与护照一致，如 Xiaoming" />
          </label>
          <label>
            姓（英文 / 拼音）
            <input value={p.lastName} onChange={(e) => set({ lastName: e.target.value })} placeholder="与护照一致，如 Wang" />
          </label>
        </div>
        <label>
          中文姓名（选填）
          <small>申请文书和表格都用护照上的英文名；中文名只用于称呼你。</small>
          <input value={p.chineseName} onChange={(e) => set({ chineseName: e.target.value })} />
        </label>
        <label>
          研究 / 工作领域
          <input
            value={p.field}
            onChange={(e) => set({ field: e.target.value })}
            placeholder="如：多模态大模型、电池材料、肿瘤免疫"
          />
        </label>
      </section>

      <section className="card">
        <h3>学历</h3>
        <p className="group-note">列出你已经获得的所有学位。</p>
        {p.degrees.map((d) => (
          <DegreeFields
            key={d.id}
            d={d}
            onChange={(nd) => set({ degrees: p.degrees.map((x) => (x.id === d.id ? nd : x)) })}
            onRemove={() => set({ degrees: p.degrees.filter((x) => x.id !== d.id) })}
          />
        ))}
        <button className="btn-ghost" onClick={() => set({ degrees: [...p.degrees, newDegree()] })}>
          + 添加学位
        </button>

        <h4>在读的高等学位</h4>
        {p.enrolled ? (
          <DegreeFields enrolled d={p.enrolled} onChange={(enrolled) => set({ enrolled })} onRemove={() => set({ enrolled: null })} />
        ) : (
          <button className="btn-ghost" onClick={() => set({ enrolled: newDegree("博士在读（PhD in progress）") })}>
            + 我目前在读高等学位
          </button>
        )}
      </section>

      </>)}

      {tab === "scholar" && (<>
      <section className="card">
        <h3>学术记录</h3>
        <small>
          可以从多个来源获取，每个来源各保留一份记录{cost ? `，每次获取 ${cost} 个 credit` : ""}
          。请确认主页是公开的，并且里面的文章都确实是你的。
        </small>
        <div className="src-row">
          <label>
            Google Scholar 主页链接
            <input
              type="url"
              value={p.scholarUrl}
              onChange={(e) => set({ scholarUrl: e.target.value })}
              placeholder="https://scholar.google.com/citations?user=..."
            />
          </label>
          <button className="btn-accent" disabled={Boolean(loading) || !isGs} onClick={fetchGs}>
            {loading === "gs" ? "正在获取…" : "获取"}
          </button>
        </div>
        <div className="src-row">
          <label>
            Semantic Scholar 主页链接
            <input
              type="url"
              value={p.s2Url}
              onChange={(e) => set({ s2Url: e.target.value })}
              placeholder="https://www.semanticscholar.org/author/...（不填则按英文姓名查找）"
            />
          </label>
          <button className="btn-accent" disabled={Boolean(loading) || (!isS2 && !fullName)} onClick={fetchS2}>
            {loading === "s2" ? "正在获取…" : isS2 ? "获取" : "按姓名查找"}
          </button>
        </div>
        <div>
          <button className="link" disabled={Boolean(loading) || !fullName} onClick={searchOa}>
            {loading === "oa" ? "正在查找…" : "两个主页都没有？按英文姓名在 OpenAlex 学术数据库里查找"}
          </button>
          {!fullName && <small> 按姓名查找前请先在上面填写英文姓名。</small>}
        </div>
        {scholarError && <div className="notice">{scholarError}</div>}
        {needUpload && (
          <div className="gs-upload">
            <strong>换一种方式：上传你自己保存的 Google Scholar 主页</strong>
            <ol>
              <li>在浏览器里打开你的 Google Scholar 主页，点页面底部的 SHOW MORE，直到所有论文都显示出来。</li>
              <li>按 Cmd + S（Windows 是 Ctrl + S），格式选「网页，仅 HTML」，保存。</li>
              <li>把保存下来的 .html 文件选到这里。</li>
            </ol>
            <input
              type="file"
              accept=".html,.htm,text/html"
              disabled={Boolean(loading)}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadGs(f);
                e.target.value = "";
              }}
            />
          </div>
        )}
        {candidates && (
          <div className="candidates">
            {candidates.list.length === 0 ? (
              <small>没有找到同名作者。可以检查姓名拼写，或者手动填写下面的数字。</small>
            ) : (
              <>
                <small>
                  在 {candidates.src === "s2" ? "Semantic Scholar" : "OpenAlex"} 里找到以下作者，请选择你本人：
                </small>
                {candidates.list.map((c) => (
                  <button key={c.id} onClick={() => pickAuthor(c)} disabled={Boolean(loading)}>
                    <strong>{c.name}</strong>
                    <span>
                      {c.institution || "机构未知"} · {c.papers} 篇论文 · 被引 {c.citations} 次
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
        <div className="grid2">
          <label>
            论文数
            <input value={p.papers} onChange={(e) => set({ papers: e.target.value, primarySource: "" })} inputMode="numeric" />
          </label>
          <label>
            总引用数
            <input value={p.citations} onChange={(e) => set({ citations: e.target.value, primarySource: "" })} inputMode="numeric" />
          </label>
          <label>
            h-index
            <input value={p.hIndex} onChange={(e) => set({ hIndex: e.target.value, primarySource: "" })} inputMode="numeric" />
          </label>
        </div>
        <small>
          这三个是 AI 写文书时默认使用的数字
          {p.primarySource ? `，目前取自 ${p.primarySource}` : p.records.length ? "，目前是你手动填写的" : ""}
          。可以直接改，也可以在下面某个来源里点「用这组数字」。
        </small>
        {p.records.map((r) => (
          <details className="pubs" key={r.source}>
            <summary>
              {r.source}：{r.papers || "?"} 篇论文 · 被引 {r.citations || "?"} · h-index {r.hIndex || "?"}
              {p.primarySource === r.source && "（主要）"}
              <span>
                {" "}
                {r.name && `${r.name}，`}
                {new Date(r.fetchedAt).toLocaleDateString("zh-CN")} 获取
              </span>
            </summary>
            <small>
              {SOURCE_NOTE[r.source]}
              {r.more && "主页上还有更多论文没有列出（只读取了引用最多的前 100 篇）。"}
              {r === main &&
                "在案件里新建「论文与引用记录」文档会用这份列表生成一份 Exhibit。作为证据递交时，建议同时把来源主页打印成 PDF（Cmd + P → 存储为 PDF）上传到案件的「文件」里，那是审查官认可的原始页面。"}
            </small>
            <ol>
              {r.publications.map((w, i) => (
                <li key={i}>
                  {w.title}
                  <span>{[w.venue, w.year, `被引 ${w.citations}`].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ol>
            <div className="rec-actions">
              {p.primarySource !== r.source && (
                <button className="link" onClick={() => set(primaryPatch(r))}>
                  用这组数字
                </button>
              )}
              <button
                className="link-danger"
                onClick={() =>
                  set({
                    records: p.records.filter((x) => x.source !== r.source),
                    ...(p.primarySource === r.source ? { primarySource: "" } : {}),
                  })
                }
              >
                删除这份记录
              </button>
            </div>
          </details>
        ))}
        <div className="field">
          <span>
            审稿次数
            <small>以感谢信或审稿证明为准，同一稿件的多轮审稿可分别计数。</small>
          </span>
          <Radio
            name="reviews"
            value={p.reviews}
            onChange={(reviews) => set({ reviews })}
            options={REVIEW_OPTIONS.map((v) => ({ value: v, label: v }))}
          />
        </div>
      </section>

      <Notable profile={p} setProfile={setProfile} />
      </>)}

      {tab === "basic" && (

      <section className="card">
        <h3>工作与未来计划</h3>
        <label>
          当前在美职位
          <small>用英文填写，如 PhD student at University of California, CA；Software Engineer at Amazon, WA。不在美国或待业填 N/A。</small>
          <input value={p.currentPosition} onChange={(e) => set({ currentPosition: e.target.value })} />
        </label>

        <div className="field">
          <span>
            未来在美工作，是否仍在同一或相近领域？
            <small>除非未来 6 个月内打算换工作，否则当前职位就视为你的拟从事工作。</small>
          </span>
          <Radio
            name="sameField"
            value={p.sameField}
            onChange={(sameField) => set({ sameField })}
            options={[
              { value: "yes", label: "是，继续在积累了主要成果的领域工作" },
              { value: "no", label: "否，我换了领域" },
            ]}
          />
          {p.sameField === "no" && (
            <div className="grid2">
              <label>
                原领域
                <input value={p.fieldFrom} onChange={(e) => set({ fieldFrom: e.target.value })} />
              </label>
              <label>
                新领域
                <input value={p.fieldTo} onChange={(e) => set({ fieldTo: e.target.value })} />
              </label>
            </div>
          )}
        </div>

        <div className="field">
          <span>
            是否仍在做与拟从事事业一致的研究并发表论文？
            <small>持续的产出能说明你仍活跃在该领域，有能力推进拟从事的事业。</small>
          </span>
          <Radio
            name="activeResearch"
            value={p.activeResearch}
            onChange={(activeResearch) => set({ activeResearch })}
            options={[
              { value: "yes", label: "是，仍在做研究并发表" },
              { value: "no", label: "否，已不再做研究或发表" },
            ]}
          />
          {p.activeResearch === "yes" && (
            <label>
              预计下一篇论文发表时间
              <input value={p.nextPaper} onChange={(e) => set({ nextPaper: e.target.value })} placeholder="MM/YYYY" />
            </label>
          )}
        </div>
      </section>
      )}

    </div>
  );
}
