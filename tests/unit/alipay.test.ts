// 支付宝到账通知：验签、入账、累计赠送；重发的通知不重复入账
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 测试自己扮演支付宝：用一对临时密钥给通知签名，网站用对应的公钥验签
const fake = generateKeyPairSync("rsa", { modulusLength: 2048 });
const app = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "diy-alipay-"));
process.env.ALIPAY_APP_ID = "2000000000000000";
process.env.ALIPAY_PRIVATE_KEY = app.privateKey.export({ type: "pkcs1", format: "der" }).toString("base64");
process.env.ALIPAY_PUBLIC_KEY = fake.publicKey.export({ type: "spki", format: "der" }).toString("base64");
delete process.env.ALIPAY_GATEWAY;

import { createAlipayOrder, handleAlipayNotify } from "@/lib/server/alipay";
import { db } from "@/lib/server/db";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -- " + JSON.stringify(detail))); };

const d = db();
const now = Date.now();
d.prepare("INSERT INTO users (id, email, credits, created_at) VALUES ('u1', 'test@example.com', 0, ?)").run(now);
const credits = () => (d.prepare("SELECT credits FROM users WHERE id = 'u1'").get() as { credits: number }).credits;
const order = (no: string, pack: string, amount: string) =>
  d.prepare("INSERT INTO orders (order_no, user_id, pack, amount, status, created_at) VALUES (?, 'u1', ?, ?, 'pending', ?)").run(no, pack, amount, now);
function notice(no: string, amount: string, status = "TRADE_SUCCESS", key = fake.privateKey): Record<string, string> {
  const p: Record<string, string> = { app_id: process.env.ALIPAY_APP_ID!, out_trade_no: no, total_amount: amount, trade_status: status, charset: "utf-8", notify_time: "2026-01-01 00:00:00" };
  const text = Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join("&");
  return { ...p, sign_type: "RSA2", sign: createSign("RSA-SHA256").update(text, "utf8").sign(key, "base64") };
}

// 下单：电脑和手机都用电脑网站支付的接口（手机网站支付没有签约，调了会报权限不足）
const url = new URL(createAlipayOrder("u1", "p5", "https://example.com")!);
const biz = JSON.parse(url.searchParams.get("biz_content")!);
ok("alipay: checkout always uses the page-pay interface the account is signed for", url.searchParams.get("method") === "alipay.trade.page.pay" && biz.product_code === "FAST_INSTANT_TRADE_PAY" && biz.total_amount === "36.00", [url.searchParams.get("method"), biz]);
ok("alipay: checkout saves a pending order and an unknown pack gives no link", (d.prepare("SELECT status FROM orders WHERE order_no = ?").get(biz.out_trade_no) as { status: string }).status === "pending" && createAlipayOrder("u1", "nope", "https://example.com") === null);
d.prepare("DELETE FROM orders WHERE order_no = ?").run(biz.out_trade_no);

order("a1", "p5", "36.00");
ok("alipay: a forged notification is rejected and credits nothing", handleAlipayNotify(notice("a1", "36.00", "TRADE_SUCCESS", app.privateKey)) === false && credits() === 0);
ok("alipay: a wrong amount is rejected", handleAlipayNotify(notice("a1", "0.01")) === false && credits() === 0);
ok("alipay: an unfinished trade is acknowledged without crediting", handleAlipayNotify(notice("a1", "36.00", "WAIT_BUYER_PAY")) === true && credits() === 0);
ok("alipay: a paid notification credits the pack", handleAlipayNotify(notice("a1", "36.00")) === true && credits() === 500, credits());
ok("alipay: the same notification again changes nothing", handleAlipayNotify(notice("a1", "36.00")) === true && credits() === 500, credits());
for (const no of ["a2", "a3"]) { order(no, "p5", "36.00"); handleAlipayNotify(notice(no, "36.00")); }
ok("alipay: three small purchases, no bonus yet", credits() === 1500, credits());
order("a4", "p5", "36.00");
handleAlipayNotify(notice("a4", "36.00"));
ok("alipay: the 4th small purchase adds the 200 bonus (2200 in total, same as the larger pack)", credits() === 2200, credits());
handleAlipayNotify(notice("a4", "36.00"));
handleAlipayNotify(notice("a2", "36.00"));
ok("alipay: resent notifications never repeat the bonus", credits() === 2200, credits());
order("big", "p20", "145.00");
handleAlipayNotify(notice("big", "145.00"));
order("a5", "p5", "36.00");
handleAlipayNotify(notice("a5", "36.00"));
ok("alipay: a larger pack credits its own amount and does not count towards the small-pack bonus", credits() === 2200 + 2200 + 500, credits());
const rows = d.prepare("SELECT reason, delta FROM ledger WHERE user_id = 'u1' AND ref LIKE 'loyalty:%'").all() as { reason: string; delta: number }[];
ok("alipay: the ledger shows one bonus line with a readable reason", rows.length === 1 && rows[0].delta === 200 && rows[0].reason === "累计充值满 4 笔赠送", rows);
ok("alipay: all notified orders are marked paid", (d.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'").get() as { n: number }).n === 6);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
