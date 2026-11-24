import { hashOf, merge3, mergeKey, same } from "@/lib/sync";
import { emptyProfile, normalizeProfile } from "@/lib/profile";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -- " + JSON.stringify(detail)?.slice(0, 400))); };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// ---------- same ----------
ok("same: key order ignored", same({ a: 1, b: [1, { x: 2 }] }, { b: [1, { x: 2 }], a: 1 }));
ok("same: undefined field equals missing", same({ a: 1, b: undefined }, { a: 1 }));
ok("same: array order matters", !same([1, 2], [2, 1]));

// ---------- 案件：两台设备改了同一个案件的不同地方 ----------
const base = [{ id: "c1", name: "Case", type: "NIW", createdAt: 1, done: [] as string[], files: [{ id: "f1", name: "cv.pdf", type: "application/pdf", size: 1 }] }, { id: "c2", name: "Other", type: "EB-1A", createdAt: 2, done: ["cv"], files: [] }];
let local = clone(base); let server = clone(base);
(local[0] as any).eb2 = "advanced";                                   // 这台：选了申报条件
server[0].done = ["cv"]; server[0].files.push({ id: "f2", name: "award.pdf", type: "application/pdf", size: 2 });   // 另一台：勾了清单、传了文件
let m = mergeKey("cases", base, local, server) as any[];
ok("cases: both devices' edits to one case are kept", m[0].eb2 === "advanced" && same(m[0].done, ["cv"]) && m[0].files.length === 2, m[0]);
ok("cases: untouched case unchanged", same(m[1], base[1]));

// 一边删、另一边没动 → 删；一边删、另一边改过 → 留
local = clone(base).filter((c) => c.id !== "c2"); server = clone(base);
m = mergeKey("cases", base, local, server) as any[];
ok("cases: deleted here, untouched there -> stays deleted", m.length === 1 && m[0].id === "c1", m.map((c) => c.id));
server = clone(base); server[1].done = ["cv", "i140"];
m = mergeKey("cases", base, local, server) as any[];
ok("cases: deleted here but edited there -> kept (edit wins)", m.length === 2 && same(m.find((c) => c.id === "c2").done, ["cv", "i140"]), m);
local = clone(base); server = clone(base).filter((c) => c.id !== "c1");
m = mergeKey("cases", base, local, server) as any[];
ok("cases: deleted there, untouched here -> removed here too", m.length === 1 && m[0].id === "c2", m.map((c) => c.id));
// 两边各新建一个
local = [{ id: "n1", name: "New here", type: "NIW", createdAt: 9, done: [], files: [] }, ...clone(base)]; server = [{ id: "n2", name: "New there", type: "NIW", createdAt: 8, done: [], files: [] }, ...clone(base)];
m = mergeKey("cases", base, local, server) as any[];
ok("cases: cases created on both sides are both kept, new ones first", m.length === 4 && m[0].id === "n2" && m[1].id === "n1", m.map((c) => c.id));
// 清单：这边取消一个、那边新勾一个
const b2 = [{ id: "c1", done: ["a", "b"] }]; 
m = mergeKey("cases", b2, [{ id: "c1", done: ["a"] }], [{ id: "c1", done: ["a", "b", "c"] }]) as any[];
ok("cases: checklist merges as a set (untick here + tick there)", same(m[0].done, ["a", "c"]), m[0].done);
// 打包设置里的对象
m = mergeKey("cases", [{ id: "c1", pack: { order: [], skip: [], titles: { f1: "CV" }, roles: {} } }], [{ id: "c1", pack: { order: [], skip: ["f2"], titles: { f1: "Curriculum Vitae" }, roles: {} } }], [{ id: "c1", pack: { order: [], skip: [], titles: { f1: "CV", f2: "Award" }, roles: { f2: "body" } } }]) as any[];
ok("cases: pack settings merge field by field", same(m[0].pack, { order: [], skip: ["f2"], titles: { f1: "Curriculum Vitae", f2: "Award" }, roles: { f2: "body" } }), m[0].pack);

