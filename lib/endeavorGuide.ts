/**
 * 「拟从事事业」每一项的详细填写说明（页面上点「查看填写说明和示例」展开）。
 * 法律要点按 USCIS Policy Manual 第 6 卷 F 部分第 5 章（NIW 一节）和 Matter of Dhanasar 整理，2026 年 11 月对照官网核对过；
 * 政策有更新时要同步改这里。示例里的人物、单位、项目和数字都是虚构的，只用来示范写法。
 */

import type { Guide } from "./socGuide";

export const ENDEAVOR_SOURCE = {
  title: "USCIS Policy Manual, Volume 6, Part F, Chapter 5",
  url: "https://www.uscis.gov/policy-manual/volume-6-part-f-chapter-5",
  checked: "2026 年 11 月",
};

/** 放在这一栏最上面的总说明 */
export const ENDEAVOR_INTRO = {
  what: "拟从事事业（Proposed Endeavor）是你到美国之后具体要做的那件事。NIW 审三项要求：这项事业有实质价值和国家重要性；你有能力推进它；综合来看，免掉工作邀请和劳工证对美国有利。三项都围绕这项事业展开，所以它是整个 NIW 申请的起点。",
  split: "和「贡献总结」的分工：这一栏写将来，打算做什么、怎么做；贡献总结写过去，已经做成了什么，用来证明你做得成这件事。",
  how: "这里写要点和草稿就行，中英文都可以，不用写成正式文书。填好后到 NIW 案件的「申请向导」里生成「Proposed Endeavor 陈述」文档，AI 写申请信和推荐信时以它为准。",
  fixed: "递交之前想清楚再定。递交之后如果改动事业的内容，可能被认为是实质性变更而影响申请。",
};

