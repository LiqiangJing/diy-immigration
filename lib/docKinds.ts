/** 案件里可以新建的文档种类（文档列表和聊天助手共用） */
export const DOC_KINDS = [
  { kind: "Petition Letter", desc: "申请信，整个案件的核心论证" },
  { kind: "推荐信", desc: "Recommendation Letter 草稿" },
  { kind: "Proposed Endeavor 陈述", desc: "NIW 拟从事事业的说明；「我的档案」里填了拟从事事业的话，会用它自动生成" },
  { kind: "Summary of Contributions", desc: "用「我的档案」里的贡献总结自动生成，写申请信和推荐信时引用它" },
  { kind: "论文与引用记录", desc: "用「我的档案」里获取的学术数据自动生成" },
  { kind: "重要引用", desc: "用「我的档案」里的重要引用分析自动生成，写 Petition Letter 时引用它" },
  { kind: "其他文档", desc: "RFE 回复、个人陈述等" },
];

/** 用档案里的内容自动生成的文档：种类 → 生成后的标题 */
export const REPORT_TITLE: Record<string, string> = {
  论文与引用记录: "Publication and Citation Record",
  重要引用: "Notable Citations",
  "Summary of Contributions": "Summary of Contributions",
  "Proposed Endeavor 陈述": "Proposed Endeavor",
};
