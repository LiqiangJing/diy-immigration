// 扣费的倍数：主聊天按较低的倍数算，文档工作区里的对话和别的功能不变
import { chatCost, CHAT_MARKUP, NOTABLE_MARKUP, PRICES } from "@/lib/server/credits";
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -- " + JSON.stringify(detail))); };
const p = PRICES["gpt-6.2-sol"];
const reply = { input_tokens: 3000, output_tokens: 400, cache_read_input_tokens: 0 };
ok("price: the main-chat multiplier defaults to 10", CHAT_MARKUP === 10, CHAT_MARKUP);
ok("price: a typical reply costs 40 credits in a document and 10 in the main chat", chatCost(reply, p) === 40 && chatCost(reply, p, CHAT_MARKUP) === 10, [chatCost(reply, p), chatCost(reply, p, CHAT_MARKUP)]);
ok("price: citation analysis keeps its own multiplier", NOTABLE_MARKUP === 25 && chatCost(reply, p, NOTABLE_MARKUP) === 25);
ok("price: the smallest charge is still 1 credit", chatCost({ input_tokens: 10, output_tokens: 5 }, p, CHAT_MARKUP) === 1);
ok("price: unreadable usage is charged the minimum, not skipped", chatCost({ input_tokens: NaN as number }, p, CHAT_MARKUP) === 1 && chatCost(null, p, CHAT_MARKUP) === 1);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
