import type { ImmigrationCase } from "./types";

/** 申报条件：EB-1A 主张哪几项标准；NIW 用哪条路满足 EB-2 的基础资格 */

export type Claim = { id: string; label: string; en: string; hint?: string };

/** EB-1A 的十项标准，8 C.F.R. § 204.5(h)(3)(i)–(x)，至少满足三项 */
export const EB1A_CRITERIA: Claim[] = [
  { id: "awards", label: "奖项", en: "(i) Lesser nationally or internationally recognized prizes or awards for excellence", hint: "国家级或国际级的奖项" },
  { id: "membership", label: "会员资格", en: "(ii) Membership in associations that require outstanding achievements of their members", hint: "入会需要由专家评审、以杰出成就为条件的协会" },
  { id: "media", label: "媒体报道", en: "(iii) Published material about the person in professional or major trade publications or other major media", hint: "专业刊物或主流媒体关于你本人和你的工作的报道" },
  { id: "judging", label: "评审他人工作", en: "(iv) Participation as a judge of the work of others", hint: "期刊 / 会议审稿、评委、论文答辩委员等" },
  { id: "contributions", label: "原创贡献", en: "(v) Original scientific, scholarly, artistic, athletic, or business-related contributions of major significance", hint: "有重大意义的原创贡献，通常靠引用、他人采用和推荐信证明" },
  { id: "articles", label: "学术文章", en: "(vi) Authorship of scholarly articles in professional or major trade publications or other major media", hint: "发表的论文" },
  { id: "exhibitions", label: "作品展出", en: "(vii) Display of the person's work at artistic exhibitions or showcases", hint: "主要适用于艺术领域" },
  { id: "leading", label: "领导或关键角色", en: "(viii) Performance in a leading or critical role for organizations with a distinguished reputation", hint: "在知名机构里担任领导或关键岗位" },
  { id: "salary", label: "高薪酬", en: "(ix) High salary or other significantly high remuneration in relation to others in the field", hint: "薪酬明显高于同行" },
  { id: "commercial", label: "商业成功", en: "(x) Commercial successes in the performing arts", hint: "主要适用于表演艺术领域" },
];

/** EB-2 特殊能力（exceptional ability）的六项标准，8 C.F.R. § 204.5(k)(3)(ii)(A)–(F)，至少满足三项 */
export const EXCEPTIONAL_CRITERIA: Claim[] = [
  { id: "x-degree", label: "学位", en: "(A) An official academic record showing a degree, diploma, or certificate relating to the area of exceptional ability" },
  { id: "x-experience", label: "十年经验", en: "(B) Letters documenting at least ten years of full-time experience in the occupation" },
  { id: "x-license", label: "执业执照", en: "(C) A license to practice the profession or certification for the profession or occupation" },
  { id: "x-salary", label: "薪酬", en: "(D) Evidence of a salary or other remuneration that demonstrates exceptional ability" },
  { id: "x-membership", label: "专业协会会员", en: "(E) Membership in professional associations" },
  { id: "x-recognition", label: "同行或机构的认可", en: "(F) Recognition for achievements and significant contributions to the industry or field by peers, government entities, or professional or business organizations" },
];

export const MIN_CLAIMS = 3;

/** 申报条件是否已经选够 */
export function claimsReady(c: ImmigrationCase): boolean {
  const n = (c.claims ?? []).length;
  if (c.type === "EB-1A") return n >= MIN_CLAIMS;
  return c.eb2 === "advanced" || (c.eb2 === "exceptional" && n >= MIN_CLAIMS);
}

/** 发给模型的一行说明；还没选时返回空串 */
export function claimsLine(c: ImmigrationCase): string {
  const picked = (list: Claim[]) => list.filter((x) => (c.claims ?? []).includes(x.id)).map((x) => x.en);
  if (c.type === "EB-1A") {
    const p = picked(EB1A_CRITERIA);
    return p.length
      ? `申请人选择主张的 EB-1A 标准（只论证这几项，除非申请人改主意；认为选得不合适时可以指出来）：${p.join("；")}`
      : "";
  }
  if (c.eb2 === "advanced") return "EB-2 基础资格：申请人选择按高等学位（advanced degree）申报。";
  if (c.eb2 === "exceptional") {
    const p = picked(EXCEPTIONAL_CRITERIA);
    return `EB-2 基础资格：申请人选择按特殊能力（exceptional ability）申报${p.length ? `，主张的标准：${p.join("；")}` : ""}。`;
  }
  return "";
}
