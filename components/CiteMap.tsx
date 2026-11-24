"use client";

import { useMemo, useRef, useState } from "react";
import { useAccount } from "@/lib/account";
import type { CiteMap as CiteMapData, Profile as ProfileData } from "@/lib/profile";
import { begin, end, useRunning } from "@/lib/running";
import { normTitle } from "@/lib/titles";
import world from "@/lib/worldMap.json";

type Props = {
  profile: ProfileData;
  setProfile: React.Dispatch<React.SetStateAction<ProfileData>>;
  /** 演示页用：不调接口，由调用方把事先准备好的结果放进档案 */
  demoRun?: () => Promise<void>;
};

const COST = 30;
const key = normTitle;
// 由浅到深五档，按引用数的对数分档，免得第一名把其他国家都压成最浅
const SHADES = ["#d5e8df", "#a6cfbd", "#6fb096", "#3f8a6c", "#1f5f4a"];
const EMPTY = "#eceae3";

/** 「我的档案」里的引用地图：引用你论文的人分布在世界上哪些国家和机构 */
export default function CiteMap({ profile: p, setProfile, demoRun }: Props) {
  const account = useAccount();
  const run0 = useRunning();
  const [demoBusy, setDemoBusy] = useState(false);
  const busy = demoBusy || Boolean(run0.running.citemap);
  const error = run0.errors.citemap ?? "";
  const svgRef = useRef<SVGSVGElement>(null);
  const m: CiteMapData | undefined = p.citeMap;

  // 各来源的论文合在一起，按标题去重，被引多的在前
  const titles = useMemo(() => {
    const seen = new Map<string, { title: string; citations: number }>();
    for (const r of p.records)
      for (const w of r.publications) {
        const k = key(w.title);
        const old = seen.get(k);
        if (!old || w.citations > old.citations) seen.set(k, { title: w.title, citations: w.citations });
      }
    return [...seen.values()].sort((a, b) => b.citations - a.citations).slice(0, 12).map((w) => w.title);
  }, [p.records]);

  const byCode = useMemo(() => new Map((m?.countries ?? []).map((c) => [c.code, c.count])), [m]);
  const max = Math.max(1, ...(m?.countries ?? []).map((c) => c.count));
  const shade = (n: number | undefined) =>
    !n ? EMPTY : SHADES[Math.min(SHADES.length - 1, Math.floor((Math.log(n) / Math.log(max + 1)) * SHADES.length))];
  const zh = useMemo(() => {
    try {
      return new Intl.DisplayNames(["zh-CN"], { type: "region" });
    } catch {
      return null;
    }
  }, []);
  const zhName = (c: { code: string; name: string }) => {
    try {
      return zh?.of(c.code) ?? c.name;
    } catch {
      return c.name;
    }
  };

  async function run() {
    if (demoRun) {
      setDemoBusy(true);
      await demoRun();
      setDemoBusy(false);
      return;
    }
    if (!account.guard(COST)) return;
    if (!begin("citemap")) return;
    let problem = "";
    try {
      const res = await fetch("/api/citemap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titles, lastName: p.lastName }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.map) throw new Error(data?.error ?? "生成失败，请稍后再试。");
      setProfile((prev) => ({ ...prev, citeMap: data.map, updatedAt: Date.now() }));
    } catch (e) {
      problem = e instanceof Error ? e.message : "生成失败";
    } finally {
      end("citemap", problem);
      account.refresh();
    }
  }

  /** 把地图存成 PNG 图片，可以上传到案件文件里作为 Exhibit */
  function download() {
    const svg = svgRef.current;
    if (!svg) return;
    // 导出用的副本写明宽高：有的浏览器画不出只有 viewBox、没有尺寸的 SVG，会得到一张空白图
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute("width", String(svg.viewBox.baseVal.width));
    copy.setAttribute("height", String(svg.viewBox.baseVal.height));
    const xml = new XMLSerializer().serializeToString(copy);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = svg.viewBox.baseVal.width * scale;
      canvas.height = svg.viewBox.baseVal.height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "Citation Map.png";
      a.click();
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  }

  const top = (m?.countries ?? []).slice(0, 10);
  const H = world.h + 86; // 地图上方留标题，下方留图例

  return (
    <section className="card">
      <h3>引用地图（Citation Map）</h3>
      <small>
        引用你论文的人分布在世界上哪些国家、哪些机构。用来说明你的工作有国际范围的影响，可以作为一页证据放进材料包。
        按你被引最多的 {Math.min(12, titles.length) || 12} 篇论文统计，数据来自 OpenAlex；生成一次扣 {COST} credits。
      </small>
      <div className="src-row">
        <button className="btn-accent" disabled={busy || titles.length === 0} onClick={run}>
          {busy ? "生成中，约半分钟…" : m ? "重新生成" : "生成引用地图"}
        </button>
        {m && (
          <button className="btn-ghost" onClick={download}>
            下载图片（PNG）
          </button>
        )}
      </div>
      {titles.length === 0 && <small>还没有论文列表。先在上面的「学术记录」里获取一次。</small>}
      {error && <div className="notice">{error}</div>}

      {m && (
        <>
          <svg ref={svgRef} className="cite-map" viewBox={`0 0 ${world.w} ${H}`} xmlns="http://www.w3.org/2000/svg" fontFamily="Arial, Helvetica, sans-serif">
            <rect width={world.w} height={H} fill="#ffffff" />
            <text x={world.w / 2} y={26} textAnchor="middle" fontSize={18} fontWeight={700} fill="#1d1f1c">
              {`Citation Map${[p.firstName, p.lastName].filter(Boolean).length ? ` of ${[p.firstName, p.lastName].filter(Boolean).join(" ")}` : ""}`}
            </text>
            <text x={world.w / 2} y={46} textAnchor="middle" fontSize={12} fill="#6f726b">
              {`${m.citing.toLocaleString("en-US")} citing publications from ${m.countries.length} countries and regions${m.selfExcluded ? " (self-citations excluded)" : ""}`}
            </text>
            <g transform="translate(0,52)">
              {world.countries.map((c, i) => (
                <path key={i} d={c.d} fill={shade(byCode.get(c.a))} stroke="#ffffff" strokeWidth={0.5}>
                  <title>{`${c.n}: ${byCode.get(c.a) ?? 0}`}</title>
                </path>
              ))}
              {top.slice(0, 8).map((c) => {
                const g = world.countries.find((x) => x.a === c.code);
                return g ? (
                  <text key={c.code} x={g.c[0]} y={g.c[1]} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1d1f1c" stroke="#ffffff" strokeWidth={2.5} paintOrder="stroke">
                    {c.count}
                  </text>
                ) : null;
              })}
            </g>
            <g transform={`translate(24,${H - 22})`}>
              <text x={0} y={10} fontSize={11} fill="#6f726b">
                Fewer
              </text>
              {SHADES.map((s, i) => (
                <rect key={s} x={40 + i * 26} y={0} width={24} height={12} fill={s} />
              ))}
              <text x={40 + SHADES.length * 26 + 6} y={10} fontSize={11} fill="#6f726b">
                More citing publications
              </text>
              <text x={world.w - 48} y={10} textAnchor="end" fontSize={10} fill="#6f726b">
                {`Source: OpenAlex, retrieved ${new Date(m.fetchedAt).toISOString().slice(0, 10)}`}
              </text>
            </g>
          </svg>
          <div className="cite-map-lists">
            <div>
              <strong>引用最多的国家和地区</strong>
              <ol>
                {top.map((c) => (
                  <li key={c.code}>
                    {zhName(c)}
                    <span>{c.count}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <strong>引用最多的机构</strong>
              <ol>
                {m.institutions.slice(0, 10).map((x) => (
                  <li key={x.name}>
                    {x.name}
                    <span>{x.count}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <small>
            统计了你的 {m.papers} 篇论文，共有 {m.citing.toLocaleString("en-US")} 篇文章引用，
            {m.selfExcluded ? "已排除你本人参与的文章。" : "没能在作者里认出你本人，所以没有排除自引（请确认「基本资料」里的姓填的是论文上的拼写）。"}
            一篇文章的作者来自几个国家，就在几个国家各算一次，所以各国相加会大于总数。OpenAlex 的收录和 Google Scholar
            不完全一样，数字会有出入；有些文章查不到作者单位，没有计入地图。图片上的文字是英文的，可以直接用作证据。
          </small>
        </>
      )}
    </section>
  );
}
