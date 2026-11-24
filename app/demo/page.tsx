"use client";

import { useState } from "react";
import demo from "@/lib/demoData.json";
import CiteMap from "@/components/CiteMap";
import { CITE_CATEGORIES, emptyProfile, isSelected } from "@/lib/profile";
import type { CitationAnalysis, CiteCategory, CiteMap as CiteMapData, Profile } from "@/lib/profile";

/**
 * 公开的功能演示：按姓名找到学术主页 → 读取引用数据 → 分析重要引用。
 * 用的是事先对一位公开学者真实跑出来的结果（lib/demoData.json），回放给访客看，所以不用登录、不扣 credit。
 */

const analyses = demo.analyses as CitationAnalysis[];
const IMPORTANCE = { high: "重要", medium: "一般", low: "较弱" } as const;
// 固定按北京时间显示，免得服务器生成的页面和访客浏览器算出来的日期差一天
const CAPTURED = new Date(analyses[0].analyzedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
type Filter = CiteCategory | "all" | "picked";
const [FIRST, ...REST] = demo.name.split(" ");
const baseProfile = (): Profile => ({
  ...emptyProfile(),
  firstName: FIRST,
  lastName: REST.join(" "),
  records: [
    {
      source: "Semantic Scholar",
      url: demo.url,
      name: demo.name,
      papers: String(demo.author.papers),
      citations: String(demo.author.citations),
      hIndex: String(demo.author.hIndex),
      publications: demo.works.map((w) => ({ title: w.title, year: w.year, venue: "", citations: w.citations })),
      fetchedAt: demo.citeMap.fetchedAt,
    },
  ],
});

export default function Demo() {
  const [step, setStep] = useState<0 | 1 | 2>(0); // 0 还没查，1 列出候选，2 已读取记录
  const [busy, setBusy] = useState("");
  const [shown, setShown] = useState<string[]>([]);
  const [filter, setFilter] = useState<Record<string, Filter>>({});
  const [mapProfile, setMapProfile] = useState<Profile>(baseProfile);
  const demoMap = () =>
    new Promise<void>((done) =>
      setTimeout(() => {
        setMapProfile((p) => ({ ...p, citeMap: demo.citeMap as CiteMapData }));
        done();
      }, 1500),
    );

  const after = (label: string, ms: number, fn: () => void) => {
    setBusy(label);
    setTimeout(() => {
      fn();
      setBusy("");
    }, ms);
  };
  const analysisOf = (title: string) => analyses.find((a) => a.title === title);

  return (
    <main style={{ display: "flex", height: "100dvh" }}>
      <div className="cases profile demo">
        <div className="case-head">
          <div>
            <h2>功能演示：一键拿到引用数据和重要引用</h2>
            <p>
              当前用户：test。下面用一位公开学者的公开学术数据做示范，每一步都只需要点一下。
            </p>
          </div>
          <a className="btn-accent" href="/">
            开始使用
          </a>
        </div>

        <section className="card">
          <h3>自己做要多久，这里要多久</h3>
          <div className="demo-compare">
            <div>
              <strong>自己找</strong>
              <small>
                一篇被引 1000 多次的论文，要逐篇打开引用它的文章，找到提到你的那句话，判断是夸奖、沿用还是顺带一提，再挑出能写进申请信的。
                一篇论文通常要几个小时到几天，几篇加起来是一两周的零碎时间。
              </small>
            </div>
            <div>
              <strong>在这里</strong>
              <small>
                点一下，每篇大约 1 分钟。读取学术记录一次 20 credits（约 $0.2），分析一篇论文的引用按用量扣，通常 150–250
                credits（约 $1.5–2.5，人民币十几块）。新用户注册送 200 credits（每天名额有限），够先试一篇。
              </small>
            </div>
          </div>
        </section>

        <section className="card">
          <h3>第一步：按姓名找到学术主页</h3>
          <div className="src-row">
            <label>
              姓名
              <input value={demo.name} readOnly />
            </label>
            <button className="btn-accent" disabled={Boolean(busy) || step > 0} onClick={() => after("search", 700, () => setStep(1))}>
              {busy === "search" ? "查找中…" : "按姓名查找"}
            </button>
          </div>
          {step === 0 && (
            <small>不想按姓名找的话，也可以直接粘贴自己的 Google Scholar 或 Semantic Scholar 主页链接，几个来源可以同时用。</small>
          )}
          {step === 1 && (
            <div className="candidates">
              <small>在 Semantic Scholar 里找到以下同名作者，选出本人（演示里请点论文最多的那一位）：</small>
              {demo.candidates.map((c) => (
                <button
                  key={c.id}
                  disabled={Boolean(busy) || c.id !== demo.author.id}
                  onClick={() => after("record", 900, () => setStep(2))}
                >
                  {c.name}
                  <span>
                    {[c.institution, `${c.papers} 篇论文`, `被引 ${c.citations}`, `h-index ${c.hIndex}`].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
              {busy === "record" && <small>正在读取学术记录…</small>}
            </div>
          )}
          {step === 2 && (
            <small>
              已找到主页：
              <a href={demo.url} target="_blank" rel="noreferrer">
                {demo.url}
              </a>
            </small>
          )}
        </section>

        {step === 2 && (
          <section className="card">
            <h3>第二步：引用数据自动填好</h3>
            <div className="demo-metrics">
              <div>
                <strong>{demo.author.papers}</strong>
                <small>论文</small>
              </div>
              <div>
                <strong>{demo.author.citations.toLocaleString("en-US")}</strong>
                <small>总被引</small>
              </div>
              <div>
                <strong>{demo.author.hIndex}</strong>
                <small>h-index</small>
              </div>
            </div>
            <small>
              来源：Semantic Scholar。实际使用时还可以同时接 Google Scholar，几个来源的数字并排显示，自己选用哪个。下面是被引最多的几篇，共读到{" "}
              {demo.total} 篇。
            </small>
            <h3>第三步：分析每篇论文是怎么被引用的</h3>
            <div className="paper-pick">
              {demo.works.map((w) => {
                const a = analysisOf(w.title);
                const open = shown.includes(w.title);
                return (
                  <div key={w.title}>
                    <span>
                      {w.title}
                      <small>
                        {[w.year, `被引 ${w.citations}`].filter(Boolean).join(" · ")}
                      </small>
                    </span>
                    {a ? (
                      <button
                        className={open ? "btn-ghost" : "btn-accent"}
                        disabled={Boolean(busy) || open}
                        onClick={() => after(w.title, 1600, () => setShown((s) => [...s, w.title]))}
                      >
                        {busy === w.title ? "分析中…" : open ? "已分析" : "分析引用"}
                      </button>
                    ) : (
                      <small>演示未包含</small>
                    )}
                  </div>
                );
              })}
            </div>
            <small>演示里准备了两篇论文的分析结果（带绿色按钮的两篇）。实际使用时任何一篇都可以分析，每篇约 1 分钟。</small>

            {analyses
              .filter((a) => shown.includes(a.title))
              .map((a) => {
                const f = filter[a.title] ?? "picked";
                const picked = a.items.filter(isSelected);
                const list = f === "all" ? a.items : f === "picked" ? picked : a.items.filter((c) => c.category === f);
                const count = (c: CiteCategory) => a.items.filter((x) => x.category === c).length;
                return (
                  <details className="pubs notable" key={a.title} open>
                    <summary>
                      {a.title}
                      <span> 选出 {picked.length} 条重要引用</span>
                    </summary>
                    <small>
                      Semantic Scholar 收录了 {a.total} 条引用，其中自引 {a.selfCitations} 条已排除；独立引用里有 {a.withContext}{" "}
                      条能看到引用原句，分析了其中最值得看的 {a.analyzed} 条。引用原句是原文照录，没有改写。点下面的分类可以筛选。
                    </small>
                    <div className="chips">
                      {(
                        [
                          ["picked", `重要 ${picked.length}`],
                          ["all", `全部 ${a.items.length}`],
                          ...(Object.keys(CITE_CATEGORIES) as CiteCategory[])
                            .filter((c) => count(c) > 0)
                            .map((c) => [c, `${CITE_CATEGORIES[c].zh} ${count(c)}`]),
                        ] as [Filter, string][]
                      ).map(([id, label]) => (
                        <button key={id} className={f === id ? "chip on" : "chip"} onClick={() => setFilter((x) => ({ ...x, [a.title]: id }))}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="cite-list">
                      {list.map((c) => (
                        <div className="cite" key={c.citingTitle}>
                          <div className="cite-head">
                            <span>
                              <span className="tag">{CITE_CATEGORIES[c.category].zh}</span>
                              <span className={`tag imp-${c.importance}`}>{IMPORTANCE[c.importance]}</span>
                              {c.url ? (
                                <a href={c.url} target="_blank" rel="noreferrer">
                                  {c.citingTitle}
                                </a>
                              ) : (
                                c.citingTitle
                              )}
                            </span>
                          </div>
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
                  </details>
                );
              })}
          </section>
        )}

        {step === 2 && <CiteMap profile={mapProfile} setProfile={setMapProfile} demoRun={demoMap} />}

        <p className="disclaimer">
          演示数据是 {CAPTURED} 用本站功能对公开学术数据（Semantic Scholar）实际跑出来的结果，这里原样回放，所以不用登录、不扣费。
          所示学者与本站没有任何关系，仅用其公开的学术记录说明功能。分类和重要程度由 AI 判断，写进申请信前请对照原论文核实。
        </p>
      </div>
    </main>
  );
}
