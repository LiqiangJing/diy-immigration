import { normalizeCases, normalizeConversations, normalizeDocs } from "@/lib/types";
import { normalizeProfile, profileToText, socReport, endeavorReport, notableReport, citationReport, reviewTotal } from "@/lib/profile";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -- " + JSON.stringify(detail)?.slice(0, 500))); };
const noThrow = (name: string, f: () => unknown) => { try { f(); ok(name, true); } catch (e) { ok(name, false, String(e)); } };

// ---------- 存档里的列表 ----------
const good = [{ id: "c1", name: "A", type: "NIW", createdAt: 1, done: [], files: [] }];
ok("cases: well-formed list is returned as is (same object)", normalizeCases(good) === good);
const messy = normalizeCases([null, 5, "x", { name: "no id" }, { id: "c2" }, { id: "c3", name: 7, type: "weird", done: "nope", files: [{ id: "f1" }, { id: "f2", name: "a.pdf", type: "application/pdf", size: 3 }] }]);
ok("cases: malformed entries are dropped or repaired", messy.length === 2 && messy[0].type === "NIW" && Array.isArray(messy[0].done) && messy[1].name === "7" && messy[1].files!.length === 1, messy);
ok("cases: not a list -> empty list", normalizeCases("garbage").length === 0 && normalizeCases(null).length === 0);
const docs = normalizeDocs([{ id: "d1" }, { id: "d2", title: "T", kind: "K", content: "C", chat: [{ id: "m", role: "user", text: "hi" }, { role: "user" }, { id: "x", role: "system", text: "no" }] }]);
ok("docs: missing fields filled, chat untouched when fine", docs.length === 2 && docs[0].content === "" && Array.isArray(docs[0].chat) && docs[1].chat.length === 3, docs);
const convs = normalizeConversations([{ id: "v1", title: "t", updatedAt: "12", messages: [{ id: "m1", role: "assistant" }, { id: "m2", role: "bot", text: "x" }, "junk"] }]);
ok("conversations: bad messages dropped, text filled", convs.length === 1 && convs[0].updatedAt === 12 && convs[0].messages.length === 1 && convs[0].messages[0].text === "", convs);

// ---------- 档案：各种残缺的存档都不能让页面出错 ----------
for (const [name, raw] of [
  ["empty", {}], ["nulls", { degrees: null, records: null, analyses: null, soc: null, endeavor: null, enrolled: "x", firstName: null, papers: 0, citations: 12, hIndex: 3 }],
  ["record without publications", { records: [{ source: "OpenAlex" }, null, 5] }],
  ["analysis without items", { analyses: [{ title: "T" }, { title: "U", items: [{ citingTitle: "C", category: "uses", importance: "high" }, { nope: 1 }] }, {}] }],
  ["soc with wrong types", { soc: { importance: 5, projects: [null, { title: "P" }], reviews: [{ venue: "J", count: 4 }, "x"], awards: ["a"] } }],
  ["endeavor with wrong types", { endeavor: { statement: 5, plan: null, extra: "x" } }],
] as const) {
  noThrow(`profile: ${name} -> every report builder runs`, () => {
    const p = normalizeProfile(raw as Record<string, unknown>);
    profileToText(p); profileToText(p, true); socReport(p); endeavorReport(p); notableReport(p); citationReport(p);
  });
}
const p = normalizeProfile({ firstName: "Jane", lastName: "Doe", soc: { awards: "Award A, 2024\nAward B, 2025", subareas: "One\nTwo", reviews: [{ id: "r1", venue: "Joule", count: "5+", invited: "yes" }, { id: "r2", venue: "", count: "9", invited: "" }, { id: "r3", venue: "Nature", count: "约 3 次", invited: "no" }], media: "", importance: "", projects: [], openSource: "", other: "" } });
const rep = socReport(p);
ok("soc report: produced when only awards and reviews are filled", rep.includes("Award A, 2024") && rep.includes("## III. Notable Accomplishments"), rep);
ok("soc report: one-per-line fields become list items", rep.includes("- Award A, 2024\n- Award B, 2025") && rep.includes("- One\n- Two"), rep);
ok("soc report: review total counts rows with a venue and reads '5+' as 5", reviewTotal(p.soc) === 8 && rep.includes("Peer review (8 reviews in total)"), [reviewTotal(p.soc), rep]);
ok("profile text: mentions the contributions even without projects", profileToText(p).includes("贡献总结") && profileToText(p).includes("审稿：共 8 次"), profileToText(p));
const e = normalizeProfile({ firstName: "Jane", lastName: "Doe", endeavor: { statement: "My proposed endeavor is to X.", plan: "Project 1: a\nProject 2: b\n\nResources: c", role: "", progress: "", waiver: "" }, soc: { importance: "Why it matters." } });
const er = endeavorReport(e);
ok("endeavor report: line breaks kept as hard breaks, paragraphs kept", er.includes("Project 1: a  \nProject 2: b\n\nResources: c") && er.includes("## Substantial Merit and National Importance\n\nWhy it matters."), er);
ok("profile text: brief endeavor by default, full text for NIW cases", profileToText(e).includes("完整内容在「我的档案」") && !profileToText(e).includes("Project 1") && profileToText(e, true).includes("Project 1: a") && profileToText(e, true).includes("【为什么重要"), profileToText(e, true));
const n = normalizeProfile({ analyses: [{ title: "My paper", year: 2024, total: 10, items: [
  { citingTitle: "C1", authors: "A. Author et al.", venue: "Conf", year: 2025, citations: 3, url: "https://doi.org/x", contexts: ["line one\nline two"], category: "uses", importance: "high" },
  { citingTitle: "C2", authors: "", venue: "", year: null, citations: 0, url: "", contexts: ["q"], category: "praise", importance: "high" }] }] });
const nr = notableReport(n);
ok("notable report: no doubled full stop, no leading full stop, quotes stay inside the block", nr.includes("A. Author et al. Conf. 2025. Cited by 3.") && !nr.includes("al..") && nr.includes("\nCited by 0.") && nr.includes("> line one line two"), nr);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
