/** 解析 Google Scholar 个人主页的 HTML（直接抓取的，或用户在浏览器里另存的） */

export type ScholarResult = {
  source: "Google Scholar";
  author: { name: string; papers: number; citations: number; hIndex: number | null; more: boolean };
  works: { title: string; year: number | null; venue: string; citations: number }[];
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function text(html: string): string {
  return html
    .replace(/<[^<>]{0,2000}>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_HTML = 3_000_000;
const MAX_ROWS = 2000;
const ROW_MAX = 8000; // 一行论文的 HTML 最长看这么多

/**
 * 逐行扫描，不对整份网页跑带回溯的正则：上传的文件是用户给的，特意构造的内容不能让服务器卡住。
 */
export function parseScholarHtml(html: string): ScholarResult | null {
  if (html.length > MAX_HTML) return null;
  const ni = html.indexOf('id="gsc_prf_in"');
  if (ni === -1) return null;
  const nOpen = html.indexOf(">", ni);
  const nClose = nOpen === -1 ? -1 : html.indexOf("</div>", nOpen);
  if (nClose === -1 || nClose - nOpen > 600) return null;
  const name = text(html.slice(nOpen + 1, nClose));

  const works: ScholarResult["works"] = [];
  let pos = 0;
  for (let n = 0; n < MAX_ROWS; n++) {
    const i = html.indexOf('class="gsc_a_tr"', pos);
    if (i === -1) break;
    const end = html.indexOf("</tr>", i);
    const stop = end === -1 || end - i > ROW_MAX ? i + ROW_MAX : end;
    const r = html.slice(i, stop);
    pos = end === -1 ? i + 16 : stop;
    const title = r.match(/class="gsc_a_at"[^>]{0,400}>([\s\S]{0,3000}?)<\/a>/);
    const gray = [...r.matchAll(/<div class="gs_gray"[^>]{0,200}>([\s\S]{0,3000}?)<\/div>/g)].map((m) => m[1]);
    const cites = r.match(/class="gsc_a_ac[^"]{0,60}"[^>]{0,400}>(\d{0,9})<\/a>/);
    const year = r.match(/class="gsc_a_h[^"]{0,60}"[^>]{0,200}>(\d{0,4})<\/span>/);
    const t = title ? text(title[1]) : "";
    if (!t) continue;
    works.push({
      title: t,
      // 第二行灰字是「期刊 卷期页码, 年份」，把末尾的年份去掉
      venue: gray[1] ? text(gray[1]).replace(/,\s*\d{4}$/, "") : "",
      year: year && year[1] ? Number(year[1]) : null,
      citations: cites && cites[1] ? Number(cites[1]) : 0,
    });
  }
  if (!works.length) return null;
  // 用户保存网页前可能把主页按年份排过序；后面的功能都假定论文是按被引次数从多到少排的
  works.sort((a, b) => b.citations - a.citations);

  // 统计表依次是：总引用、近五年引用、h-index、近五年 h-index、i10、近五年 i10
  const stats = [...html.matchAll(/class="gsc_rsb_std"[^>]{0,100}>(\d{1,9})<\/td>/g)].slice(0, 6).map((m) => Number(m[1]));

  // 「展开」按钮没被禁用，说明主页上还有没列出来的论文
  const mi = html.indexOf('id="gsc_bpf_more"');
  let more = false;
  if (mi !== -1) {
    const open = html.lastIndexOf("<button", mi);
    const close = html.indexOf(">", mi);
    const tag = open !== -1 && mi - open < 400 && close !== -1 && close - mi < 400 ? html.slice(open, close) : "";
    more = Boolean(tag) && !/\bdisabled\b/.test(tag);
  }
  return {
    source: "Google Scholar",
    author: {
      name,
      papers: works.length,
      citations: stats[0] ?? works.reduce((n, w) => n + w.citations, 0),
      hIndex: stats[2] ?? null,
      more,
    },
    works,
  };
}

/** 用户贴链接时常常不带 https://，补上再解析 */
export const withScheme = (url: string) => (/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);

/** 从用户填的链接里取出 Google Scholar 的用户 ID；不是 Scholar 链接时返回 null */
export function scholarUserId(url: string): string | null {
  try {
    const u = new URL(withScheme(url));
    if (!/(^|\.)scholar\.google\./.test(u.hostname)) return null;
    const id = u.searchParams.get("user");
    return id && /^[\w-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * 直接读取公开的 Scholar 主页。Google 会拦截云服务器的访问，被拦时返回 "blocked"，
 * 由前端改为让用户上传自己另存的网页。
 */
export async function fetchScholar(userId: string): Promise<ScholarResult | "blocked" | null> {
  try {
    const res = await fetch(`https://scholar.google.com/citations?hl=en&user=${userId}&pagesize=100`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) return "blocked";
    return parseScholarHtml(await res.text()) ?? "blocked";
  } catch {
    return "blocked";
  }
}
