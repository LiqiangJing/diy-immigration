"use client";

import { emptySoc } from "@/lib/profile";
import type { Profile as ProfileData, Soc as SocData, SocProject, SocReview } from "@/lib/profile";
import { uid } from "@/lib/types";

type Props = {
  profile: ProfileData;
  setProfile: React.Dispatch<React.SetStateAction<ProfileData>>;
};

function Area({
  label,
  hint,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      {hint && <small>{hint}</small>}
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

/** 「我的档案」里的贡献总结（Summary of Contributions）：NIW 和 EB-1A 共用的事实底稿 */
export default function Soc({ profile: p, setProfile }: Props) {
  const soc = p.soc ?? emptySoc();
  const set = (patch: Partial<SocData>) =>
    setProfile((prev) => ({ ...prev, soc: { ...(prev.soc ?? emptySoc()), ...patch }, updatedAt: Date.now() }));
  const setProject = (id: string, patch: Partial<SocProject>) =>
    set({ projects: soc.projects.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const setReview = (id: string, patch: Partial<SocReview>) =>
    set({ reviews: soc.reviews.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const totalReviews = soc.reviews.reduce((n, r) => n + (Number(r.count) || 0), 0);

  return (
    <>
      <section className="card">
        <h3>一、领域和重要性</h3>
        <small>
          贡献总结是申请信和推荐信的事实底稿，NIW 和 EB-1A 都用它。不用写得正式，列要点、写草稿都可以，中英文都行；AI
          写文书时会在此基础上展开。只写真实的、拿得出证据的内容。
        </small>
        <label>
          主要领域
          <input value={p.field} onChange={(e) => setProfile((prev) => ({ ...prev, field: e.target.value, updatedAt: Date.now() }))} placeholder="例如 Trustworthy Artificial Intelligence" />
        </label>
        <Area
          label="细分方向（最多三个）"
          hint="每行一个。如果你的方向属于美国「关键和新兴技术」（Critical and Emerging Technologies）清单里的类别，按清单上的说法写。"
          rows={3}
          value={soc.subareas}
          onChange={(subareas) => set({ subareas })}
        />
        <Area
          label="这项工作的重要性、益处和应用"
          hint="要解决什么问题、为什么重要、对美国有什么意义。引用的政府文件、报告或数据请附上链接。"
          rows={8}
          value={soc.importance}
          onChange={(importance) => set({ importance })}
        />
      </section>

      <section className="card">
        <h3>二、主要贡献</h3>
        <small>选 2–4 个最重要的研究或工作项目。申请信里「原创贡献」一节会按这里的项目逐个展开。</small>
        {soc.projects.map((x, i) => (
          <div className="soc-project" key={x.id}>
            <div className="soc-project-head">
              <strong>项目 {i + 1}</strong>
              <button className="link-danger" onClick={() => set({ projects: soc.projects.filter((y) => y.id !== x.id) })}>
                移除
              </button>
            </div>
            <label>
              项目名称
              <input value={x.title} onChange={(e) => setProject(x.id, { title: e.target.value })} />
            </label>
            <div className="grid2">
              <label>
                开始时间（月/年）
                <input value={x.start} onChange={(e) => setProject(x.id, { start: e.target.value })} placeholder="08/2023" />
              </label>
              <label>
                结束时间
                <input value={x.end} onChange={(e) => setProject(x.id, { end: e.target.value })} placeholder="02/2026 或 进行中" />
              </label>
            </div>
            <Area
              label="成果"
              hint="论文（标题、作者、发表在哪）、开源软件或数据集（链接、下载量）、专利、产品等，每行一项。"
              value={x.outputs}
              onChange={(outputs) => setProject(x.id, { outputs })}
            />
            <Area
              label="经费来源（如有）"
              hint="项目编号、资助机构，以及你和这笔经费的关系（比如 PI 是谁）。"
              rows={2}
              value={x.funding}
              onChange={(funding) => setProject(x.id, { funding })}
            />
            <Area
              label="工作概述"
              hint="用外行能看懂的话说：解决了什么问题、你做了什么、为什么是新的。说明你本人在其中的角色。"
              rows={6}
              value={x.summary}
              onChange={(summary) => setProject(x.id, { summary })}
            />
            <Area
              label="意义和影响"
              hint="别人怎么用了这项工作：被哪些论文采用或扩展、被哪些公司或机构使用、被政府报告引用等。每条写清楚是谁、在哪、怎么用的，附上链接。可以参考「学术记录与引用」里的重要引用分析。"
              rows={8}
              value={x.impact}
              onChange={(impact) => setProject(x.id, { impact })}
            />
          </div>
        ))}
        <button
          className="btn-ghost"
          onClick={() =>
            set({ projects: [...soc.projects, { id: uid(), title: "", start: "", end: "", outputs: "", funding: "", summary: "", impact: "" }] })
          }
        >
          + 添加项目
        </button>
      </section>

      <section className="card">
        <h3>三、其他成就</h3>
        <Area
          label="奖项"
          hint="国家级或国际级的奖项，每行一个：奖项名称、颁发机构、年份、获奖比例（如 5/604）。"
          value={soc.awards}
          onChange={(awards) => set({ awards })}
        />
        <div className="field">
          <span>
            审稿记录
            <small>
              逐个期刊或会议填写审稿次数。需要有证明（邀请邮件、感谢信或审稿证书）。
              {totalReviews > 0 && ` 目前合计 ${totalReviews} 次。`}
            </small>
          </span>
          {soc.reviews.map((r) => (
            <div className="soc-review" key={r.id}>
              <input value={r.venue} onChange={(e) => setReview(r.id, { venue: e.target.value })} placeholder="期刊或会议名称" />
              <input value={r.count} onChange={(e) => setReview(r.id, { count: e.target.value })} placeholder="次数" inputMode="numeric" />
              <select value={r.invited} onChange={(e) => setReview(r.id, { invited: e.target.value as SocReview["invited"] })}>
                <option value="">是否有正式邀请</option>
                <option value="yes">有正式邀请</option>
                <option value="no">没有</option>
                <option value="other">其他</option>
              </select>
              <button className="link-danger" onClick={() => set({ reviews: soc.reviews.filter((y) => y.id !== r.id) })}>
                移除
              </button>
            </div>
          ))}
          <button className="btn-ghost" onClick={() => set({ reviews: [...soc.reviews, { id: uid(), venue: "", count: "", invited: "" }] })}>
            + 添加期刊或会议
          </button>
        </div>
        <Area
          label="开源贡献"
          hint="每个项目写：名称和链接、你的角色、使用情况（star、fork、下载量、被谁采用）。"
          rows={5}
          value={soc.openSource}
          onChange={(openSource) => set({ openSource })}
        />
        <Area
          label="媒体报道"
          hint="报道过你或你的工作的媒体，每行一条：媒体名称、标题、日期、链接。报道原文请打印成 PDF 上传到案件的「文件」里。"
          value={soc.media}
          onChange={(media) => set({ media })}
        />
        <Area
          label="其他"
          hint="前面没有覆盖到的：领导或关键角色、需要杰出成就才能加入的协会会员资格、高薪酬、专利或产品、受邀报告等。"
          value={soc.other}
          onChange={(other) => set({ other })}
        />
      </section>
    </>
  );
}
