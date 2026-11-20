import { randomBytes } from "node:crypto";
import { AlipaySdk } from "alipay-sdk";
import { db } from "./db";
import { addCredits, PACKS } from "./credits";

/**
 * 支付宝直连（电脑网站支付 / 手机网站支付）。
 * 沙箱测试时把 ALIPAY_GATEWAY 设为沙箱网关；正式环境不设，走默认的正式网关。
 */

const SANDBOX_HINT = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";

export const alipayConfigured = () =>
  Boolean(process.env.ALIPAY_APP_ID && process.env.ALIPAY_PRIVATE_KEY && process.env.ALIPAY_PUBLIC_KEY);

export const alipaySandbox = () => (process.env.ALIPAY_GATEWAY ?? "").includes("sandbox");

function sdk() {
  return new AlipaySdk({
    appId: process.env.ALIPAY_APP_ID!,
    privateKey: process.env.ALIPAY_PRIVATE_KEY!,
    alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY!,
    gateway: process.env.ALIPAY_GATEWAY || undefined,
    keyType: process.env.ALIPAY_KEY_TYPE === "PKCS8" ? "PKCS8" : "PKCS1",
  });
}

/** 创建一笔订单，返回支付宝收银台的跳转地址 */
export function createAlipayOrder(userId: string, packId: string, origin: string, mobile: boolean): string | null {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) return null;
  const orderNo = `D${Date.now()}${randomBytes(5).toString("hex")}`;
  const amount = pack.cny.toFixed(2);
  db()
    .prepare("INSERT INTO orders (order_no, user_id, pack, amount, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)")
    .run(orderNo, userId, pack.id, amount, Date.now());
  return sdk().pageExecute(mobile ? "alipay.trade.wap.pay" : "alipay.trade.page.pay", "GET", {
    notifyUrl: `${origin}/api/billing/alipay/notify`,
    returnUrl: `${origin}/?paid=1`,
    bizContent: {
      out_trade_no: orderNo,
      product_code: mobile ? "QUICK_WAP_WAY" : "FAST_INSTANT_TRADE_PAY",
      subject: `DIY Immigration ${pack.credits} credits`,
      total_amount: amount,
    },
  });
}

/**
 * 处理支付宝的异步通知。验签通过、订单存在、金额一致、交易成功时入账；同一笔订单只入账一次。
 * 返回 true 表示这条通知已经被正确处理（应回复 success）。
 */
export function handleAlipayNotify(params: Record<string, string>): boolean {
  let ok = false;
  try {
    ok = sdk().checkNotifySignV2(params);
  } catch {
    ok = false;
  }
  if (!ok || params.app_id !== process.env.ALIPAY_APP_ID) return false;

  const d = db();
  const order = d.prepare("SELECT user_id, pack, amount, status FROM orders WHERE order_no = ?").get(params.out_trade_no) as
    | { user_id: string; pack: string; amount: string; status: string }
    | undefined;
  if (!order || Number(order.amount) !== Number(params.total_amount)) return false;

  if (params.trade_status === "TRADE_SUCCESS" || params.trade_status === "TRADE_FINISHED") {
    const pack = PACKS.find((p) => p.id === order.pack);
    if (!pack) return false;
    addCredits(order.user_id, pack.credits, `支付宝充值 ¥${order.amount}`, `alipay:${params.out_trade_no}`);
    d.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE order_no = ?").run(Date.now(), params.out_trade_no);
  }
  return true;
}

export { SANDBOX_HINT };
