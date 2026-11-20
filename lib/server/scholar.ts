/** 解析 Google Scholar 个人主页的 HTML（直接抓取的，或用户在浏览器里另存的） */

export type ScholarResult = {
  source: "Google Scholar";
  author: { name: string; papers: number; citations: number; hIndex: number | null; more: boolean };
  works: { title: string; year: number | null; venue: string; citations: number }[];
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

export function parseScholarHtml(html: string): ScholarResult | null {
  const name = html.match(/id="gsc_prf_in"[^>]*>([\s\S]*?)<\/div>/);
  const rows = html.match(/<tr[^>]*class="gsc_a_tr"[^>]*>[\s\S]*?<\/tr>/g);
  if (!name || !rows) return null;

  // 统计表依次是：总引用、近五年引用、h-index、近五年 h-index、i10、近五年 i10
  const stats = [...html.matchAll(/class="gsc_rsb_std"[^>]*>(\d+)<\/td>/g)].map((m) => Number(m[1]));

  const works = rows
    .map((r) => {
      const title = r.match(/class="gsc_a_at"[^>]*>([\s\S]*?)<\/a>/);
      const gray = [...r.matchAll(/<div class="gs_gray"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1]);
      const cites = r.match(/class="gsc_a_ac[^"]*"[^>]*>(\d*)<\/a>/);
      const year = r.match(/class="gsc_a_h[^"]*"[^>]*>(\d*)<\/span>/);
      return {
        title: title ? text(title[1]) : "",
        // 第二行灰字是「期刊 卷期页码, 年份」，把末尾的年份去掉
        venue: gray[1] ? text(gray[1]).replace(/,\s*\d{4}$/, "") : "",
        year: year && year[1] ? Number(year[1]) : null,
        citations: cites && cites[1] ? Number(cites[1]) : 0,
      };
    })
    .filter((w) => w.title);
  if (!works.length) return null;

  // 「展开」按钮没被禁用，说明主页上还有没列出来的论文
  const more = html.match(/<button[^>]*id="gsc_bpf_more"[^>]*>/);
  return {
    source: "Google Scholar",
    author: {
      name: text(name[1]),
      papers: works.length,
      citations: stats[0] ?? works.reduce((n, w) => n + w.citations, 0),
      hIndex: stats[2] ?? null,
      more: Boolean(more && !/\bdisabled\b/.test(more[0])),
    },
    works,
  };
}

/** 从用户填的链接里取出 Google Scholar 的用户 ID；不是 Scholar 链接时返回 null */
export function scholarUserId(url: string): string | null {
  try {
    const u = new URL(url.trim());
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
