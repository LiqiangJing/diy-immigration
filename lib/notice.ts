/**
 * 服务端在模型的回复后面追加提示（出错、被截断等）时，先发这个记号，再发提示文字。
 * 页面看到记号就知道后面不是模型写的内容：不会把它当成文档或操作的一部分。记号本身不显示。
 */
export const NOTICE = "\u001e";

/** 把一段完整的回复拆成模型写的内容和服务端的提示 */
export function splitNotice(raw: string): { body: string; notice: string } {
  const i = raw.indexOf(NOTICE);
  return i === -1 ? { body: raw, notice: "" } : { body: raw.slice(0, i), notice: raw.slice(i).split(NOTICE).join("").trim() };
}
