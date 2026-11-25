/**
 * 聊天卡片的「撤销」。应用一张卡片时，对比应用前后的数据，记下哪些地方变了（diff）；
 * 撤销时只把仍然保持着卡片写入内容的地方改回去（revert），用户在那之后自己又改过的地方不动。
 *
 * 路径里以 # 开头的一段表示「列表里 id 是它的那一项」，例如 ["profile","soc","projects","#abc","summary"]。
 */

export type Change = {
  path: string[];
  before?: unknown; // 没有 before：这是新加的一项（或原来没有这个字段）
  after?: unknown; // 没有 after：这一项被删掉了（或字段被去掉）
  at?: number; // 列表项原来（或现在）排在第几个
};

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isIdList = (x: unknown): x is (Obj & { id: string })[] => Array.isArray(x) && x.every((i) => isObj(i) && typeof i.id === "string");
/** 修改时间不算内容：不记进改动里，比较时也不看 */
const SKIP = new Set(["updatedAt"]);

/** 内容是否相同（不看字段的先后顺序；null、undefined、没有这个字段都算一样） */
export function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => eq(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!SKIP.has(k) && !eq(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/** 从 a 变成 b 改了哪些地方 */
export function diff(a: unknown, b: unknown, path: string[] = [], out: Change[] = []): Change[] {
  if (a === b) return out;
  if (isIdList(a) && isIdList(b)) {
    const A = new Map(a.map((x) => [x.id, x]));
    const B = new Set(b.map((x) => x.id));
    a.forEach((x, i) => {
      if (!B.has(x.id)) out.push({ path: [...path, `#${x.id}`], before: x, at: i });
    });
    b.forEach((x, i) => {
      const old = A.get(x.id);
      if (old) diff(old, x, [...path, `#${x.id}`], out);
      else out.push({ path: [...path, `#${x.id}`], after: x, at: i });
    });
    return out;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!SKIP.has(k)) diff(a[k], b[k], [...path, k], out);
    return out;
  }
  if (!eq(a, b)) out.push({ path, before: a, after: b });
  return out;
}

type Removed = { path: string[]; item: unknown };
type Step = { ok: true; value: unknown } | { ok: false };
const NO: Step = { ok: false };

function undoAt(node: unknown, path: string[], c: Change, removed: Removed[]): Step {
  const [head, ...rest] = path;
  if (head.startsWith("#")) {
    if (!Array.isArray(node)) return NO;
    const id = head.slice(1);
    const i = node.findIndex((x) => isObj(x) && x.id === id);
    if (rest.length) {
      if (i === -1) return NO;
      const r = undoAt(node[i], rest, c, removed);
      return r.ok ? { ok: true, value: node.map((x, k) => (k === i ? r.value : x)) } : NO;
    }
    if (c.after !== undefined && c.before === undefined) {
      // 卡片加的一项：还在、而且没被改过，才拿掉；已经不在了就当作撤销好了
      if (i === -1) return { ok: true, value: node };
      if (!eq(node[i], c.after)) return NO;
      removed.push({ path: c.path, item: node[i] });
      return { ok: true, value: node.filter((_, k) => k !== i) };
    }
    // 卡片删的一项：放回原来的位置
    if (i !== -1 || c.before === undefined) return NO;
    const at = Math.min(Math.max(c.at ?? node.length, 0), node.length);
    return { ok: true, value: [...node.slice(0, at), c.before, ...node.slice(at)] };
  }
  if (!isObj(node)) return NO;
  if (rest.length) {
    const r = undoAt(node[head], rest, c, removed);
    return r.ok ? { ok: true, value: { ...node, [head]: r.value } } : NO;
  }
  if (!eq(node[head], c.after)) return NO; // 之后又改过：不动
  const copy = { ...node };
  if (c.before === undefined) delete copy[head];
  else copy[head] = c.before;
  return { ok: true, value: copy };
}

/**
 * 把这些改动撤回去。left 是没能撤回的（那个地方之后又被改过）；
 * removed 是撤销时从列表里拿掉的项（比如存进案件的文件，调用方要把文件内容也清掉）。
 */
export function revert<T extends Obj>(state: T, changes: Change[]): { state: T; left: Change[]; removed: Removed[] } {
  let root: unknown = state;
  const left: Change[] = [];
  const removed: Removed[] = [];
  for (const c of [...changes].reverse()) {
    const r = c.path.length ? undoAt(root, c.path, c, removed) : NO;
    if (r.ok) root = r.value;
    else left.unshift(c);
  }
  return { state: root as T, left, removed };
}
