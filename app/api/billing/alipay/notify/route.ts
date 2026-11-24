import { alipayConfigured, handleAlipayNotify } from "@/lib/server/alipay";
import { readBytes, TooLarge } from "@/lib/server/body";

export const runtime = "nodejs";

/** 支付宝付款成功后的异步通知。按支付宝的要求，处理成功回复纯文本 success，否则回复 fail（支付宝会重试）。 */
export async function POST(req: Request) {
  if (!alipayConfigured()) return new Response("fail", { status: 503 });
  const params: Record<string, string> = {};
  let text: string;
  try {
    text = new TextDecoder().decode(await readBytes(req, 64 * 1024)); // 这个地址谁都能访问，不收过大的内容
  } catch (e) {
    if (e instanceof TooLarge) return new Response("fail", { status: 413 });
    throw e;
  }
  new URLSearchParams(text).forEach((v, k) => {
    params[k] = v;
  });
  const ok = handleAlipayNotify(params);
  return new Response(ok ? "success" : "fail", { headers: { "Content-Type": "text/plain" } });
}
