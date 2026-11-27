// 小额档累计赠送：门槛和数字跟大档位对得上，入账只发生一次
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "diy-loyalty-"));
import { loyaltyBonusAt, loyaltyNext } from "@/lib/loyalty";
import { BASE_PACK, grantLoyalty, LOYALTY, LOYALTY_CYCLE, loyaltyPaid, PACKS } from "@/lib/server/credits";
import { db } from "@/lib/server/db";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -- " + JSON.stringify(detail))); };

ok("loyalty: tiers are 4→200, 10→800, 20→2000 and a round is 20 purchases", JSON.stringify(LOYALTY) === JSON.stringify([{ count: 4, bonus: 200 }, { count: 10, bonus: 800 }, { count: 20, bonus: 2000 }]) && LOYALTY_CYCLE === 20, [LOYALTY, LOYALTY_CYCLE]);
// 分多次买小档，到手的和一次买大档一样多
for (const p of PACKS.slice(1)) {
  const n = p.usd / BASE_PACK.usd;
  let total = 0;
  for (let i = 1; i <= n; i++) total += BASE_PACK.credits + loyaltyBonusAt(i, LOYALTY, LOYALTY_CYCLE);
  ok(`loyalty: ${n} small purchases give the same credits as the $${p.usd} pack`, total === p.credits, [total, p.credits]);
}
ok("loyalty: purchases between thresholds get nothing extra", [1, 2, 3, 5, 9, 11, 19].every((n) => loyaltyBonusAt(n, LOYALTY, LOYALTY_CYCLE) === 0));
ok("loyalty: the round restarts after 20 (24th purchase earns 200 again)", loyaltyBonusAt(24, LOYALTY, LOYALTY_CYCLE) === 200 && loyaltyBonusAt(40, LOYALTY, LOYALTY_CYCLE) === 2000 && loyaltyBonusAt(21, LOYALTY, LOYALTY_CYCLE) === 0);
ok("loyalty: bad counts earn nothing", [0, -1, 1.5, NaN].every((n) => loyaltyBonusAt(n, LOYALTY, LOYALTY_CYCLE) === 0));
ok("loyalty: progress — 0 bought needs 4 for 200; 4 bought needs 6 for 800; 19 needs 1 for 2000; 20 starts over", JSON.stringify([0, 4, 19, 20, 23].map((n) => loyaltyNext(n, LOYALTY, LOYALTY_CYCLE))) === JSON.stringify([{ need: 4, bonus: 200 }, { need: 6, bonus: 800 }, { need: 1, bonus: 2000 }, { need: 4, bonus: 200 }, { need: 1, bonus: 200 }]), [0, 4, 19, 20, 23].map((n) => loyaltyNext(n, LOYALTY, LOYALTY_CYCLE)));

// 入账：按已付清的小档订单数算，同一笔订单只送一次
const d = db();
const now = Date.now();
d.prepare("INSERT INTO users (id, email, credits, created_at) VALUES ('u1', 'test@example.com', 0, ?)").run(now);
d.prepare("INSERT INTO users (id, email, credits, created_at) VALUES ('u2', 'other@example.com', 0, ?)").run(now);
const pay = (user: string, no: string, pack: string = BASE_PACK.id) => {
  d.prepare("INSERT INTO orders (order_no, user_id, pack, amount, status, created_at, paid_at) VALUES (?, ?, ?, '36.00', 'paid', ?, ?)").run(no, user, pack, now, now);
  return pack === BASE_PACK.id ? grantLoyalty(user, no) : 0;
};
const credits = (user: string) => (d.prepare("SELECT credits FROM users WHERE id = ?").get(user) as { credits: number }).credits;
const got: number[] = [];
for (let i = 1; i <= 24; i++) got.push(pay("u1", `o${i}`));
ok("loyalty: bonuses land on the 4th, 10th, 20th and 24th paid order only", got.map((b, i) => (b ? `${i + 1}:${b}` : "")).filter(Boolean).join(" ") === "4:200 10:800 20:2000 24:200", got);
ok("loyalty: the bonus is credited to the balance and the ledger", credits("u1") === 3200 && (d.prepare("SELECT COUNT(*) AS n FROM ledger WHERE user_id = 'u1' AND ref LIKE 'loyalty:%'").get() as { n: number }).n === 4, credits("u1"));
ok("loyalty: calling again for the same order gives nothing", grantLoyalty("u1", "o24") === 0 && credits("u1") === 3200);
d.prepare("INSERT INTO orders (order_no, user_id, pack, amount, status, created_at) VALUES ('p1', 'u2', ?, '36.00', 'pending', ?)").run(BASE_PACK.id, now);
pay("u2", "big1", PACKS[1].id);
for (let i = 1; i <= 3; i++) pay("u2", `b${i}`);
ok("loyalty: unpaid orders, larger packs and other users' orders do not count", loyaltyPaid("u2") === 3 && credits("u2") === 0, [loyaltyPaid("u2"), credits("u2")]);
ok("loyalty: the 4th small purchase of the second user earns 200", pay("u2", "b4") === 200 && credits("u2") === 200);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
