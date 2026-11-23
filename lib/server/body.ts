/** 读请求内容时边读边数大小，超过上限立刻停，不把整个请求先装进内存再检查。 */

export class TooLarge extends Error {}

export async function readBytes(req: Request, max: number): Promise<Uint8Array> {
  if (Number(req.headers.get("content-length") ?? 0) > max) throw new TooLarge();
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      reader.cancel().catch(() => {});
      throw new TooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** 读 JSON。格式不对返回 null；太大抛 TooLarge */
export async function readJson(req: Request, max: number): Promise<any> {
  const bytes = await readBytes(req, max);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export const tooLarge = (what = "请求内容") => Response.json({ error: `${what}太大了。` }, { status: 413 });
