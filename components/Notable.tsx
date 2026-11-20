"use client";

import { useMemo, useState } from "react";
import { useAccount } from "@/lib/account";
import { CITE_CATEGORIES, isSelected } from "@/lib/profile";
import type { CitationAnalysis, CiteCategory, Profile as ProfileData } from "@/lib/profile";

type Props = {
  profile: ProfileData;
  setProfile: React.Dispatch<React.SetStateAction<ProfileData>>;
};

const IMPORTANCE = { high: "重要", medium: "一般", low: "较弱" } as const;
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** 「我的档案」里的重要引用（Notable Citations）：逐篇论文分析别人是怎么引用它的 */
export default function Notable({ profile: p, setProfile }: Props) {
  const account = useAccount();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [custom, setCustom] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<Record<string, CiteCategory | "all" | "picked">>({});
  const min = account.me?.notableMin ?? 0;

  // 各来源的论文合在一起，按标题去重，被引多的在前
  const papers = useMemo(() => {
    const seen = new Map<string, { title: string; citations: number }>();
    for (const r of p.records)
      for (const w of r.publications) {
        const k = key(w.title);
        const old = seen.get(k);
        if (!old || w.citations > old.citations) seen.set(k, { title: w.title, citations: w.citations });
      }
    return [...seen.values()].sort((a, b) => b.citations - a.citations);
  }, [p.records]);
  const done = (title: string) => p.analyses.find((a) => key(a.title) === key(title));

  async function analyze(title: string) {
    if (!account.guard(min)) return;
    setBusy(title);
    setError("");
    try {
      const res = await fetch("/api/citations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.analysis) throw new Error(data?.error ?? "分析失败，请稍后再试。");
      const a: CitationAnalysis = data.analysis;
      setProfile((prev) => ({
        ...prev,
        analyses: [...prev.analyses.filter((x) => key(x.title) !== key(a.title)), a],
        updatedAt: Date.now(),
      }));
      setCustom("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setBusy("");
      account.refresh();
    }
  }

  const patch = (title: string, fn: (a: CitationAnalysis) => CitationAnalysis | null) =>
    setProfile((prev) => ({
      ...prev,
      analyses: prev.analyses.flatMap((a) => {
        if (a.title !== title) return [a];
        const next = fn(a);
        return next ? [next] : [];
      }),
      updatedAt: Date.now(),
    }));

  const shown = showAll ? papers : papers.slice(0, 8);

  return (
    <section className="card">
      <h3>重要引用（Notable Citations）</h3>
      <small>
        申请信里有分量的不是引用总数，而是别人具体怎么用了你的工作。这里逐篇查出引用你论文的文章里提到你的原句，
        区分高度评价、在你的工作上扩展、拿你做 baseline / benchmark、使用你的方法或数据，还是只是顺带提一下，并挑出值得写进申请信的。
        数据来自 Semantic Scholar，自引（有共同作者的）会自动排除。按实际用量扣 credit，引用多的论文一次大约 200–400 个。
      </small>

      {papers.length === 0 && (
        <small>还没有论文列表。先在上面的「学术记录」里获取一次，或者直接在下面输入论文标题。</small>
      )}
      {shown.length > 0 && (
        <div className="paper-pick">
          {shown.map((w) => (
            <div key={w.title}>
              <span>
                {w.title}
                <small>被引 {w.citations}</small>
              </span>
              <button className="btn-ghost" disabled={Boolean(busy)} onClick={() => analyze(w.title)}>
                {busy === w.title ? "分析中，约 1 分钟…" : done(w.title) ? "重新分析" : "分析引用"}
              </button>
            </div>
          ))}
          {papers.length > 8 && (
            <button className="link" onClick={() => setShowAll(!showAll)}>
              {showAll ? "收起" : `显示全部 ${papers.length} 篇`}
            </button>
          )}
        </div>
      )}
      <div className="src-row">
        <label>
          或者输入论文的完整英文标题
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="论文标题" />
        </label>
        <button className="btn-ghost" disabled={Boolean(busy) || custom.trim().length < 8} onClick={() => analyze(custom.trim())}>
          {busy && busy === custom.trim() ? "分析中…" : "分析引用"}
        </button>
      </div>
      {error && <div className="notice">{error}</div>}

      {p.analyses.map((a) => {
        const f = filter[a.title] ?? "picked";
        const picked = a.items.filter(isSelected);
        const list =
          f === "all" ? a.items : f === "picked" ? picked : a.items.filter((c) => c.category === f);
        const count = (c: CiteCategory) => a.items.filter((x) => x.category === c).length;
        return (
          <details className="pubs notable" key={a.title}>
            <summary>
              {a.title}
              <span>
                {" "}
                选出 {picked.length} 条 · {new Date(a.analyzedAt).toLocaleDateString("zh-CN")} 分析
              </span>
            </summary>
            <small>
              Semantic Scholar 收录了 {a.total} 条引用
              {a.scanned && a.scanned < a.total ? `，检查了其中 ${a.scanned} 条` : ""}，其中自引 {a.selfCitations}{" "}
              条；独立引用里有 {a.withContext} 条能看到引用原句，分析了其中最值得看的 {a.analyzed} 条。
              {a.analyzed === 0 && "这篇论文目前没有可分析的引用原句。"}
              打勾的会进入案件里的「重要引用」文档。原句是自动抽取的，写进申请信前请对照原论文核实。
            </small>
            {a.items.length > 0 && (
              <div className="chips">
                {(
                  [
                    ["picked", `已选 ${picked.length}`],
                    ["all", `全部 ${a.items.length}`],
                    ...(Object.keys(CITE_CATEGORIES) as CiteCategory[])
                      .filter((c) => count(c) > 0)
                      .map((c) => [c, `${CITE_CATEGORIES[c].zh} ${count(c)}`]),
                  ] as [CiteCategory | "all" | "picked", string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    className={f === id ? "chip on" : "chip"}
                    onClick={() => setFilter((x) => ({ ...x, [a.title]: id }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="cite-list">
              {list.length === 0 && a.items.length > 0 && <small>这一类下面没有引用。</small>}
              {list.map((c) => (
                <div className="cite" key={c.citingTitle}>
                  <label className="cite-head">
                    <input
                      type="checkbox"
                      checked={isSelected(c)}
                      onChange={(e) =>
                        patch(a.title, (x) => ({
                          ...x,
                          items: x.items.map((y) => (y === c ? { ...y, selected: e.target.checked } : y)),
                        }))
                      }
                    />
                    <span>
                      <span className="tag">{CITE_CATEGORIES[c.category].zh}</span>
                      <span className={`tag imp-${c.importance}`}>{IMPORTANCE[c.importance]}</span>
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          {c.citingTitle}
                        </a>
                      ) : (
                        c.citingTitle
                      )}
                    </span>
                  </label>
                  <div className="cite-meta">
                    {[c.authors, c.venue, c.year, `被引 ${c.citations}`].filter(Boolean).join(" · ")}
                    {c.topAuthor && ` · 作者中有资深学者 ${c.topAuthor}`}
                  </div>
                  {c.reason && <div className="cite-reason">{c.reason}</div>}
                  {c.contexts.map((q, i) => (
                    <blockquote key={i}>{q}</blockquote>
                  ))}
                </div>
              ))}
            </div>
            <button className="link-danger" onClick={() => patch(a.title, () => null)}>
              删除这篇的分析
            </button>
          </details>
        );
      })}
      {p.analyses.length > 0 && (
        <small>
          在案件的「文档」里新建「重要引用」，会把所有打勾的引用整理成一份英文清单；写 Petition Letter 时引用这份文档，AI
          就会用这些原句来论证你的工作被同行采用。
        </small>
      )}
    </section>
  );
}
