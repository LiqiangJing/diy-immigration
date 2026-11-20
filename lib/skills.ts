import type { CaseType } from "./types";

/** 案件里的 AI 工作流。每个工作流对应 skills/ 目录下的一个开源 skill。这个文件前后端共用，只放元信息。 */
export type Workflow = {
  id: string;
  title: string;
  desc: string;
  /** 只在某一类案件里出现；不写表示都出现 */
  only?: CaseType;
  /** 第一条消息的建议说法 */
  starter: string;
  /** 开始前给用户的提示 */
  hint: string;
};

export const WORKFLOWS: Workflow[] = [
  {
    id: "case-strength-assessor",
    title: "案件评估",
    desc: "逐项评估现有材料的强弱，指出缺口和下一步",
    starter: "请根据我的档案和引用的材料评估这个案件，逐项给出强弱判断、证据缺口和优先要补的材料。",
    hint: "已自动引用案件里的全部文件。材料越全，评估越准。",
  },
  {
    id: "niw-petition-narrative",
    title: "起草 Petition Letter",
    desc: "按 Dhanasar 三要素起草 NIW 申请信",
    only: "NIW",
    starter: "请先问我起草所需的关键信息（拟从事事业、要解决的美国问题等），信息够了再开始写。",
    hint: "已自动引用案件里的全部文件。信里的每个事实都需要有材料支撑，缺的地方会标为待补充。",
  },
  {
    id: "eb1a-petition-narrative",
    title: "起草 Petition Letter",
    desc: "按逐项标准加 Final Merits 起草 EB-1A 申请信",
    only: "EB-1A",
    starter: "请先告诉我你打算主张哪几项标准、各自还缺什么，我确认后再开始写。",
    hint: "已自动引用案件里的全部文件。信里的每个事实都需要有材料支撑，缺的地方会标为待补充。",
  },
  {
    id: "expert-letter-drafter",
    title: "起草推荐信",
    desc: "规划每位推荐人写什么，避免内容重复，再逐封起草",
    starter: "我想准备推荐信。请先问我有哪些可能的推荐人、他们和我的关系，再帮我规划每封信的重点。",
    hint: "一份文档写一封信。可以引用简历和已有的其他推荐信，避免重复。",
  },
  {
    id: "petition-audit",
    title: "提交前审计",
    desc: "逐条核对申请信里的事实和论证，按严重程度列出问题",
    starter: "请审计我引用的 Petition Letter：逐条核对事实是否有材料支撑、论证是否符合法律标准，按严重程度列出问题。",
    hint: "已自动引用案件里的全部文件。请再点「@ 引用案件资料」把要审计的 Petition Letter 文档加上。",
  },
  {
    id: "rfe-response-drafter",
    title: "RFE 回复",
    desc: "拆解补件通知，逐条对应证据并起草回复",
    starter: "我收到了 RFE。请先拆解里面提出的每一项不足，告诉我每项需要什么证据来回应。",
    hint: "请先把 RFE 通知上传到「文件」页，或直接在这里上传。",
  },
];

export const workflowsFor = (type: CaseType) => WORKFLOWS.filter((w) => !w.only || w.only === type);
export const workflowById = (id: string | undefined) => WORKFLOWS.find((w) => w.id === id);