// ---------- 档案 ----------
const pb = normalizeProfile({ firstName: "Jane", lastName: "Doe", field: "X", updatedAt: 10, degrees: [{ id: "d1", type: "博士（PhD）", major: "M", university: "U", year: "2022", related: "yes" }], soc: { importance: "old" } });
const pl = clone(pb); pl.field = "Field set here"; pl.updatedAt = 30; pl.soc.importance = "edited here";
const ps = clone(pb); ps.chineseName = "中文名"; ps.updatedAt = 20; ps.endeavor.statement = "S"; ps.degrees.push({ id: "d2", type: "硕士（Master）", major: "N", university: "V", year: "2018", related: "no" });
let mp = mergeKey("profile", pb, pl, ps) as any;
ok("profile: fields edited on two devices are both kept", mp.field === "Field set here" && mp.chineseName === "中文名" && mp.soc.importance === "edited here" && mp.endeavor.statement === "S" && mp.degrees.length === 2 && mp.updatedAt === 30, { field: mp.field, cn: mp.chineseName });
const ps2 = clone(pb); ps2.field = "Field set there";
mp = mergeKey("profile", pb, pl, ps2) as any;
ok("profile: same field changed on both -> this device wins", mp.field === "Field set here");
// 学术记录按来源合并；引用分析按标题
const pr = normalizeProfile({ ...pb, records: [{ source: "Semantic Scholar", url: "", name: "J", papers: "4", citations: "9", hIndex: "2", publications: [], fetchedAt: 1 }] });
const prl = clone(pr); prl.records.push({ source: "OpenAlex", url: "", name: "J", papers: "5", citations: "11", hIndex: "2", publications: [], fetchedAt: 2 });
const prs = clone(pr); prs.records[0].citations = "10"; prs.analyses.push({ title: "T", year: 2024, paperUrl: "", analyzedAt: 1, total: 1, selfCitations: 0, withContext: 1, analyzed: 1, items: [] });
mp = mergeKey("profile", pr, prl, prs) as any;
ok("profile: scholar records merge by source, analyses kept", mp.records.length === 2 && mp.records[0].citations === "10" && mp.analyses.length === 1, mp.records);

// 新设备上只敲了名字就登录（没有对照基准）：服务器上的完整档案不能被冲掉
const fresh = normalizeProfile({ firstName: "Jane", updatedAt: 99 });
const full = normalizeProfile({ firstName: "Jane", lastName: "Doe", field: "Battery", updatedAt: 50, degrees: [{ id: "d1", type: "x", major: "m", university: "u", year: "y", related: "yes" }], soc: { importance: "imp", projects: [{ id: "p1", title: "P", start: "", end: "", outputs: "", funding: "", summary: "s", impact: "" }] }, records: [{ source: "OpenAlex", url: "", name: "", papers: "1", citations: "2", hIndex: "1", publications: [{ title: "A", year: 1, venue: "", citations: 2 }], fetchedAt: 3 }], papers: "1", citations: "2", hIndex: "1", primarySource: "OpenAlex" });
mp = mergeKey("profile", undefined, fresh, full) as any;
ok("profile(no base): a nearly empty local profile does not wipe the server's", mp.lastName === "Doe" && mp.field === "Battery" && mp.degrees.length === 1 && mp.soc.projects.length === 1 && mp.records.length === 1 && mp.citations === "2", mp);
mp = mergeKey("profile", undefined, normalizeProfile({ firstName: "Janet", updatedAt: 99 }), full) as any;
ok("profile(no base): what was typed on this device is kept", mp.firstName === "Janet" && mp.lastName === "Doe");
ok("profile: empty server leaves local alone", mergeKey("profile", undefined, fresh, null) === fresh);

