"use client";

import { emptyEndeavor, emptySoc } from "@/lib/profile";
import type { Endeavor as EndeavorData, Profile as ProfileData } from "@/lib/profile";
import { ENDEAVOR_GUIDE, ENDEAVOR_INTRO, ENDEAVOR_SOURCE } from "@/lib/endeavorGuide";
import { SOC_GENERAL } from "@/lib/socGuide";
import { Area } from "@/components/GuideBox";
import type { Only } from "@/components/GuideBox";

type Props = {
  profile: ProfileData;
  setProfile: React.Dispatch<React.SetStateAction<ProfileData>>;
  only?: Only;
};

/** 「我的档案」里的拟从事事业（Proposed Endeavor）：NIW 的核心，一项一项引导着填 */
export default function Endeavor({ profile: p, setProfile, only = null }: Props) {
  const e = p.endeavor ?? emptyEndeavor();
  const set = (patch: Partial<EndeavorData>) =>
    setProfile((prev) => ({ ...prev, endeavor: { ...(prev.endeavor ?? emptyEndeavor()), ...patch }, updatedAt: Date.now() }));
  const setImportance = (importance: string) =>
    setProfile((prev) => ({ ...prev, soc: { ...(prev.soc ?? emptySoc()), importance }, updatedAt: Date.now() }));

  return (
    <>
      <section className="card">
        <h3>拟从事事业（Proposed Endeavor）</h3>
        <small>
          只有申请 NIW 才需要填这一栏。{ENDEAVOR_INTRO.what}
        </small>
        {only === "EB-1A" && (
          <small className="for-type">
            你目前只有 EB-1A 案件，这一栏可以不填。EB-1A 不要求拟从事事业，申请信里只需要一小段说明你到美国后会继续在本领域工作。
          </small>
        )}
        <details className="tips">
          <summary>填之前先看：这一栏怎么用</summary>
          <p>{ENDEAVOR_INTRO.split}</p>
          <p>{ENDEAVOR_INTRO.how}</p>
          <p>{ENDEAVOR_INTRO.fixed}</p>
          <p>{SOC_GENERAL.truth}</p>
          <p>
            每一项的说明按移民局的政策手册整理（
            <a href={ENDEAVOR_SOURCE.url} target="_blank" rel="noreferrer">
              {ENDEAVOR_SOURCE.title}
            </a>
            ，{ENDEAVOR_SOURCE.checked}核对）。政策会调整，递交前请以官网为准。
          </p>
        </details>
        <Area
          guide={ENDEAVOR_GUIDE.statement}
          label="一、用一两句话说明你打算做什么"
          hint="用英文写。说的是你具体要做的事，不是职位，也不是领域。这句话会原样出现在申请信、推荐信和各份文书里，定下来之后不要再换说法。"
          rows={4}
          value={e.statement}
          onChange={(statement) => set({ statement })}
          placeholder="My proposed endeavor is to … in order to …"
        />
        <Area
          guide={ENDEAVOR_GUIDE.importance}
          label="二、这项事业为什么重要"
          hint="要解决什么问题、谁会受益、对美国有什么意义。对应 NIW 的第一项要求（实质价值和国家重要性）。这一项和「贡献总结」里的「重要性、益处和应用」是同一个框，在哪边填都一样。"
          rows={8}
          value={p.soc?.importance ?? ""}
          onChange={setImportance}
        />
      </section>

      <section className="card">
        <h3>你打算怎么做</h3>
        <small>这三项对应 NIW 的第二项要求：你有能力推进这项事业。过去的成果写在「贡献总结」里，这里写计划、落脚点和已有的进展。</small>
        <Area
          guide={ENDEAVOR_GUIDE.plan}
          label="三、未来三到五年的具体计划"
          hint="两到三个接下来要做的项目或阶段。每个写清：做什么、怎么做、给谁用、预期产出、大致时间，以及靠什么来做（经费、合作方、设备、数据）。"
          rows={9}
          value={e.plan}
          onChange={(plan) => set({ plan })}
        />
        <Area
          guide={ENDEAVOR_GUIDE.role}
          label="四、打算在哪里、以什么身份做"
          hint="继续现在的职位、去某类机构任职、创业，还是独立研究。NIW 不要求有雇主或工作邀请，但要说清你的落脚点，并说明这项事业不依赖某一家单位。"
          rows={4}
          value={e.role}
          onChange={(role) => set({ role })}
        />
        <Area
          guide={ENDEAVOR_GUIDE.progress}
          label="五、已有的进展和外部支持"
          hint="和这项事业直接相关的进展，每行一条：已经做成了什么，谁在用、谁在支持（用户、合作方、经费、投资、政府机构）。成果的细节写在「贡献总结」里，这里不用重复。"
          rows={6}
          value={e.progress}
          onChange={(progress) => set({ progress })}
        />
      </section>

      <section className="card">
        <h3>为什么应该豁免</h3>
        <Area
          guide={ENDEAVOR_GUIDE.waiver}
          label="六、为什么免掉工作邀请和劳工证对美国有利"
          hint="对应 NIW 的第三项要求。两三段就够：为什么劳工证程序不适合你这件事，以及即使有其他合格的美国劳动者，美国仍然能从你的工作中受益。拿不准可以先空着，让 AI 在写申请信时根据前面几项来写。"
          rows={6}
          value={e.waiver}
          onChange={(waiver) => set({ waiver })}
        />
        <small>
          填好后到 NIW 案件的「申请向导」里点「生成 Proposed Endeavor 陈述文档」。也可以在聊天里说「帮我梳理拟从事事业」，让 AI 一边问一边帮你填。
        </small>
      </section>
    </>
  );
}
