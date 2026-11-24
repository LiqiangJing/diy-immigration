import { apply, describe, readActions, stripActions } from "@/lib/actions";
import { emptyProfile } from "@/lib/profile";
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -- " + JSON.stringify(detail)?.slice(0, 500))); };

// 字符串里直接换行（模型常见写法）
const raw1 = `好的，整理成了卡片。\n<action>{"type":"endeavor","set":{"plan":"Project 1 (2027): extend the model.\nProject 2 (2028): build a tool.\tDone.","statement":"My proposed endeavor is to \\"predict\\" battery life."}}</action>`;
const r1 = readActions(raw1);
ok("actions: raw newlines and tabs inside strings are repaired", r1.failed === 0 && r1.actions.length === 1 && (r1.actions[0] as any).set.plan.includes("\nProject 2") && (r1.actions[0] as any).set.statement.includes('"predict"'), r1);
// 完全坏掉的
const r2 = readActions(`<action>{"type":"profile","set":{"firstName": Jane}}</action> 文字 <action>{"type":"case","name":"A","caseType":"NIW"}</action>`);
ok("actions: an unreadable block is counted, good ones still parsed", r2.failed === 1 && r2.actions.length === 1 && r2.actions[0].type === "case", r2);
// 没闭合
const r3 = readActions(`说明\n<action>{"type":"soc","set":{"importance":"abc`);
ok("actions: a truncated block is reported", r3.failed === 1 && r3.actions.length === 0 && stripActions(`说明\n<action>{"type":"soc"`) === "说明", r3);
// 代码块包着的
const r4 = readActions("<action>```json\n{\"type\":\"case\",\"name\":\"B\",\"caseType\":\"EB-1A\"}\n```</action>");
ok("actions: fenced JSON accepted", r4.failed === 0 && (r4.actions[0] as any).caseType === "EB-1A", r4);
// 不认识的类型、空操作
const r5 = readActions(`<action>{"type":"deleteEverything"}</action><action>{"type":"profile","set":{}}</action>`);
ok("actions: unknown or empty actions are not applied", r5.actions.length === 0 && r5.failed === 2, r5);
// 字段白名单和长度
const r6 = readActions(`<action>{"type":"profile","set":{"firstName":"Jane","credits":999999,"email":"x@y.z","reviews":"1000","sameField":"maybe"},"addDegrees":[{"type":"Juris Doctor","major":"Law","university":"U"},{"type":"Doctor of Medicine","major":"Medicine","university":"U"},{"type":"Ph.D.","major":"CS","university":"U"},{"type":"MS","major":"EE","university":"U"},{"type":"本科","major":"Math","university":"U"},{"type":"Diploma","major":"X","university":"U"}]}</action>`);
const a6 = r6.actions[0] as any;
ok("actions: only whitelisted fields and valid choices survive", JSON.stringify(Object.keys(a6.set)) === '["firstName"]', a6.set);
ok("actions: degree names map correctly (JD and MD are not PhD)", JSON.stringify(a6.addDegrees.map((d: any) => d.type)) === JSON.stringify(["JD", "MD", "博士（PhD）", "硕士（Master）", "学士（Bachelor）", "其他"]), a6.addDegrees.map((d: any) => d.type));
const long = "x".repeat(20000);
const r7 = readActions(`<action>{"type":"endeavor","set":{"plan":"${long}"}}</action>`);
ok("actions: over-long text is cut", (r7.actions[0] as any).set.plan.length === 8000);
const many = Array.from({ length: 12 }, (_, i) => `<action>{"type":"case","name":"C${i}","caseType":"NIW"}</action>`).join("");
ok("actions: at most eight per reply", readActions(many).actions.length === 8);

// 存文件的卡片指名了一个还没建的案件，而同一条回复里有一张「新建案件」正要建它：
// 不能因为那个案件还不存在，就把文件存进手头现有的另一个案件里
const att = { id: "f1", name: "media.md", type: "text/plain", size: 10 };
const oldCase = { id: "c1", name: "NIW - Jane Doe", type: "NIW" as const, createdAt: 1, done: [], files: [] };
const save = readActions(`<action>{"type":"saveFile","file":"media.md","case":"Battery NIW","title":"Media Coverage"}</action>`).actions[0];
const waiting = { profile: emptyProfile(), cases: [oldCase], attachments: [att], creating: ["Battery NIW"] };
ok("actions: a file card waits for the case its reply is about to create", /先应用/.test(describe(save, waiting).problem ?? "") && Boolean(apply(save, waiting).error), describe(save, waiting));
const made = apply({ type: "case", name: "Battery NIW", caseType: "NIW" } as any, waiting);
const after = { ...waiting, cases: made.cases! };
const stored = apply(save, after);
ok("actions: once that case exists the file goes into it, not the older case", !stored.error && (stored.cases!.find((c) => c.name === "Battery NIW")!.files ?? []).length === 1 && (stored.cases!.find((c) => c.id === "c1")!.files ?? []).length === 0, stored);
ok("actions: with no new case pending, the only existing case is still used", describe(save, { ...waiting, creating: [] }).problem === undefined && describe(save, { ...waiting, creating: [] }).rows.some((r) => r.value === "NIW - Jane Doe"));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
