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
      const text = `\n\n下面规定了你在这个工作流里应该怎么做。成果按文档工作区的规则写进文档，不要贴在聊天里。这个案件的类别是 ${kind}。\n\n<skill name="${id}">\n${own}\n</skill>`;
      cache.set(key, text);
      return text;
    }
    const skill = readFileSync(join(ROOT, id!, "skill.md"), "utf8");
    const knowledge = [...COMMON, ...(kind === "EB-1A" ? EB1A : NIW)]
      .map((f) => `<knowledge file="knowledge/${f}">\n${readFileSync(join(ROOT, "knowledge", f), "utf8")}\n</knowledge>`)
      .join("\n\n");
    const text = `\n\n${ADAPTER}\n这个案件的类别是 ${kind}。\n\n<skill name="${id}">\n${skill}\n</skill>\n\n${knowledge}`;
    cache.set(key, text);
    return text;
  } catch (e) {
    console.error("[skills] 读取失败", id, e);
    return "";
  }
}
