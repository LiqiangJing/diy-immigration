"use client";

import { isPaperFile } from "@/components/PaperFetch";
import { claimsReady, EB1A_CRITERIA, EXCEPTIONAL_CRITERIA, MIN_CLAIMS } from "@/lib/claims";
import type { Claim } from "@/lib/claims";
import { isSelected } from "@/lib/profile";
import type { Profile } from "@/lib/profile";
import { workflowById } from "@/lib/skills";
import type { Workflow } from "@/lib/skills";
import type { DocFile, ImmigrationCase } from "@/lib/types";

type Props = {
  c: ImmigrationCase;
  docs: DocFile[]; // 这个案件里的文档
  profile: Profile;
  patchCase: (fn: (c: ImmigrationCase) => ImmigrationCase) => void;
  onWorkflow: (w: Workflow) => void;
  onCreate: (kind: string) => void;
  onOpenDoc: (id: string) => void;
  goTab: (t: "files" | "pack") => void;
  goProfile: () => void;
};

type Action = { label: string; run: () => void };
type Step = {
  id: string;
  title: string;
  desc: string;
  optional?: boolean;
  done: boolean; // 根据案件里已有的内容自动判断
  have?: string; // 已有内容的简述
  body?: React.ReactNode; // 直接在这一步里操作的内容
  actions: Action[];
};

