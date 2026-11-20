/**
 * 文档工作区里，模型通过在回复中输出标签来修改文档：
 *   <doc_write>完整文档</doc_write>
 *   <doc_edit><find>原文</find><replace>新文</replace></doc_edit>
 * 这里负责从（可能还没输出完的）回复里解析这些标签。
 */

const BLOCK = /<doc_(write|edit)>[\s\S]*?<\/doc_\1>/g;

/** 去掉所有文档标签，只留给用户看的聊天文字；回复还在流式输出时也能用 */
export function stripDocBlocks(raw: string): string {
  let s = raw.replace(BLOCK, "");
  const open = s.search(/<doc_(write|edit)>/);
  if (open !== -1) s = s.slice(0, open); // 还没闭合的块
  s = s.replace(/<(d(o(c(_[a-z]*)?)?)?)?$/, ""); // 末尾只输出了一半的开始标签
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** 回复里如果有 <doc_write>，返回目前为止写出的文档内容（流式时是半成品），否则返回 null */
export function liveWrite(raw: string): string | null {
  const start = raw.lastIndexOf("<doc_write>");
  if (start === -1) return null;
  let body = raw.slice(start + "<doc_write>".length);
  const end = body.indexOf("</doc_write>");
  if (end !== -1) body = body.slice(0, end);
  else body = body.replace(/<\/?[a-z_]*$/, ""); // 末尾只输出了一半的结束标签
  return body.replace(/^\n+/, "").replace(/\s+$/, "") + (end !== -1 ? "\n" : "");
}

export type DocEdit = { find: string; replace: string };

export function parseEdits(raw: string): DocEdit[] {
  const edits: DocEdit[] = [];
  const re = /<doc_edit>\s*<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>\s*<\/doc_edit>/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    edits.push({ find: m[1], replace: m[2] });
  }
  return edits;
}

export function applyEdits(content: string, edits: DocEdit[]) {
  let applied = 0;
  let failed = 0;
  for (const e of edits) {
    // 先按原样找，找不到再去掉首尾空白找一次
    const candidates = [[e.find, e.replace], [e.find.trim(), e.replace.trim()]];
    const hit = candidates.find(([f]) => f && content.includes(f));
    if (!hit) {
      failed++;
      continue;
    }
    const i = content.indexOf(hit[0]);
    content = content.slice(0, i) + hit[1] + content.slice(i + hit[0].length);
    applied++;
  }
  return { content, applied, failed };
}
