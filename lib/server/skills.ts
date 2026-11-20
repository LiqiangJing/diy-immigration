import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workflowById } from "@/lib/skills";

/** 把一个开源 skill 和它需要的参考资料拼成系统提示的一部分。 */

const ROOT = join(process.cwd(), "skills", "immigration-attorney");

const COMMON = ["evidence-hierarchy.md", "uscis-policy-alerts.md", "argument-patterns.md"];
const NIW = ["overview-niw.md", "prongs/01-substantial-merit.md", "prongs/02-well-positioned.md", "prongs/03-national-interest-balance.md"];
const EB1A = [
  "overview-o1a-eb1a.md",
  ...["01-awards", "02-membership", "03-published-material", "04-original-contributions", "05-scholarly-articles", "06-critical-employment", "07-high-remuneration", "08-judging"].map(
    (f) => `criteria/${f}.md`,
  ),
];

const ADAPTER = `
下面是一份「skill」，规定了你在这个工作流里应该怎么做。它原本是为在本地文件夹里运行的助手写的，在这里使用时按以下规则理解：

- 你没有文件系统、命令行或联网搜索。凡是 skill 让你「读取文件」「运行脚本」「访问网址」「搜索网络」的地方，都改为使用对话中已经提供的内容：用户的档案、引用的文件和文档、以及附在 skill 后面的 knowledge 参考资料。
- skill 提到的 document index、source registry 或其他 skill 的产出，在这里不存在。直接把用户引用的文件当作原始材料来读；如果缺少完成任务必需的材料，明确告诉用户缺什么，让他上传或引用。
- 无法核实的事实（网页数据、统计数字、机构排名等）不要凭记忆写成确定的事实；在文档里标成 [待核实：…] 或 [待补充：…]，并在聊天里说明需要用户提供什么来源。
- 忽略 skill 里关于 O-1 签证、把结果保存到某个路径、调用其他 skill 的指示。
- 最终成果（评估报告、信件、审计报告等）按文档工作区的规则写进文档，不要贴在聊天里。给用户看的评估和审计报告用中文写，其中的法律术语保留英文；要递交给 USCIS 的文书用英文写。
- skill 是给律师团队写的；这里的用户是自己准备申请的申请人本人，请直接对他说话。
- knowledge 资料是社区整理的，可能过时或有误；涉及具体政策、费用、时间的地方提醒用户以 USCIS 官方信息为准。
`;

/** OpenNIW 项目里的参考资料：每个工作流用哪几份（NIW 和 EB-1A 各有一套同名文件） */
const OPENNIW: Record<string, string[]> = {
  "case-strength-assessor": ["evaluation.md"],
  "niw-petition-narrative": ["drafting.md", "endeavor.md", "national-importance-sources.md"],
  "eb1a-petition-narrative": ["drafting.md", "claim-frame.md"],
  "expert-letter-drafter": ["support-letters.md"],
  "petition-audit": ["rfe.md"],
  "rfe-response-drafter": ["rfe-response.md"],
  "form-guide": ["forms.md"],
  "cover-letter": ["forms.md"],
};

const OPENNIW_NOTE = `
下面的 <reference> 是另一份开源资料（OpenNIW）里对应环节的做法，作为补充参考：
- 它原本是给能运行命令的本地助手写的。里面提到的 openniw 命令、scripts 脚本、浏览器向导、case.json、documents/ 等文件路径在这里都不存在，忽略这些操作步骤，只用其中的专业内容（结构、要点、常见错误、填表说明）。
- 里面带日期的信息（申请费、寄送地址、表格版本、排期、政策动向）可以告诉用户，但必须同时说明资料标注的核实日期，并提醒用户递交前到 uscis.gov 或 travel.state.gov 复核。
- 它要求的 [TODO: …] 标记，在这里统一写成 [待补充：…]。`;

function openniwRefs(id: string, kind: string): string {
  const files = OPENNIW[id];
  if (!files) return "";
  const dir = join(process.cwd(), "skills", "openniw", kind === "EB-1A" ? "eb1a-petition" : "niw-petition");
  const refs = files.flatMap((f) => {
    try {
      return [`<reference file="${f}">\n${readFileSync(join(dir, f), "utf8")}\n</reference>`];
    } catch {
      return []; // 两套资料的文件不完全对应，缺的跳过
    }
  });
  return refs.length ? `\n${OPENNIW_NOTE}\n\n${refs.join("\n\n")}` : "";
}

const cache = new Map<string, string>();

export function skillPrompt(id: string | undefined, caseType: string | undefined): string {
  const wf = workflowById(id);
  if (!wf) return "";
  const kind = caseType === "EB-1A" ? "EB-1A" : "NIW";
  const key = `${id}:${kind}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  try {
    if (wf.own) {
      const own = readFileSync(join(process.cwd(), "skills", "diy", `${id}.md`), "utf8");
      const text = `\n\n下面规定了你在这个工作流里应该怎么做。成果按文档工作区的规则写进文档，不要贴在聊天里。这个案件的类别是 ${kind}。\n\n<skill name="${id}">\n${own}\n</skill>${openniwRefs(id!, kind)}`;
      cache.set(key, text);
      return text;
    }
    const skill = readFileSync(join(ROOT, id!, "skill.md"), "utf8");
    const knowledge = [...COMMON, ...(kind === "EB-1A" ? EB1A : NIW)]
      .map((f) => `<knowledge file="knowledge/${f}">\n${readFileSync(join(ROOT, "knowledge", f), "utf8")}\n</knowledge>`)
      .join("\n\n");
    // EB-1A 的申请信另外附上我们自己定的信件结构
    const format =
      id === "eb1a-petition-narrative"
        ? `\n\n<letter_format>\n${readFileSync(join(process.cwd(), "skills", "diy", "eb1a-letter-format.md"), "utf8")}\n</letter_format>`
        : "";
    const text = `\n\n${ADAPTER}\n这个案件的类别是 ${kind}。\n\n<skill name="${id}">\n${skill}\n</skill>\n\n${knowledge}${openniwRefs(id!, kind)}${format}`;
    cache.set(key, text);
    return text;
  } catch (e) {
    console.error("[skills] 读取失败", id, e);
    return "";
  }
}
