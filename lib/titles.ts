/** 论文标题的比较。前后端共用：按标题找论文、去重、判断是不是同一篇，都用这里的规则。 */

/** 只留文字和数字（各种语言都算），其余当成空格。以前只留英文字母，中文标题会全部变成空串 */
export const normTitle = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * 按标题查到的论文是不是用户要的那一篇。完全一样才算；
 * 一边是另一边的开头也算（数据库里的标题有时带副标题），但短的那一边至少要有 25 个字符，免得「BERT」对上任何以 BERT 开头的论文。
 */
export function sameTitle(want: string, got: string): boolean {
  const a = normTitle(want);
  const b = normTitle(got);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 25 && long.startsWith(short);
}