export const ENDEAVOR_GUIDE: Record<string, Guide> = {
  statement: {
    points: [
      "事业不是职位，也不是领域，而是你具体要做的事。移民局的区分是：职业（occupation）是大类，比如工程师；事业（endeavor）是你在这个职业里要做的具体工作，比如研发航空航天推进系统。只写「继续做工程师」「继续做研究」不算说清了事业。",
      "一个好用的句式：My proposed endeavor is to［用什么方法］［做什么］in order to［对美国有什么用］。",
      "宽窄的标准：要具体到能拿出证据来支撑；又不能绑死在某一家雇主或某一个项目上，换了工作这句话仍然成立。",
      "要和你已有的成果接得上。审查官会拿你过去的工作来判断你做不做得成这件事，凭空的新方向很难说通。",
      "要落在你的学位或专长范围内。按高等学位申报的，事业所属的职业本身要是需要本科以上学历的专业性职业（工科博士去开面包店不行）；按特殊能力申报的，你的特殊能力要和这项事业直接相关。",
      "定下来之后，申请信、推荐信和各份文书里都用同一个写法，不要每份文书各写各的。",
    ],
    example:
      "合适：My proposed endeavor is to develop and deploy data-driven methods that predict the lifetime and degradation of lithium-ion batteries from early test data, in order to shorten the development and qualification of longer-lasting, safer batteries for electric vehicles and grid storage in the United States.\n\n太宽：To advance battery research.（看不出具体做什么）\n是职业不是事业：To work as a battery engineer in the United States.\n太窄：To continue the cell-testing project I am assigned to at Example Labs.（绑死在一个雇主和一个项目上）",
    evidence: "这句话本身不需要证据，但后面每一项都要能支撑它。",
    avoid: ["把职位、雇主或公司业务写成事业", "只写「继续在本领域做研究」这类看不出内容的话", "不同文书里写法不一样", "选了一个和过去成果接不上的新方向"],
  },

  importance: {
    points: [
      "这一项对应第一项要求（实质价值和国家重要性），它和「贡献总结」里的「重要性、益处和应用」是同一个框，填一处就行。",
      "实质价值：事业在科学、技术、商业、医疗、教育、文化等方面有价值就可以，不要求能马上算出经济效益，基础研究也可以。",
      "国家重要性看的是这项事业将来可能产生的影响，不是你有多优秀，也不只看地域范围。移民局认可的情形包括：对一个领域有全国性甚至全球性的影响；有明显的潜力带动美国就业；对经济困难的地区有重大的正面经济影响。",
      "下面这些单独拿出来是不够的：只让一家雇主或它的客户受益（除非有更大范围的影响，比如被广泛采用或许可）；只是课堂教学而没有更大范围的影响；笼统地说这个职业或行业很重要、全国缺这类人；笼统地说创业能创造就业。",
      "所以要写清楚：这项事业的成果怎么走出你所在的单位，影响到一个行业、一类人群或一项国家目标。",
      "STEM 方向：对应美国「关键和新兴技术」清单，或者对美国竞争力、国家安全重要的方向，是有利因素。清单在「贡献总结」的细分方向下面可以对照。",
    ],
    evidence: "引用的政府文件、战略、法案、行业报告和统计数据，都保存一份带网址和日期的 PDF，最后作为 Exhibit 提交。",
    avoid: ["通篇讲行业有多重要，没有讲你这项具体的事业会带来什么", "只说对现在的雇主有用", "只说全国缺这类人才"],
  },

  plan: {
    points: [
      "写两到三个你接下来要做的具体项目或阶段，每个写清：要做什么、怎么做、给谁用、预期产出、大致时间。",
      "计划要看得出是你自己制定或主要参与制定的，并且以你现有的成果为起点，是顺着做下去的事。",
      "写清楚靠什么来做：经费、团队、合作方、设备、数据、算力。只有想法、没有任何条件的计划，容易被看成个人愿望。",
      "尽量有可以衡量的目标，比如发表、开源发布、试点、专利、用户数，但不要写做不到的数字。",
      "说明成果怎么让更多人用上：公开发表、开源、技术许可、行业合作、进入标准等。这一点直接关系到「国家重要性」。",
      "不需要证明一定成功。移民局不要求证明事业很可能成功，但没有依据的说法不会被采信。",
    ],
    example:
      "Project 1 (2027–2028): Extend my early-cycle prediction model from laboratory cells to commercial-format cells. Two battery manufacturers have agreed to share cycling data for this work (letters of intent available). I will release the resulting models and a public benchmark as open-source software. Expected outputs: two journal papers and one benchmark dataset.\n\nProject 2 (2028–2030): Build a qualification tool that battery developers can use to estimate cell lifetime within one week of testing instead of several months, and pilot it with one U.S. manufacturer.\n\nResources: my position at Example Labs provides battery testing equipment and computing. The work is supported in part by a U.S. Department of Energy grant (No. DE-XX-0000000, PI: Dr. A. Smith) through 2029.",
    evidence: "研究计划或商业计划、合作方或用户的意向信、经费批准文件、已经开始的工作的记录（代码仓库、预印本、阶段成果）。",
    avoid: ["只有一句「继续做研究、发论文」", "计划和过去的成果接不上", "计划的成果只对现在的雇主有用", "写了经费、合作，但拿不出任何文件"],
  },

  role: {
    points: [
      "NIW 不要求有雇主或工作邀请，可以自己申请。但你需要说明打算以什么身份来做这件事：继续现在的职位、去某类机构任职、创业，还是独立研究或咨询。",
      "已经有职位的：写职位、单位，以及这份工作和事业的关系。同时说明事业不依赖这一家单位，换了雇主你仍然会做同一件事。",
      "还在找工作的：写你在联系哪一类机构、进展到哪一步。和潜在雇主的往来邮件可以用来说明你打算以什么身份做、计划是否可行。",
      "创业的：写公司是否已在美国注册、你的持股和职务、目前的阶段和资金来源。只有持股本身不够，还要有对外的进展。",
      "人不在美国的：写打算什么时候、通过什么方式到美国开始工作。",
    ],
    example:
      "I work as a Research Scientist at Example Labs in California, where battery lifetime prediction is my main responsibility, and I plan to continue in this role. The endeavor does not depend on this employer: the methods and software are published openly, and I would pursue the same work at any U.S. research institution or battery company.",
    evidence: "聘书或在职证明、和潜在雇主或合作方的往来邮件；创业的准备公司注册文件、股权和职务证明。",
    avoid: ["把事业写成等同于现在这份工作", "没有任何落脚点，只说到了美国再找"],
  },

  progress: {
    points: [
      "写已经为这项事业做成了什么，以及有谁在关注或支持。这是第二项要求（你有能力推进这项事业）里很看重的部分。",
      "移民局列出的有分量的材料包括：别人正在使用你的工作；合同、协议或技术许可；潜在客户、用户或投资人的往来信件；来自美国投资人的投资（金额要和事业的规模相称）；政府的资助、奖项或提供的资源；美国政府机构或准政府机构（如联邦资助的研发中心）出具的支持信。",
      "这里只列和事业直接相关的进展，每条一两句话。成果的细节写在「贡献总结」的项目里，不用在这里重复。",
      "政府机构的支持信不是必须的，但有的话很有分量。",
      "还在谈、没有任何书面材料的合作，照实写成「正在洽谈」，不要写成已经有的支持。",
    ],
    example:
      "- The prediction model behind this endeavor is published (Nature Energy, 2024) and released as open-source software (BattLife), with about 12,000 downloads as of March 2026.\n- Example Motors uses BattLife in its battery testing pipeline (2025 technical report).\n- Two battery manufacturers have signed letters of intent to share data for the next phase (2026).\n- The work is funded in part by the U.S. Department of Energy (grant No. DE-XX-0000000).",
    evidence: "每一条都要有文件：使用方的公开说明或信函、合同或意向书、经费批准文件、投资协议、支持信。",
    avoid: ["把论文列表再贴一遍", "把口头意向写成已有的合作", "数字没有出处和日期"],
  },

  waiver: {
    points: [
      "第三项要求是一个权衡。劳工证程序的目的是保护美国劳动者的工作机会、工资和工作条件；你要说明，就你这件事而言，免掉这道程序对美国更有利。",
      "可以从下面几个角度写，挑一两个最贴合你情况的：",
      "劳工证不适合你的情况：这项事业不是一个固定岗位，会跨雇主、跨项目；或者你是创业者、自雇，没有雇主可以替你办。",
      "即使有其他合格的美国劳动者，美国仍然能从你的贡献中受益：你的成果是公开的，会被整个行业使用，是增加而不是替代。",
      "时间上的紧迫：这项工作对应的需要有时效，比如公共卫生、安全方面的需要，走完劳工证程序会耽误。",
      "你的专长超出了岗位的最低要求：劳工证按最低要求招人，体现不出你特有的能力。",
      "有依据的话，还可以写经济影响和带动就业。",
      "STEM 方向的申请人：有和事业相关的高等学位（尤其是博士）、做的是关键和新兴技术或对美国竞争力重要的方向、又有能力推进这项事业，这三点同时具备时，移民局把它看作这一项下很有利的因素。",
      "这一段通常最短，两三段就够。不引入新的事实，把前面写过的重要性和你的条件归拢起来。",
    ],
    example:
      "A labor certification is tied to one employer and one job description, while my endeavor spans institutions: the models and software I develop are released openly and used by battery developers across the industry. The United States would benefit from this work even if other qualified workers are available, because the tools I build add capacity for every developer who uses them instead of filling a single position. I hold a Ph.D. in a field directly related to the endeavor, and the work supports faster battery development and a domestic supply chain, which federal strategy documents name as national goals.",
    avoid: ["只说这个行业缺人（移民局明确说过，劳动力短缺本身不满足这一项）", "说「没有美国人能做这份工作」这类无法证明的话", "把前两项的内容原样重复一遍"],
  },
};
