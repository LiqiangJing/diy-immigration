/**
 * 贡献总结每一项的详细填写说明（页面上点「查看填写说明和示例」展开）。
 * 示例里的人物、论文、项目和数字都是虚构的，只用来示范写法。
 */

export type Guide = {
  points: string[]; // 怎么写
  example?: string; // 示例（虚构）
  niw?: string; // NIW 申请要注意的
  eb1a?: string; // EB-1A 申请要注意的
  evidence?: string; // 之后要准备的证据
  avoid?: string[]; // 常见问题
};

export const SOC_GUIDE: Record<string, Guide> = {
  field: {
    points: [
      "这是整套材料的「一句话定位」：申请信、推荐信、表格里都会用同一个说法来描述你是做什么的。",
      "选一个能盖住你大部分已有成果、也能盖住你接下来要做的工作的领域名。通常和最高学位的专业相近，但不必完全一样。",
      "宽窄的判断办法：这个说法能不能在学术会议的分会场名称、期刊的栏目名称或基金的项目类别里找到。找得到，宽窄大致合适。",
      "换过方向的人：不要写成两个领域拼在一起，找一个上位概念把两段经历连起来，再在「细分方向」里分开写。",
    ],
    example: "合适：Trustworthy Artificial Intelligence；Computational Materials Science；Cancer Immunology\n太宽：Computer Science；Engineering；Medicine\n太窄：Hallucination Evaluation for Vision-Language Models（这是一篇论文的题目，不是领域）",
    niw: "要和 Proposed Endeavor 里写的拟从事事业对得上。审查官会看你过去的成果是否足以说明你有能力推进这项事业，领域对不上就很难说通。",
    eb1a: "EB-1A 要证明你在「本领域」里处于顶尖的少数人之列。领域写得越宽，要比的人越多，越难证明；写得太窄又显得影响有限。选一个你的成果在里面确实排得上号的范围。",
    avoid: ["不同文书里写了不同的领域名", "直接抄学位证上的专业名，但实际工作早已不在那个方向", "把公司的部门名或职位名当成领域"],
  },

  subareas: {
    points: [
      "写你在主要领域之下具体做哪一到三块。它们的作用是说明「你和同领域其他人的区别在哪」。",
      "每一个细分方向都应该能对应到你至少一项已有成果。写了却拿不出成果的方向，会被追问。",
      "顺序按分量排：成果最多、证据最硬的放第一个。",
      "能对上美国「关键和新兴技术」清单的，优先用清单上的原文，写法见下面的清单。对不上就照实写自己的方向。",
    ],
    example: "CET category: Adversarial robustness and AI security\nCET category: Foundation models, including large language, multimodal, and world systems\nEvaluation of autonomous AI agents",
    niw: "NIW 的第一项要求是事业具有国家重要性。细分方向对得上政府认定的重点技术，是最直接的论据之一，但它只说明方向重要，不能替代你本人的成果。",
    eb1a: "EB-1A 不要求国家重要性，这一项主要用来界定你的专长范围，让推荐人和申请信的说法一致。",
    avoid: ["把三个格子都填成几乎一样的意思", "为了凑清单硬套一个和自己成果对不上的类别", "中英文混着写"],
  },

  importance: {
    points: [
      "写的是「这项工作为什么值得做」，不是「我做了什么」。成果放到下面的项目里写。",
      "推荐分四小段，每段三五句：",
      "第一段，问题：这个领域现在卡在哪里，不解决会有什么后果。尽量给一个有出处的数字。",
      "第二段，你的工作怎么针对这个问题：一两句话概括方向，点到最有分量的一两项成果即可。",
      "第三段，对美国的意义：对应哪些美国政府文件、战略或法案里明确列出的重点（行政命令、联邦机构的战略规划、国会立法、关键和新兴技术清单等），并给出链接。",
      "第四段，更大范围的意义：对整个领域、对其他国家或行业的好处。",
      "用外行能看懂的话。审查官不是你这个专业的人，术语第一次出现时用半句话解释。",
      "引用的每一份政府文件、报告、统计数据都附上链接，之后要作为证据提交。",
    ],
    example:
      "The problem. Lithium-ion batteries lose 20–30% of their capacity within the first few years of use, and replacing them accounts for roughly a third of the lifetime cost of an electric vehicle (U.S. Department of Energy, 2024, [link]). Predicting when and why a battery degrades is still largely done by slow and costly physical testing.\n\nMy work. I develop machine-learning models that predict battery degradation from the first 100 charging cycles, cutting the testing time needed to qualify a new battery design from months to days.\n\nImportance to the United States. The National Blueprint for Lithium Batteries (Federal Consortium for Advanced Batteries, [link]) names faster battery development and a domestic supply chain as national goals. Advanced manufacturing and materials is also on the White House list of Critical and Emerging Technologies ([link]).\n\nBroader relevance. The same methods apply to grid storage, and the datasets and code I release are used by research groups in several countries.",
    niw: "这一段是 NIW 第一项要求（实质价值和国家重要性）的主要依据，值得花最多时间。注意「国家重要性」看的是事业本身的影响范围，不是你个人有多优秀；只说对某一家公司或某一个实验室有用是不够的，要说明影响能扩展到一个行业、一类人群或一项国家目标。",
    eb1a: "EB-1A 没有国家重要性这项要求，但这一段仍然有用：它为「原创贡献具有重大意义」提供背景，也用于最后的整体评估，以及说明你来美国会继续在本领域工作并使美国受益。",
    evidence: "这里提到的每份政府文件、行业报告、新闻报道，都保存一份 PDF（带网址和日期），最后作为 Exhibit 提交。",
    avoid: [
      "通篇讲自己的论文，没有讲问题本身为什么重要",
      "只有「对人类很重要」这类空话，没有具体数字和出处",
      "引用的政府文件和自己的工作只是领域沾边，没有说清具体对应哪一条",
      "引用已经被撤销或过期的政策文件而没有核对",
    ],
  },

  project: {
    points: [
      "这里的「项目」是一条研究主线，不是一篇论文。把围绕同一个问题的几篇论文、软件、数据集归到一个项目里。",
      "选 2–3 个。挑选的优先顺序：被别人实际用起来的（独立引用多、被公司或机构采用）＞ 发表在顶级期刊或会议的 ＞ 你是第一作者或主要负责人的 ＞ 有外部经费支持的。",
      "每个项目都要能回答三个问题：解决了什么问题、你本人做了什么、别人因此做了什么。第三个问题答不上来的项目，分量就弱。",
      "项目之间最好有递进关系，合起来能讲成一个故事，而不是互不相干的三件事。",
      "时间写「月/年」。还在做的写「进行中」。",
    ],
    niw: "项目要和 Proposed Endeavor 有关联，用来证明第二项要求（你有能力推进这项事业）。早期不直接相关的项目也可以写，但要说明它让你具备了哪些后续工作需要的能力。",
    eb1a: "每个项目对应申请信里「原创贡献具有重大意义」的一个小节。EB-1A 对「重大意义」的要求比 NIW 高得多，光有发表和引用不够，需要有别人依赖、采用、沿用你的工作的具体证据，所以优先选有这类证据的项目。",
    avoid: ["一篇论文拆成一个项目，写了五六个", "选了自己最喜欢但几乎没人引用的工作", "合作项目里说不清哪部分是自己做的"],
  },

  outputs: {
    points: [
      "每个项目最多三项，每行一项，挑最有分量的。",
      "论文：标题、全部作者（按原顺序，共同一作要注明）、期刊或会议全称、年份。",
      "专利：名称、专利号、授权年份和授权国家；还在申请中的要写明「申请中」。",
      "软件、数据集：名称、公开链接、可核实的使用数字（下载量、star、fork），并注明数字是哪天看到的。",
      "预印本可以写，但要标明是预印本；已正式发表的写正式发表的版本。",
    ],
    example:
      "Journal paper: \"Early-cycle prediction of lithium-ion battery lifetime with graph neural networks.\" Jane Doe, A. Smith, B. Lee. Nature Energy, 2024.\nOpen-source software: BattLife (github.com/example/battlife), released on PyPI; about 12,000 downloads and 640 GitHub stars as of March 2026.\nU.S. Patent No. 12,345,678, \"Method for estimating battery degradation,\" granted 2025.",
    evidence: "论文首页、专利授权页、软件主页和下载统计页的截图或 PDF。数字写了就要有截图能对上。",
    avoid: ["作者顺序和原文不一致", "把投稿中、未录用的论文当成已发表", "下载量、star 数没有来源或和实际页面对不上"],
  },

  funding: {
    points: [
      "只写经过竞争性评审拿到的外部经费，例如 NSF、NIH、DOE、DARPA、国家自然科学基金、企业的公开研究资助计划。",
      "学校或公司内部的启动经费、奖学金、助研工资不写在这里。",
      "写明：资助机构、项目编号、项目名称、PI 是谁、你在其中的角色。",
      "你不是 PI 也可以写，如实写 PI 的名字即可。它的作用是说明这项工作经过了独立专家的评审并被认为值得资助。",
      "没有就留空，不影响申请。",
    ],
    example: "National Science Foundation CAREER Award, No. 1234567, \"Data-driven design of long-life batteries\" (PI: Dr. A. Smith). I carried out the work described in Aim 2 as a graduate research assistant.",
    evidence: "需要有文件把你和这笔经费联系起来：最常见的是你的论文致谢里写明了这个项目编号；也可以是经费的公开摘要页加上 PI 出具的说明。",
    avoid: ["把导师名下所有经费都列上，但自己的论文并没有致谢这些经费", "编号写错或写不全"],
  },

  summary: {
    points: [
      "200 词左右，一到两段，写给不懂你专业的人看。",
      "按三步写：要解决什么问题、为什么难 → 你想了什么办法、做了什么 → 得到了什么结果。",
      "用一个生活中的类比来解释核心想法，往往比术语有效。",
      "合作项目必须写清你本人的部分，用第一人称和具体动词：I designed…、I developed…、I led…、I proposed…。不要写 we。",
      "结果尽量量化：准确率提高多少、成本降低多少、速度快了多少倍，并说明是和什么比。",
      "只写做了什么和做成了什么，别人怎么用它放到下一项「意义和影响」里。",
    ],
    example:
      "Battery makers currently need months of repeated charging and discharging to learn how long a new battery design will last, which slows down every improvement. I asked whether the first few days of data already contain enough information to predict the rest. I designed a model that treats each battery as a network of interacting signals, in the way a doctor reads several vital signs together instead of one at a time, and I built the data pipeline that cleans and aligns measurements from different test equipment. Using only the first 100 charging cycles, my model predicts total battery lifetime with an average error of 7%, compared with 15% for the best previous method, and reduces the testing time needed from about four months to under one week. I was the lead author and wrote all of the modeling code; my co-authors provided the laboratory measurements.",
    niw: "强调这项工作让你具备了继续推进拟从事事业的能力和经验。",
    eb1a: "强调原创性：在你之前别人做不到什么，你的方法第一次做到了什么。",
    avoid: ["直接贴论文摘要，全是术语", "通篇 we，看不出谁做了什么", "只有「显著提升」这类形容词，没有数字", "把合作者的贡献写成自己的"],
  },

  impact: {
    points: [
      "这是全篇最重要的一项。它回答的问题是：除了你自己，还有谁认为这项工作重要，证据是什么。",
      "最多三条，每条 75–100 词，写法是：谁（作者、机构）→ 在哪（期刊、会议、产品、报告，附链接）→ 具体怎么用了你的工作 → 这说明了什么。",
      "分量从高到低大致是：",
      "被公司、政府机构或标准采用，用在实际产品或决策里；",
      "被独立的研究者当作方法、数据集或基准直接使用，或在其基础上继续发展（独立指和你没有共同发表过论文、不在同一个课题组）；",
      "被政府报告、白皮书、行业标准、专利引用；",
      "被综述文章重点介绍，或被写进教材、课程；",
      "被权威媒体报道。",
      "引用别人的原话比自己评价自己有力得多。引号里的内容必须和原文逐字一致。可以直接从「学术记录与引用」的重要引用分析里挑。",
      "单纯的引用次数放在申请信的总体介绍里就够了，这里要写的是具体的、能点名的使用案例。",
      "实在凑不够三条，就如实写这项工作对领域或对美国的潜在意义，不要拿自引或合作者的引用来充数。",
    ],
    example:
      "#1 Independent adoption in peer-reviewed research. R. Garcia, T. Nguyen, and K. Patel, \"Fast qualification of solid-state cells,\" Joule, 2025 [link]. This group, with whom I have never collaborated, used my model as the main prediction method in their study, stating: \"We adopt the early-cycle predictor of Doe et al. to estimate cell lifetime.\" Their use shows that independent researchers rely on my method as a working tool, not merely as background.\n\n#2 Use by industry. Example Motors' 2025 technical report on battery qualification [link] lists BattLife among the tools used in its testing pipeline. This is unsolicited commercial adoption of my software.\n\n#3 Citation in a government report. The U.S. Department of Energy's 2025 Energy Storage report [link] cites my paper in its section on accelerated testing methods.",
    niw: "用来证明第二项要求里的「已有成果和影响」。NIW 的标准相对宽，有几条扎实的独立使用案例通常就够。",
    eb1a: "「原创贡献具有重大意义」是 EB-1A 里最常被质疑的一项。审查官的常见说法是：有引用只能说明工作被发表、被注意到，不能说明具有重大意义。所以要拿出别人依赖、采用、沿用的具体证据，并说明这种影响超出了你自己的单位和合作圈。",
    evidence: "每一条都要有对应的文件：引用方论文的首页和引用你的那一页（把那句话标出来）、公司或政府报告的相关页、采用证明信等。写的时候就把链接记下来。",
    avoid: [
      "列的是自引，或者合作者、同课题组的人的引用",
      "只写「被引用了 300 次」，没有任何具体案例",
      "引号里的话和原文对不上，或者是自己概括后加了引号",
      "把顺带提到一句的引用说成「高度评价」",
    ],
  },

  awards: {
    points: [
      "只写有评选、有竞争的奖项。每行一个：奖项全称、颁发机构、年份、获奖比例。",
      "获奖比例是关键信息，例如「604 篇投稿中选出 5 篇」。能查到就一定写上。",
      "说明评选范围：是面向全国或全世界，还是只面向本校、本公司。",
      "论文奖要写清是 Best Paper、Outstanding Paper 还是提名、候选，不要拔高。",
      "入学奖学金、助学金、旅行资助（travel grant）、校内或院系内的奖一般不算，可以不写；拿不准的可以写上，让 AI 在写文书时判断怎么用。",
    ],
    example: "Best Paper Award, International Conference on Example Systems (ICES), 2024. Selected by the program committee as 1 of 3 award papers out of 1,247 submissions.",
    niw: "NIW 里奖项是加分项，用来佐证你的工作得到同行认可，没有也不影响。",
    eb1a: "对应「国家级或国际级奖项」这一项标准。门槛比较高：要证明奖项本身在领域内有公认的声望、评选面向全国或国际、竞争激烈。学生奖、校内奖、只面向早期研究者的小奖通常不被认可。达不到的不要硬申这一项，把奖项当作其他标准的辅助证据更稳妥。",
    evidence: "获奖证书或官方公告、说明评选标准和获奖比例的官方页面、能说明这个奖在领域内分量的第三方材料（例如媒体报道、历届获奖者名单）。",
    avoid: ["把提名、入围写成获奖", "写不出颁奖机构和评选范围", "把团队奖写成个人奖"],
  },

  reviews: {
    points: [
      "按期刊或会议逐个填，写审过几篇。期刊按稿件数算，会议按你实际审的论文数算。",
      "只算你本人受邀审的。替导师审的、没有以自己名义留下记录的不算。",
      "「是否有正式邀请」指有没有编辑或程序委员会发给你本人的邀请邮件或系统通知。",
      "担任过领域主席（Area Chair）、高级程序委员（Senior PC）、期刊编委或客座编辑的，在「其他」里单独写，分量比普通审稿高。",
      "审稿的期刊或会议档次比数量重要，把最好的几个排在前面。",
    ],
    niw: "NIW 里审稿经历用来说明你是领域内被认可的专家，属于辅助证据。",
    eb1a: "对应「评审他人工作」这一项标准，是最容易满足的标准之一。但仅有审稿不足以说明你处于顶尖水平，最后整体评估时审查官会看审稿的期刊档次、数量和持续时间。",
    evidence: "每一个期刊或会议都需要证明：邀请邮件、审稿完成后的感谢信、审稿证书，或会议官网上的审稿人名单。现在就可以开始把这些邮件导出成 PDF。",
    avoid: ["数字是估的，和能拿出的证明对不上", "把同一个会议不同年份重复算又没写清", "把替别人审的算进来"],
  },

  openSource: {
    points: [
      "每个项目写四到五项内容：",
      "名称和公开链接（GitHub、GitLab、PyPI、Hugging Face 等）；",
      "你的角色：你写了哪些模块、功能或文档，是发起人、核心维护者还是贡献者。别人发起的项目，只写你自己提交的部分；",
      "使用情况：star、fork、下载量、依赖它的其他项目，注明数字是哪天看到的；有知名机构或产品在用的，点名并给出处；",
      "和美国重点方向的关系（如果有）：一两句话说明它用在哪类问题上；",
      "得到的认可：发布说明里的致谢、被邀请成为维护者、社区奖项等。",
      "数字要能在公开页面上核实。",
    ],
    example:
      "Project: BattLife (github.com/example/battlife)\nRole: I created the project and wrote the prediction engine and the data-loading module in Python. I maintain the repository and review outside contributions.\nImpact and adoption: 640 stars and 95 forks on GitHub; about 12,000 downloads from PyPI (as of March 2026). Used in the testing pipeline described in Example Motors' 2025 technical report [link].\nConnection to U.S. priorities: faster battery qualification supports domestic battery manufacturing.\nRecognition: listed as a recommended tool in the Battery Data Alliance's 2025 resource guide [link].",
    niw: "开源项目被广泛使用，是「你的工作已经产生实际影响」的有力证据，尤其适合论文引用不多但工具被大量使用的申请人。",
    eb1a: "可以作为「原创贡献具有重大意义」的证据。重点是被谁用了、用来做什么，而不是 star 数本身。",
    evidence: "仓库主页截图（带日期和各项数字）、下载统计页、你的提交记录、提到你的发布说明、使用方的公开说明。",
    avoid: ["只贴一个链接，不说自己做了什么", "把别人项目的 star 数算成自己的成绩", "数字没有日期"],
  },

  media: {
    points: [
      "写报道了你本人或你的工作的媒体。每行一条：媒体名称、文章标题、发表日期、链接。",
      "分量看两点：媒体本身的影响力（全国性大报、行业内公认的专业媒体 ＞ 小众博客），以及文章是不是主要在讲你的工作（专题报道 ＞ 提到一句）。",
      "不算的：你自己或所在单位发的新闻稿、学校官网的宣传、付费发布的稿件、自己的社交媒体。学校新闻稿可以写，但要标明来源，分量较低。",
      "外文报道如实写原标题，之后提交时需要附英文翻译。",
      "报道的是使用了你成果的产品（文章里提到了你的工作或工具名）也可以写，注明文章里哪一段提到了你。",
    ],
    example: "MIT Technology Review, \"A faster way to tell how long a battery will last,\" May 12, 2025, https://example.org/article. Feature article about my paper; quotes me in paragraphs 3–5.",
    niw: "NIW 不要求媒体报道，有的话用来佐证工作的影响超出了学术圈。",
    eb1a: "对应「专业或主要媒体对申请人的报道」这一项标准。要求比较严：文章要是关于你和你的工作的，要有标题、日期、作者，还要证明这家媒体属于主要媒体或行业内的重要刊物（发行量、访问量、行业地位）。只提到一句的文章通常不够。",
    evidence: "把每篇报道在浏览器里用「打印 → 另存为 PDF」存下来，要能看到网址、日期和作者，上传到案件的「文件」里。另外准备一份说明这家媒体影响力的材料（发行量或访问量数据）。",
    avoid: ["把单位新闻稿当成独立媒体报道", "链接已经失效又没有存档", "文章里其实没有提到你或你的工作"],
  },

  other: {
    points: [
      "前面没覆盖到、但你觉得有分量的都写在这里，宁多勿少，AI 写文书时会判断用在哪。可以对照下面几类想一想：",
      "领导或关键角色：是否担任过项目负责人、PI、技术负责人，或在知名机构里承担不可替代的职责？写明机构、职位、时间和你负责的事。",
      "会员资格：是否是需要评审才能加入的专业组织的成员？高级会员（Senior Member）、会士（Fellow）这类有门槛的级别分量明显更高；交会费就能加入的不算。",
      "高薪酬：收入是否明显高于同领域、同地区、同级别的人？写明年薪和大致的对比。",
      "专利和产品：是否有授权专利、已经转让或许可的技术、正在被使用的产品？",
      "受邀报告：是否收到过主动邀请，在会议、研讨会上做特邀报告，或到大学、研究机构做讲座？自己投稿被接收的口头报告不算受邀。",
      "编委和评审职务：期刊编委、客座编辑、领域主席、基金评审专家。",
      "指导和教学：指导的学生取得的成绩、开设的课程被采用的情况。",
    ],
    example:
      "Invited talk: \"Predicting battery lifetime from early data,\" keynote at the 2025 Example Energy Storage Symposium, invited by the program chair (invitation email available).\nMembership: Senior Member, IEEE (elevated 2025).\nRole: Technical lead of the battery analytics team at Example Labs since 2024, responsible for the lifetime-prediction models used in all new cell designs.",
    niw: "这些都可以作为「你有能力推进这项事业」的辅助证据。",
    eb1a: "这里的几类分别对应 EB-1A 的几项标准：领导或关键角色、需要杰出成就的会员资格、高薪酬。每一项都有具体的证明要求，例如高薪酬需要拿政府或行业的薪资统计做对比，关键角色需要证明所在机构本身有卓越声誉。",
    evidence: "邀请邮件、会员证书和该级别的评选标准、聘书或雇主信、工资单和薪资对比数据、专利授权书。",
    avoid: ["把自己投稿的会议报告写成受邀报告", "把普通会员写成需要评审的会员", "职位写了头衔，但说不出具体负责什么"],
  },
};

/** 所有项通用的两条说明，放在贡献总结最上面 */
export const SOC_GENERAL = {
  evidence:
    "证据分两种。客观证据是能独立核实的正式文件，例如论文首页、引用记录、获奖证书、邀请邮件、公开的下载统计。主观证据是别人对你的评价，主要是推荐信。推荐信用来解释你的工作意味着什么，但不能单独证明某件事：推荐信里说你的论文被引用了 500 次，仍然需要交一份引用记录。所以这里写的每一件事，都要想好之后能拿出什么客观证据。填写阶段不用上传，文书定稿后再按实际引用到的内容准备。",
  truth:
    "这里写的内容会进入提交给移民局的申请材料，你需要对其真实性负责。不要编造或夸大论文、引用、奖项、职位和数字，不要改动任何证明文件。虚假陈述可能导致申请被拒，并留下欺诈记录，影响之后所有的移民申请。",
};
