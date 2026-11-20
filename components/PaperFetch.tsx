"use client";

import { useMemo, useState } from "react";
import { useAccount } from "@/lib/account";
import { putFile } from "@/lib/files";
import { isSelected, primaryRecord } from "@/lib/profile";
import type { Profile } from "@/lib/profile";
import { uid } from "@/lib/types";
import type { Attachment, DocFile, ImmigrationCase } from "@/lib/types";

type Props = {
  c: ImmigrationCase;
  docs: DocFile[]; // 这个案件里的文档
  profile: Profile;
  patchCase: (fn: (c: ImmigrationCase) => ImmigrationCase) => void;
};

type Paper = { key: string; title: string; kind: "own" | "citing"; url?: string; note: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const OWN_PREFIX = "Paper - ";
const CITING_PREFIX = "Citing - ";
const PREPRINT = " [arXiv preprint]";
const fileName = (p: Paper, preprint = false) =>
  `${p.kind === "own" ? OWN_PREFIX : CITING_PREFIX}${p.title.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 90).trim()}${preprint ? PREPRINT : ""}.pdf`;

/** 是不是「一键下载」存进来的论文 PDF（申请向导用它判断这一步做没做） */
export const isPaperFile = (f: Attachment) => f.name.startsWith(OWN_PREFIX) || f.name.startsWith(CITING_PREFIX);

/** 案件「文件」页里的一键下载论文 PDF：自己的论文，以及选中的重要引用的论文 */
export default function PaperFetch({ c, docs, profile: p, patchCase }: Props) {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const files = c.files ?? [];
  const docText = useMemo(() => norm(docs.map((d) => d.content).join("\n")), [docs]);

  const papers = useMemo(() => {
    const list: Paper[] = [];
    const seen = new Set<string>();
    const add = (x: Paper) => {
      if (!seen.has(x.key)) {
        seen.add(x.key);
        list.push(x);
      }
    };
    for (const w of primaryRecord(p)?.publications.slice(0, 20) ?? [])
      add({ key: norm(w.title), title: w.title, kind: "own", note: `我的论文 · 被引 ${w.citations}` });
    for (const a of p.analyses)
      for (const x of a.items.filter(isSelected))
        add({ key: norm(x.citingTitle), title: x.citingTitle, kind: "citing", url: x.url, note: "引用我的论文（重要引用）" });
    return list;
  }, [p]);

  const have = (x: Paper) => files.some((f) => f.name === fileName(x) || f.name === fileName(x, true));
  const havePreprint = (x: Paper) => files.some((f) => f.name === fileName(x, true));
  // 标题出现在案件文档里，说明文书用到了这篇
  const used = (x: Paper) => x.key.length > 12 && docText.includes(x.key);
  // 默认勾选：文书里用到的，以及重要引用的论文
  const isOn = (x: Paper) => picked[x.key] ?? ((used(x) || x.kind === "citing") && !have(x));
  const todo = papers.filter((x) => isOn(x) && !have(x));
  const usedMissing = papers.filter((x) => used(x) && !have(x)).length;

  async function run() {
    if (!account.guard(0)) return;
    setBusy(true);
    for (const x of todo) {
      setStatus((s) => ({ ...s, [x.key]: "下载中…" }));
      try {
        const res = await fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: x.title, url: x.url }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.data) throw new Error(data?.error ?? "下载失败");
        const pre = data.version === "preprint";
        const att: Attachment = { id: uid(), name: fileName(x, pre), type: "application/pdf", size: data.size };
        await putFile(att.id, data.data);
        patchCase((cc) => ({ ...cc, files: [...(cc.files ?? []), att] }));
        setStatus((s) => ({
          ...s,
          [x.key]: !pre
            ? `已保存正式发表版本（${data.source}）`
            : data.venue
              ? `已保存 arXiv 预印本。这篇已在 ${data.venue} 正式发表，建议自己下载正式版，在文件列表里点「替换」`
              : "已保存 arXiv 预印本（没有查到正式发表的版本）",
        }));
      } catch (e) {
        setStatus((s) => ({ ...s, [x.key]: e instanceof Error ? e.message : "下载失败" }));
      }
    }
    setBusy(false);
  }

  if (papers.length === 0) return null;

  return (
    <div className="paper-fetch">
      <div className="paper-fetch-head">
        <div>
          <strong>一键下载论文 PDF</strong>
          <small>
            把你的论文和重要引用的论文下载到这个案件里，作为 Exhibit 一起打包。
            {usedMissing > 0 && ` 文书里用到了 ${usedMissing} 篇还没有下载。`}
          </small>
        </div>
        <button className="btn-ghost" onClick={() => setOpen(!open)}>
          {open ? "收起" : `选择论文（${papers.length}）`}
        </button>
        <button className="btn-accent" disabled={busy || todo.length === 0} onClick={run}>
          {busy ? "下载中…" : `下载 ${todo.length} 篇`}
        </button>
      </div>
      {(open || Object.keys(status).length > 0) && (
        <div className="paper-fetch-list">
          {papers.map((x) => (
            <label key={x.key} className="item">
              <input
                type="checkbox"
                checked={have(x) || isOn(x)}
                disabled={have(x) || busy}
                onChange={(e) => setPicked((s) => ({ ...s, [x.key]: e.target.checked }))}
              />
              <span>
                {x.title}
                <small>
                  {x.note}
                  {used(x) && " · 文书中已引用"}
                  {status[x.key]
                    ? ` · ${status[x.key]}`
                    : havePreprint(x)
                      ? " · 已在案件文件里（arXiv 预印本，有正式发表版本的话建议替换）"
                      : have(x)
                        ? " · 已在案件文件里"
                        : ""}
                </small>
              </span>
            </label>
          ))}
          <small>
            优先下载正式发表的版本；拿不到公开的正式版时用 arXiv 预印本代替，文件名会标上 [arXiv preprint]。
            预印本和正式版的内容、页码可能不同，作为证据最好用正式发表的版本：请自己到会议或出版社网站下载正式版，然后在下面的文件列表里点那一行的「替换」上传，它会顶替预印本，打包顺序不变。
            需要订阅才能看、也没有预印本的论文同样需要自己下载上传。
            作为证据时一般只需要论文的前几页和提到你的那一页，整篇放进去会让材料包很厚，可以在「打包下载」里把不需要的去掉。
          </small>
        </div>
      )}
    </div>
  );
}
