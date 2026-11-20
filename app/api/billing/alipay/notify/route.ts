import { alipayConfigured, handleAlipayNotify } from "@/lib/server/alipay";

export const runtime = "nodejs";

/** 支付宝付款成功后的异步通知。按支付宝的要求，处理成功回复纯文本 success，否则回复 fail（支付宝会重试）。 */
export async function POST(req: Request) {
  if (!alipayConfigured()) return new Response("fail", { status: 503 });
  const params: Record<string, string> = {};
  new URLSearchParams(await req.text()).forEach((v, k) => {
    params[k] = v;
  });
  const ok = handleAlipayNotify(params);
  return new Response(ok ? "success" : "fail", { headers: { "Content-Type": "text/plain" } });
}
