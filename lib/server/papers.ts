/**
 * 找一篇论文的公开全文 PDF 并下载下来。
 * 只取开放获取（open access）的版本。优先正式发表的版本（ACL Anthology、出版方或会议网站上的开放 PDF），
 * 没有时才用 arXiv 预印本，并告诉调用方这是预印本、这篇论文有没有正式发表。
 * 需要订阅才能看的论文拿不到，由用户自己下载后上传。
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { s2 } from "./semanticScholar";
import { sameTitle } from "@/lib/titles";

const MAX_BYTES = 20 * 1024 * 1024;

/** 只允许访问公网上的 https 地址，避免被引到内网 */
async function publicHttps(raw: string): Promise<URL | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname;
  if (isIP(host) || host === "localhost" || /\.(local|internal|lan)$/i.test(host)) return null;
  try {
    const addrs = await lookup(host, { all: true });
    const priv = (a: string) =>
      /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a) ||
      /^(::1$|fc|fd|fe80:|::ffff:)/i.test(a);
    if (!addrs.length || addrs.some((a) => priv(a.address))) return null;
  } catch {
    return null;
  }
  return u;
}

async function download(raw: string): Promise<Uint8Array | null> {
  let url = raw;
  for (let hop = 0; hop < 6; hop++) {
    const u = await publicHttps(url);
    if (!u) return null;
    const res = await fetch(u, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; paper-fetch)", Accept: "application/pdf,*/*" },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return null;
      url = new URL(next, u).toString();
      continue;
    }
    if (!res.ok || !res.body) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.length;
    }
    // 有些地址返回的是网页而不是 PDF
    return String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-" ? bytes : null;
  }
  return null;
}

export type PaperPdf = {
  title: string;
  bytes: Uint8Array;
  source: string;
  version: "published" | "preprint";
  venue: string; // 正式发表的刊物或会议；只有预印本时为空
};

/**
 * @param title 论文标题
 * @param hint  已知的论文链接（doi.org / arxiv.org），有的话更准
 * @returns 找到并下载成功时返回 PDF；"closed" 表示找到了论文但没有公开的 PDF；null 表示没找到论文
 */
export async function fetchPaperPdf(title: string, hint?: string): Promise<PaperPdf | "closed" | null> {
  const fields = "title,venue,externalIds,openAccessPdf";
  let paper: { title?: string; venue?: string; externalIds?: Record<string, string>; openAccessPdf?: { url?: string } } | undefined;
  const doi = hint?.match(/doi\.org\/(10\.[^\s?#]+)/i)?.[1];
  const arxiv = hint?.match(/arxiv\.org\/(?:abs|pdf)\/([\w.\/-]+?)(?:\.pdf)?$/i)?.[1];
  try {
    if (doi) paper = await s2(`/paper/DOI:${doi}`, { fields });
    else if (arxiv) paper = await s2(`/paper/arXiv:${arxiv}`, { fields });
  } catch {
    // 按链接没查到就退回按标题查
  }
  if (!paper) {
    try {
      const m = await s2("/paper/search/match", { query: title, fields });
      paper = m.data?.[0];
    } catch (e) {
      if (!(e instanceof Error && e.message === "404")) throw e;
    }
    if (!paper || !sameTitle(title, paper.title ?? "")) paper = undefined;
  }
  if (!paper && !arxiv) return null;

  const ids = paper?.externalIds ?? {};
  const isArxiv = (u: string) => /(^|\/\/|\.)arxiv\.org\//i.test(u);
  const oa = paper?.openAccessPdf?.url;
  const ax = ids.ArXiv ?? arxiv;
  // 这篇论文有没有正式发表：有 arXiv 以外的刊物名
  const venue = paper?.venue && !/^arxiv/i.test(paper.venue) ? paper.venue : "";
  // 先正式发表的版本，最后才是 arXiv 预印本
  const candidates: [string, string, PaperPdf["version"]][] = [];
  if (ids.ACL) candidates.push([`https://aclanthology.org/${ids.ACL}.pdf`, "ACL Anthology", "published"]);
  if (oa && !isArxiv(oa)) candidates.push([oa, "出版方的开放获取版本", "published"]);
  if (ax) candidates.push([`https://arxiv.org/pdf/${ax}`, "arXiv", "preprint"]);
  else if (oa && isArxiv(oa)) candidates.push([oa, "arXiv", "preprint"]);

  for (const [url, source, version] of candidates) {
    try {
      const bytes = await download(url);
      if (bytes) return { title: paper?.title ?? title, bytes, source, version, venue };
    } catch {
      // 换下一个地址
    }
  }
  return "closed";
}