// ---------- 文档 ----------
const db0 = [{ id: "d1", title: "PL", kind: "Petition Letter", content: "base text", updatedAt: 10, chat: [{ id: "m1", role: "user", text: "hi" }] }];
let dl = clone(db0); dl[0].title = "Petition Letter of Jane"; dl[0].updatedAt = 30;
let ds = clone(db0); ds[0].content = "text written on the other device"; ds[0].updatedAt = 20; ds[0].chat.push({ id: "m2", role: "assistant", text: "ok" });
let md = mergeKey("docs", db0, dl, ds) as any[];
ok("docs: title changed here + content changed there -> both kept, no copy", md.length === 1 && md[0].title === "Petition Letter of Jane" && md[0].content === "text written on the other device" && md[0].chat.length === 2, md);
dl = clone(db0); dl[0].content = "edited here"; ds = clone(db0); ds[0].content = "edited there";
md = mergeKey("docs", db0, dl, ds) as any[];
ok("docs: content changed on both -> this device's stays, the other is saved as a copy", md.length === 2 && md[0].content === "edited here" && md[1].content === "edited there" && md[1].title.includes("另一台设备上的版本") && md[1].id !== "d1", md.map((d) => [d.id, d.title]));
const again = mergeKey("docs", db0, md, ds) as any[];
ok("docs: merging the same conflict twice does not duplicate the copy", again.length === 2, again.map((d) => d.id));
// 没有基准：按修改时间新的为准，不生成副本
md = mergeKey("docs", undefined, [{ id: "d1", title: "T", content: "old local", updatedAt: 5, chat: [] }, { id: "d2", title: "Only here", content: "x", updatedAt: 6, chat: [] }], [{ id: "d1", title: "T", content: "newer server", updatedAt: 9, chat: [] }, { id: "d3", title: "Only there", content: "y", updatedAt: 7, chat: [] }]) as any[];
ok("docs(no base): newer copy of the same doc wins, others unioned, no junk copies", md.length === 3 && md.find((d) => d.id === "d1").content === "newer server" && md.some((d) => d.id === "d2") && md.some((d) => d.id === "d3"), md.map((d) => [d.id, d.content]));
md = mergeKey("docs", undefined, [{ id: "d1", title: "T", content: "newer local", updatedAt: 9, chat: [] }], [{ id: "d1", title: "T", content: "old server", updatedAt: 5, chat: [] }]) as any[];
ok("docs(no base): newer local copy wins", md.length === 1 && md[0].content === "newer local");

// ---------- 会话：两边各发了消息 ----------
const cb = [{ id: "v1", title: "t", updatedAt: 1, messages: [{ id: "a", role: "user", text: "q" }] }];
const cl = clone(cb); cl[0].messages.push({ id: "b", role: "assistant", text: "streaming…" });
const cs = clone(cb); cs[0].messages.push({ id: "c", role: "user", text: "from other device" });
const mc = mergeKey("conversations", cb, cl, cs) as any[];
ok("conversations: messages from both devices kept in order (local then theirs)", same(mc[0].messages.map((x: any) => x.id), ["a", "b", "c"]), mc[0].messages);

// ---------- 不变时返回原对象（不触发多余的重新渲染） ----------
const st = clone(base);
ok("identity: nothing to merge returns the local object itself", mergeKey("cases", base, st, clone(base)) === st);
ok("identity: only the server changed returns the server's", (() => { const sv = clone(base); sv[0].name = "Renamed"; return mergeKey("cases", base, st, sv) === sv; })());

// ---------- 指纹 ----------
ok("hash: differs on any change, stable otherwise", hashOf("abc") === hashOf("abc") && hashOf("abc") !== hashOf("abd") && hashOf("") !== hashOf(" "));
const big = JSON.stringify({ x: "y".repeat(3_000_000) }); const t0 = Date.now(); hashOf(big); console.log("  hash 3 MB:", Date.now() - t0, "ms");
const lots = Array.from({ length: 400 }, (_, i) => ({ id: "m" + i, role: "user", text: "x".repeat(4000) }));
const t1 = Date.now(); mergeKey("conversations", [{ id: "v", messages: lots }], [{ id: "v", messages: [...lots, { id: "new1", role: "user", text: "a" }] }], [{ id: "v", messages: [...lots, { id: "new2", role: "user", text: "b" }] }]); console.log("  merge 1.6 MB conversation:", Date.now() - t1, "ms");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