/** 申请向导：从填档案到打包下载，按顺序列出每一步，并根据案件里已有的内容判断做到哪了 */
export default function Guide({ c, docs, profile: p, patchCase, onWorkflow, onCreate, onOpenDoc, goTab, goProfile }: Props) {
  const files = c.files ?? [];
  const written = docs.filter((d) => d.content.trim());
  const bySkill = (...ids: string[]) => written.filter((d) => d.skill && ids.includes(d.skill));
  const byKind = (kind: string) => written.filter((d) => d.kind === kind);
  const fileLike = (re: RegExp) => files.filter((f) => re.test(f.name));
  const names = (list: { title?: string; name?: string }[]) =>
    list
      .slice(0, 3)
      .map((x) => x.title ?? x.name)
      .join("、") + (list.length > 3 ? ` 等 ${list.length} 份` : "");

  const start = (id: string): Action => {
    const w = workflowById(id)!;
    return { label: `和 AI 一起做：${w.title}`, run: () => onWorkflow(w) };
  };
  const openDocs = (list: DocFile[]): Action[] =>
    list.slice(0, 3).map((d) => ({ label: `打开「${d.title}」`, run: () => onOpenDoc(d.id) }));
  const upload: Action = { label: "去上传文件", run: () => goTab("files") };
  const toProfile: Action = { label: "去「我的档案」", run: goProfile };

  const assess = bySkill("case-strength-assessor");
  const letters = [...new Set([...bySkill("expert-letter-drafter"), ...byKind("推荐信")])];
  const letterFiles = fileLike(/recommend|reference|letter|推荐|\brl\b/i);
  const pl = [...new Set([...bySkill("niw-petition-narrative", "eb1a-petition-narrative"), ...byKind("Petition Letter")])];
  const endeavor = byKind("Proposed Endeavor 陈述");
  const notable = byKind("重要引用");
  const picked = p.analyses.reduce((n, a) => n + a.items.filter(isSelected).length, 0);
  const formGuide = bySkill("form-guide");
  const formFiles = fileLike(/i-?140|eta-?9089|g-?1145|i-?907/i);
  const cover = bySkill("cover-letter");
  const audit = bySkill("petition-audit");

  const claims = c.claims ?? [];
  const toggle = (id: string) =>
    patchCase((x) => {
      const cur = x.claims ?? [];
      return { ...x, claims: cur.includes(id) ? cur.filter((y) => y !== id) : [...cur, id] };
    });
  const boxes = (list: Claim[]) => (
    <div className="claims">
      {list.map((k) => (
        <label key={k.id} className="item">
          <input type="checkbox" checked={claims.includes(k.id)} onChange={() => toggle(k.id)} />
          <span>
            {k.label}
            <small>
              {k.hint ? `${k.hint}　` : ""}
              {k.en}
            </small>
          </span>
        </label>
      ))}
    </div>
  );
  const claimsBody =
    c.type === "EB-1A" ? (
      boxes(EB1A_CRITERIA)
    ) : (
      <>
        <div className="seg">
          {(
            [
              ["advanced", "高等学位", "硕士及以上，或学士加五年递进经验"],
              ["exceptional", "特殊能力", "六项标准里满足至少三项"],
            ] as const
          ).map(([id, label, note]) => (
            <button type="button" key={id} className={c.eb2 === id ? "on" : ""} onClick={() => patchCase((x) => ({ ...x, eb2: id }))}>
              {label}
              <small>{note}</small>
            </button>
          ))}
        </div>
        {c.eb2 === "exceptional" && boxes(EXCEPTIONAL_CRITERIA)}
      </>
    );
  const pickedCount =
    c.type === "EB-1A"
      ? claims.filter((id) => EB1A_CRITERIA.some((k) => k.id === id)).length
      : claims.filter((id) => EXCEPTIONAL_CRITERIA.some((k) => k.id === id)).length;

  const steps: Step[] = [
    {
      id: "profile",
      title: "填写个人档案",
      desc: "姓名、领域、学历、当前职位。之后每一步 AI 都会参考它，不用重复介绍自己。",
      done: Boolean(p.firstName && p.field && p.degrees.length),
      actions: [toProfile],
    },
    {
      id: "scholar",
      title: "获取学术记录",
      desc: "从 Google Scholar 或 Semantic Scholar 获取论文和引用数据。没有论文的可以跳过。",
      optional: true,
      done: p.records.length > 0,
      have: p.records.map((r) => r.source).join("、"),
      actions: [toProfile],
    },
    {
      id: "materials",
      title: "上传基础材料",
      desc: "简历、学位证、成绩单、护照和签证页、I-94、代表性论文、获奖或媒体报道等。后面的评估和文书都以这些材料为依据。",
      done: files.length > 0,
      have: files.length ? `已上传 ${files.length} 个文件` : "",
      actions: [upload],
    },
    {
      id: "assess",
      title: "案件评估",
      desc: "让 AI 逐项评估现有材料的强弱，告诉你缺什么、先补什么。建议在动笔写文书之前做。",
      done: assess.length > 0,
      actions: assess.length ? openDocs(assess) : [start("case-strength-assessor")],
    },
    {
      id: "claims",
      title: "选择申报条件",
      desc:
        c.type === "EB-1A"
          ? `从十项标准里选出你要主张的，至少 ${MIN_CLAIMS} 项。选证据最扎实的几项，不是越多越好；拿不准时先看上一步的评估结果。之后 AI 写申请信时只论证你选的这几项。`
          : `NIW 先要满足 EB-2 的基础资格，选一条路：有硕士及以上学位的选「高等学位」；没有的走「特殊能力」，并选出至少 ${MIN_CLAIMS} 项要主张的标准。`,
      done: claimsReady(c),
      have:
        c.type === "EB-1A" || c.eb2 === "exceptional"
          ? `已选 ${pickedCount} 项${pickedCount < MIN_CLAIMS ? `，还差 ${MIN_CLAIMS - pickedCount} 项` : ""}`
          : "",
      body: claimsBody,
      actions: [],
    },
    {
      id: "notable",
      title: "找出重要引用",
      desc: "分析别人是怎么引用你的论文的，挑出有分量的原句，再在这里生成「重要引用」文档，写申请信时引用它。",
      optional: true,
      done: notable.length > 0,
      have: picked && !notable.length ? `档案里已选出 ${picked} 条，还没有生成文档` : "",
      actions: notable.length
        ? openDocs(notable)
        : picked
          ? [{ label: "生成「重要引用」文档", run: () => onCreate("重要引用") }, toProfile]
          : [toProfile],
    },
    ...(c.type === "NIW"
      ? [
          {
            id: "endeavor",
            title: "写 Proposed Endeavor 陈述",
            desc: "说清楚你来美国之后具体要做什么、解决什么问题。NIW 三个要素都围绕它展开，先把它定下来。",
            done: endeavor.length > 0,
            actions: endeavor.length
              ? openDocs(endeavor)
              : [{ label: "新建 Proposed Endeavor 陈述", run: () => onCreate("Proposed Endeavor 陈述") }],
          } satisfies Step,
        ]
      : []),
    {
      id: "letters",
      title: "准备推荐信",
      desc: "通常 4–6 封，独立推荐人更有说服力。可以让 AI 规划并逐封起草，交给推荐人审阅签字；已经签好的信直接上传。",
      done: letters.length + letterFiles.length > 0,
      have: [letters.length && `起草了 ${letters.length} 封`, letterFiles.length && `上传了 ${letterFiles.length} 封`]
        .filter(Boolean)
        .join("，"),
      actions: [start("expert-letter-drafter"), { label: "上传签好的推荐信", run: () => goTab("files") }, ...openDocs(letters)],
    },
    {
      id: "pl",
      title: "写 Petition Letter",
      desc: "整个申请的核心论证。AI 会引用案件里的全部材料来写，缺证据的地方会标出来。",
      done: pl.length > 0,
      actions: pl.length ? openDocs(pl) : [start(c.type === "NIW" ? "niw-petition-narrative" : "eb1a-petition-narrative")],
    },
    {
      id: "papers",
      title: "下载论文 PDF",
      desc: "把你的代表作和重要引用的论文一键下载到案件里，作为 Exhibit。文书里用到的论文会自动勾上。",
      optional: true,
      done: files.some(isPaperFile),
      have: files.some(isPaperFile) ? `已下载 ${files.filter(isPaperFile).length} 篇` : "",
      actions: [{ label: "去下载论文", run: () => goTab("files") }],
    },
    {
      id: "forms",
      title: "填写表格",
      desc: "I-140 等表格需要你在 USCIS 官网下载最新版自己填写。AI 会根据你的档案给出逐栏的填写指引；填好并签名后，把表格上传到「文件」。",
      done: formFiles.length > 0,
      have: formFiles.length
        ? `已上传 ${names(formFiles)}`
        : formGuide.length
          ? "已有填写指引，还没有上传填好的表格"
          : "",
      actions: [...(formGuide.length ? openDocs(formGuide) : [start("form-guide")]), { label: "上传填好的表格", run: () => goTab("files") }],
    },
    {
      id: "audit",
      title: "提交前审计",
      desc: "让 AI 逐条核对 Petition Letter 里的事实有没有材料支撑、论证是否符合法律标准。按它列出的问题改完再往下走。",
      done: audit.length > 0,
      actions: audit.length ? openDocs(audit) : [start("petition-audit")],
    },
    {
      id: "cover",
      title: "写 Cover Letter 和 Exhibit 清单",
      desc: "放在材料包最前面的递交信和材料目录。等文书和证据都齐了再做。",
      done: cover.length > 0,
      actions: cover.length ? openDocs(cover) : [start("cover-letter")],
    },
    {
      id: "pack",
      title: "打包下载",
      desc: "把 Cover Letter、Petition Letter 和所有 Exhibit 按顺序合成一份带页眉、页码、目录和分隔页的 PDF，就是最终递交的版本。",
      done: false,
      actions: [{ label: "去打包下载", run: () => goTab("pack") }],
    },
  ];

  const mark = c.guide ?? {};
  const state = (s: Step): "done" | "skip" | "todo" => mark[s.id] ?? (s.done ? "done" : "todo");
  const setMark = (id: string, v: "done" | "skip" | null) =>
    patchCase((x) => {
      const guide = { ...(x.guide ?? {}) };
      if (v) guide[id] = v;
      else delete guide[id];
      return { ...x, guide };
    });
  const current = steps.find((s) => state(s) === "todo");
  const finished = steps.filter((s) => state(s) !== "todo").length;

  return (
    <div className="guide">
      <p className="group-note">
        按顺序做完下面每一步，最后就能得到一份可以直接递交的材料包。已经完成 {finished} / {steps.length} 步；
        每一步是否完成是根据案件里已有的内容自动判断的，也可以手动标记。
      </p>
      <ol>
        {steps.map((s, i) => {
          const st = state(s);
          return (
            <li key={s.id} className={`step ${st} ${s === current ? "current" : ""}`}>
              <span className="step-no">{st === "done" ? "✓" : st === "skip" ? "–" : i + 1}</span>
              <div>
                <strong>
                  {s.title}
                  {s.optional && <small>可选</small>}
                  {s === current && <span className="tag">下一步</span>}
                  {st === "skip" && <small>已跳过</small>}
                </strong>
                <p>{s.desc}</p>
                {s.have && <p className="step-have">{s.have}</p>}
                {s.body}
                <div className="step-actions">
                  {s.actions.map((a, k) => (
                    <button key={a.label} className={k === 0 && s === current ? "btn-accent" : "btn-ghost"} onClick={a.run}>
                      {a.label}
                    </button>
                  ))}
                  {st === "todo" ? (
                    <>
                      <button className="link" onClick={() => setMark(s.id, "done")}>
                        标为已完成
                      </button>
                      <button className="link" onClick={() => setMark(s.id, "skip")}>
                        跳过
                      </button>
                    </>
                  ) : (
                    mark[s.id] && (
                      <button className="link" onClick={() => setMark(s.id, null)}>
                        取消标记
                      </button>
                    )
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
