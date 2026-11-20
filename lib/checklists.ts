import type { CaseType } from "./types";

export type ChecklistItem = { id: string; label: string; hint?: string };
export type ChecklistGroup = { title: string; note?: string; items: ChecklistItem[] };

const COMMON: ChecklistGroup = {
  title: "通用材料",
  items: [
    { id: "cv", label: "简历 / CV" },
    { id: "petition-letter", label: "Petition Letter（申请信）", hint: "整个案件的核心论证文件" },
    { id: "rec-letters", label: "推荐信", hint: "通常 4–6 封，独立推荐人更有说服力" },
    { id: "i140", label: "I-140 表格", hint: "表格版本与费用以 USCIS 官网最新说明为准" },
    { id: "identity", label: "护照、签证、I-94 等身份文件" },
  ],
};

export const CHECKLISTS: Record<CaseType, ChecklistGroup[]> = {
  NIW: [
    {
      title: "EB-2 基础资格",
      items: [
        { id: "niw-degree", label: "高等学位或特殊能力证明", hint: "学位证、成绩单、学历认证等" },
      ],
    },
    {
      title: "Dhanasar 三要素",
      items: [
        { id: "niw-endeavor", label: "拟从事事业（Proposed Endeavor）陈述" },
        { id: "niw-p1", label: "要素一：事业具有实质价值和国家重要性", hint: "政府文件、行业报告、媒体报道等" },
        { id: "niw-p2", label: "要素二：申请人有能力推进该事业", hint: "论文、引用、专利、项目经费、工作成果等" },
        { id: "niw-p3", label: "要素三：豁免劳工证对美国有利的论证" },
      ],
    },
    COMMON,
  ],
  "EB-1A": [
    {
      title: "十项标准（至少满足三项）",
      note: "满足三项只是第一步，之后还有整体评估（Final Merits）。",
      items: [
        { id: "eb1-awards", label: "国家级或国际级奖项" },
        { id: "eb1-membership", label: "要求杰出成就的协会会员资格" },
        { id: "eb1-media", label: "关于申请人的专业或主流媒体报道" },
        { id: "eb1-judging", label: "评审他人工作", hint: "期刊 / 会议审稿、评委等" },
        { id: "eb1-contrib", label: "具有重大意义的原创性贡献" },
        { id: "eb1-articles", label: "学术文章发表" },
        { id: "eb1-exhibit", label: "作品在艺术展览或展示中展出" },
        { id: "eb1-leading", label: "在知名机构担任领导或关键角色" },
        { id: "eb1-salary", label: "相对同行的高薪酬" },
        { id: "eb1-commercial", label: "表演艺术领域的商业成功" },
      ],
    },
    {
      title: "整体论证",
      items: [
        { id: "eb1-final", label: "Final Merits：持续的国家或国际声誉论证" },
        { id: "eb1-plan", label: "赴美后继续在本领域工作的计划与证明" },
      ],
    },
    COMMON,
  ],
};

export const totalItems = (type: CaseType) =>
  CHECKLISTS[type].reduce((n, g) => n + g.items.length, 0);
