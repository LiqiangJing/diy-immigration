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
          <small>
            选一个能概括你大部分现有和计划中工作的领域。不要太宽（「工程」「医学」），也不要太窄（只对应某一篇论文的题目）；
            一般和你的最高学位相近。NIW 申请要和 Proposed Endeavor 对得上；如果在转方向，选一个能同时接住过去成果和未来计划的说法。
            所有文书里这个领域的写法要保持一致。
          </small>
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
          hint="可以按三层写：要解决什么问题、现在缺什么；谁会受益、会带来什么实际变化；对本领域、对全球、对美国各有什么意义（对应哪些美国政府的优先事项）。重点写你在美国正在做和将要做的工作，用外行能看懂的话。引用的政府文件、报告或数据请附上链接。NIW 的第一项要求（实质价值和国家重要性）主要靠这一段。"
          rows={8}
          value={soc.importance}
          onChange={(importance) => set({ importance })}
        />
      </section>

      <section className="card">
        <h3>二、主要贡献</h3>
        <small>
          选 2–3 个你最拿得出手、证据最充分的项目，优先选被引最多的论文所在的项目；一作、发在好的期刊或会议、有经费支持、被业界采用的也可以。
          申请信里「原创贡献」一节会按这里的项目逐个展开。NIW 申请的项目要和 Proposed Endeavor 相关；不直接相关的，说明它给了你哪些做后续工作需要的能力。
          这一步不用上传证据，文书定稿后再按引用到的内容准备。
        </small>
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
              hint="最多三项最有分量的，每行一项，写得越具体越好：论文写标题、作者、发表的期刊或会议和年份；专利写名称、专利号和年份；开源软件或数据集写链接和下载量。"
              value={x.outputs}
              onChange={(outputs) => setProject(x.id, { outputs })}
            />
            <Area
              label="经费来源（如有）"
              hint="只写有竞争性的外部经费，不写学校或公司内部经费。写资助机构、项目编号和 PI 是谁。之后需要证据把你和这笔经费联系起来，比如你论文致谢里写明了这笔经费。"
              rows={2}
              value={x.funding}
              onChange={(funding) => setProject(x.id, { funding })}
            />
            <Area
              label="工作概述"
              hint="200 词左右，用外行能看懂的话，按「要解决什么问题 → 你怎么做的 → 结果是什么」写。合作项目先说整体，再用第一人称写清你本人做了什么（I designed… / I led…）。"
              rows={6}
              value={x.summary}
              onChange={(summary) => setProject(x.id, { summary })}
            />
            <Area
              label="意义和影响"
              hint="最多三条，每条 75–100 词：是谁、发表在哪、具体怎么用了你的工作，附上链接。最有分量的是独立引用（和你没有共同作者的论文）；其次是被综述引用、被公司或产品采用、被政府报告或白皮书引用、被专利引用、进入课程等。可以直接从「学术记录与引用」里的重要引用分析里挑。实在凑不够三条，就写这项工作对领域、对全球或对美国的意义。"
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
