// 聊天助手能做的各种操作，以及应用之后的「撤销」。例子里的人和成果都是虚构的。
import { apply, describe, irreversible, placeOf, readActions, worldText } from "@/lib/actions";
import type { ChatAction, World } from "@/lib/actions";
import { diff, eq, revert } from "@/lib/undo";
import { fileIds } from "@/lib/sync";
import { emptyProfile, emptySoc } from "@/lib/profile";
import type { Profile } from "@/lib/profile";
import type { DocFile, ImmigrationCase } from "@/lib/types";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -- " + JSON.stringify(detail)?.slice(0, 700))); };
const act = (json: object) => {
  const r = readActions(`<action>${JSON.stringify(json)}</action>`);
  if (r.actions.length !== 1) throw new Error("not parsed: " + JSON.stringify(json));
  return r.actions[0];
};
const proj = (id: string, title = "", summary = "") => ({ id, title, start: "", end: "", outputs: "", funding: "", summary, impact: "" });
const profileWith = (patch: Partial<Profile>): Profile => ({ ...emptyProfile(), ...patch });
const world = (patch: Partial<World>): World => ({ profile: emptyProfile(), cases: [], docs: [], attachments: [], ...patch });
/** 应用一张卡片，返回新的数据和撤销要用的改动 */
function run(a: ChatAction, w: World) {
  const before = { profile: w.profile, cases: w.cases, docs: w.docs ?? [], conv: { title: w.conv?.title, caseId: w.conv?.caseId } };
  const r = apply(a, w);
  const after = { profile: r.profile ?? w.profile, cases: r.cases ?? w.cases, docs: r.docs ?? w.docs ?? [], conv: r.conv ?? before.conv };
  return { r, before, after, undo: diff(before, after) };
}

/* ---------- 项目按编号定位 ---------- */

// 用户在页面上点过「添加项目」，项目 1 还是空的；让助手「填项目 1」
const blankFirst = world({ profile: profileWith({ soc: { ...emptySoc(), projects: [proj("p1")] } }) });
const add = act({ type: "soc", addProjects: [{ title: "Sodium Battery Lifetime Model", summary: "I built a model.", outputs: "Paper A" }] });
const d1 = describe(add, blankFirst);
ok("projects: a new project is shown as going into the empty project 1", d1.rows.length === 1 && d1.rows[0].label.includes("空着的项目 1"), d1.rows);
const r1 = run(add, blankFirst);
ok("projects: adding a project fills the empty slot instead of creating project 2", r1.after.profile.soc.projects.length === 1 && r1.after.profile.soc.projects[0].id === "p1" && r1.after.profile.soc.projects[0].title === "Sodium Battery Lifetime Model", r1.after.profile.soc.projects);
const back1 = revert(r1.after, r1.undo);
ok("undo: the filled slot is empty again and still there", back1.left.length === 0 && eq(back1.state.profile.soc.projects, [proj("p1")]), back1.state.profile.soc.projects);

const two = world({ profile: profileWith({ soc: { ...emptySoc(), awards: "Best Paper 2025", projects: [proj("p1"), proj("p2", "Sodium Battery Lifetime Model", "Old summary.")] } }) });
ok("projects: with no empty slot left, a new project is appended and numbered", describe(add, { ...two, profile: profileWith({ soc: { ...emptySoc(), projects: [proj("p2", "X", "y")] } }) }).rows[0].label.includes("会成为项目 2"));
for (const m of ["项目 1", "项目1", "Project 1", "project #1", "第 1 个项目", "1", "未命名"]) {
  const u = act({ type: "soc", updateProjects: [{ match: m, set: { summary: "New." } }] });
  const out = run(u, two).after.profile.soc.projects;
  ok(`projects: "${m}" means the first project even though it has no title`, out[0].summary === "New." && out[1].summary === "Old summary.", out);
}
const byTitle = run(act({ type: "soc", updateProjects: [{ match: "sodium battery lifetime model", set: { funding: "NSF 123" } }] }), two).after.profile.soc.projects;
ok("projects: a title still finds its project", byTitle[1].funding === "NSF 123" && byTitle[0].funding === "");
const numbered = describe(act({ type: "soc", updateProjects: [{ match: "项目 2", set: { summary: "S" } }] }), two);
ok("projects: the card names the project by number and title, and shows what it replaces", numbered.rows[0].label.startsWith("项目 2「Sodium Battery Lifetime Model」") && numbered.rows[0].old === "Old summary.", numbered.rows);
const missing = act({ type: "soc", updateProjects: [{ match: "项目 5", set: { summary: "S" } }] });
ok("projects: a number that does not exist is refused", /没有找到项目/.test(describe(missing, two).problem ?? "") && Boolean(apply(missing, two).error));
ok("projects: a title such as 'Project 3D Printing' is not read as a number", describe(act({ type: "soc", updateProjects: [{ match: "Project 3D Printing", set: { summary: "S" } }] }), two).problem !== undefined);

// 填错了地方：内容进了项目 2，应该在项目 1 —— 一张卡片里搬过去并删掉多出来的
const fix = act({ type: "soc", updateProjects: [{ match: "项目 1", set: { title: "Sodium Battery Lifetime Model", summary: "Old summary." } }], removeProjects: ["项目 2"] });
const dFix = describe(fix, two);
ok("projects: the fix-up card shows the removal as a deletion", dFix.rows.some((r) => r.danger && r.label.startsWith("删除项目 2")) && !dFix.problem, dFix.rows);
const rFix = run(fix, two);
ok("projects: content moved into project 1 and the stray project removed", rFix.after.profile.soc.projects.length === 1 && rFix.after.profile.soc.projects[0].id === "p1" && rFix.after.profile.soc.projects[0].summary === "Old summary.", rFix.after.profile.soc.projects);
const backFix = revert(rFix.after, rFix.undo);
ok("undo: both projects are back as they were, in the same order", backFix.left.length === 0 && eq(backFix.state.profile.soc.projects, two.profile.soc.projects), backFix.state.profile.soc.projects);

/* ---------- 清空 ---------- */

const clear = act({ type: "soc", clear: ["awards", "media"], updateProjects: [{ match: "项目 2", clear: ["summary", "funding"] }] });
const dClear = describe(clear, two);
ok("clear: only fields that have content are listed, marked as deletions", dClear.rows.length === 2 && dClear.rows.every((r) => r.danger) && dClear.rows[0].value === "Best Paper 2025", dClear.rows);
const rClear = run(clear, two);
ok("clear: the fields are emptied", rClear.after.profile.soc.awards === "" && rClear.after.profile.soc.projects[1].summary === "" && rClear.after.profile.soc.projects[1].title !== "");
ok("undo: cleared text comes back", eq(revert(rClear.after, rClear.undo).state.profile.soc, two.profile.soc));
ok("clear: nothing to clear is reported instead of an empty card", /不需要再改/.test(describe(act({ type: "soc", clear: ["media"] }), two).problem ?? ""));
const wipe = run(act({ type: "soc", clear: ["projects", "reviews"] }), { ...two, profile: profileWith({ soc: { ...two.profile.soc, reviews: [{ id: "r1", venue: "ACL", count: "3", invited: "yes" }] } }) });
ok("clear: all projects and review records can be removed at once", wipe.after.profile.soc.projects.length === 0 && wipe.after.profile.soc.reviews.length === 0);
const rv = world({ profile: profileWith({ soc: { ...emptySoc(), reviews: [{ id: "r1", venue: "ACL 2024", count: "3", invited: "yes" }, { id: "r2", venue: "Nature Energy", count: "1", invited: "" }] } }) });
const swap = run(act({ type: "soc", removeReviews: ["acl 2024"], addReviews: [{ venue: "ACL 2024", count: "5", invited: "yes" }] }), rv);
ok("reviews: a record is replaced by removing and adding", swap.after.profile.soc.reviews.length === 2 && swap.after.profile.soc.reviews.some((r) => r.venue === "ACL 2024" && r.count === "5") && swap.after.profile.soc.reviews[0].id === "r2", swap.after.profile.soc.reviews);
ok("reviews: an unknown venue is refused", Boolean(apply(act({ type: "soc", removeReviews: ["ICML"] }), rv).error));

const en = world({ profile: profileWith({ endeavor: { statement: "S", plan: "P", role: "", progress: "", waiver: "W" } }) });
const rEn = run(act({ type: "endeavor", clear: ["waiver", "role"], append: { plan: "More" } }), en);
ok("endeavor: clear and append in one card", rEn.after.profile.endeavor.waiver === "" && rEn.after.profile.endeavor.plan === "P\nMore" && rEn.after.profile.endeavor.statement === "S");
ok("undo: endeavor restored", eq(revert(rEn.after, rEn.undo).state.profile.endeavor, en.profile.endeavor));

/* ---------- 基本资料 ---------- */

const deg = (id: string, type: string, major: string, university: string, year: string) => ({ id, type, major, university, year, related: "" as const });
const bas = world({
  profile: profileWith({
    firstName: "Jane", field: "Energy Storage", papers: "30", citations: "900", hIndex: "15", primarySource: "Semantic Scholar",
    degrees: [deg("d1", "学士（Bachelor）", "Physics", "Example University", "2015"), deg("d2", "博士（PhD）", "Materials Science", "Sample Institute", "2021")],
    enrolled: deg("e1", "硕士（Master）", "Statistics", "Example University", "2027"),
  }),
});
const editDeg = run(act({ type: "profile", updateDegrees: [{ match: "学位 2", set: { year: "2022", related: "yes" } }], removeDegrees: ["Example University"], clear: ["enrolled", "field"], set: { lastName: "Doe" } }), bas);
ok("profile: a degree is edited by number, another removed by its school, fields cleared", editDeg.after.profile.degrees.length === 1 && editDeg.after.profile.degrees[0].id === "d2" && editDeg.after.profile.degrees[0].year === "2022" && editDeg.after.profile.degrees[0].related === "yes" && editDeg.after.profile.enrolled === null && editDeg.after.profile.field === "" && editDeg.after.profile.lastName === "Doe", editDeg.after.profile);
const backDeg = revert(editDeg.after, editDeg.undo).state.profile;
ok("undo: degrees, enrolled degree and cleared field are all back", eq(backDeg.degrees, bas.profile.degrees) && eq(backDeg.enrolled, bas.profile.enrolled) && backDeg.field === "Energy Storage" && backDeg.lastName === "");
const nums = run(act({ type: "profile", set: { citations: "1000" } }), bas);
ok("profile: editing a number by hand detaches the numbers from their data source", nums.after.profile.citations === "1000" && nums.after.profile.primarySource === "");
ok("undo: the number and its source are restored together", revert(nums.after, nums.undo).state.profile.primarySource === "Semantic Scholar" && revert(nums.after, nums.undo).state.profile.citations === "900");
ok("profile: unknown fields in clear are dropped", readActions(`<action>{"type":"profile","clear":["credits","email","records"]}</action>`).actions.length === 0);

/* ---------- 案件 ---------- */

const file = (id: string, name: string) => ({ id, name, type: "application/pdf", size: 10 });
const niw: ImmigrationCase = { id: "c1", name: "NIW - Jane Doe", type: "NIW", createdAt: 1, done: ["cv"], files: [file("f1", "Award Letter.pdf"), file("f2", "CV.pdf")] };
const eb1: ImmigrationCase = { id: "c2", name: "EB-1A Plan", type: "EB-1A", createdAt: 2, done: [], files: [], claims: ["judging"] };
const doc = (id: string, title: string, caseId: string, content = "Text"): DocFile => ({ id, title, kind: "其他文档", content, updatedAt: 5, chat: [{ id: "m1", role: "user", text: "", attachments: [file("a1", "note.pdf")] }], caseId });
const cw = world({ cases: [niw, eb1], docs: [doc("d1", "Cover Letter", "c1"), doc("d2", "Personal Statement", "c2")], conv: { id: "v1", title: "聊聊 NIW" }, convs: [{ id: "v2", title: "EB-1A 的问题" }], linkedCaseId: null });

const edit = run(act({ type: "caseEdit", case: "EB-1A Plan", rename: "EB-1A - Jane Doe", addClaims: ["awards", "学术文章"], removeClaims: ["judging"], check: ["cv", "eb1-awards"] }), cw);
const edited = edit.after.cases.find((c) => c.id === "c2")!;
ok("case: rename, criteria (by id or by name) and checklist ticks in one card", edited.name === "EB-1A - Jane Doe" && eq(edited.claims, ["awards", "articles"]) && eq(edited.done, ["cv", "eb1-awards"]), edited);
ok("undo: the case is as before", eq(revert(edit.after, edit.undo).state.cases, cw.cases));
ok("case: EB-1A criteria cannot be put on an NIW case", Boolean(apply(act({ type: "caseEdit", case: "NIW - Jane Doe", addClaims: ["awards"] }), cw).error));
ok("case: NIW criteria need the exceptional-ability route", Boolean(apply(act({ type: "caseEdit", case: "NIW - Jane Doe", addClaims: ["x-degree"] }), cw).error) && !apply(act({ type: "caseEdit", case: "NIW - Jane Doe", eb2: "exceptional", addClaims: ["x-degree"] }), cw).error);
ok("case: a checklist item of the other case type is refused", Boolean(apply(act({ type: "caseEdit", case: "NIW - Jane Doe", check: ["eb1-final"] }), cw).error));
ok("case: unticking shows as a removal", describe(act({ type: "caseEdit", case: "NIW - Jane Doe", uncheck: ["cv"] }), cw).rows.some((r) => r.danger && r.value.includes("简历")));

const del = act({ type: "caseDelete", case: "NIW - Jane Doe" });
const dDel = describe(del, cw);
ok("case: deletion is flagged as irreversible and says what goes with it", dDel.danger === true && irreversible(del) && dDel.rows.some((r) => r.value === "1 份文档、2 个文件") && dDel.button === "确认删除", dDel);
const rDel = apply(del, cw);
ok("case: deleting takes its documents and reports every file to release", rDel.final === true && rDel.cases!.length === 1 && rDel.docs!.length === 1 && eq([...rDel.release!].sort(), ["a1", "f1", "f2"]), rDel);
ok("case: a delete with no name, or a name that matches nothing, does nothing", readActions(`<action>{"type":"caseDelete"}</action>`).actions.length === 0 && Boolean(apply(act({ type: "caseDelete", case: "Other" }), cw).error));
ok("case: with only one case, an unmatched name still must not delete it", Boolean(apply(act({ type: "caseDelete", case: "Old draft" }), { ...cw, cases: [niw] }).error));

const ren = run(act({ type: "caseFile", case: "NIW - Jane Doe", file: "award letter.pdf", rename: "Award - Example Society, 2024" }), cw);
ok("file: rename keeps the extension", ren.after.cases[0].files![0].name === "Award - Example Society, 2024.pdf" && ren.after.cases[0].files![0].id === "f1");
ok("undo: file name restored", revert(ren.after, ren.undo).state.cases[0].files![0].name === "Award Letter.pdf");
const rm = apply(act({ type: "caseFile", case: "NIW - Jane Doe", file: "CV.pdf", remove: true }), cw);
ok("file: removal releases the file and cannot be undone", rm.final === true && eq(rm.release, ["f2"]) && rm.cases![0].files!.length === 1);
ok("file: an unknown file is refused", Boolean(apply(act({ type: "caseFile", case: "NIW - Jane Doe", file: "passport.pdf", remove: true }), cw).error));

// 存文件之后撤销：案件里那份文件要报出来，调用方才能把文件内容也清掉
const up = { ...cw, attachments: [file("u1", "media.pdf")] };
const sv = run(act({ type: "saveFile", file: "media.pdf", case: "NIW - Jane Doe", title: "Media Coverage - Example Daily, 2025" }), up);
const backSv = revert(sv.after, sv.undo);
ok("undo: a saved file leaves the case and is reported for cleanup", backSv.state.cases[0].files!.length === 2 && backSv.removed.length === 1 && backSv.removed[0].path.includes("files") && (backSv.removed[0].item as { id: string }).id === sv.r.copy!.to, backSv.removed);

/* ---------- 文档 ---------- */

const mk = run(act({ type: "doc", case: "NIW - Jane Doe", title: "Personal Statement Draft", kind: "其他文档", content: "# Statement\n\nText." }), cw);
ok("doc: created in the named case with the given text", mk.after.docs.length === 3 && mk.after.docs[0].caseId === "c1" && mk.after.docs[0].content.startsWith("# Statement") && mk.r.place?.view === "cases" && (mk.r.place as { docId?: string }).docId === mk.after.docs[0].id);
ok("undo: an untouched new document is removed", revert(mk.after, mk.undo).state.docs.length === 2);
const touched = { ...mk.after, docs: mk.after.docs.map((d, i) => (i === 0 ? { ...d, content: d.content + " More." } : d)) };
const keep = revert(touched, mk.undo);
ok("undo: a new document the user has since edited is left alone", keep.state.docs.length === 3 && keep.left.length === 1);
ok("doc: an unknown kind falls back to a generic one", (act({ type: "doc", case: "X", kind: "Anything", content: "t" }) as { kind: string }).kind === "其他文档");
ok("doc: generating from an empty profile section is refused", /还没有内容/.test(describe(act({ type: "doc", case: "NIW - Jane Doe", from: "soc" }), cw).problem ?? ""));
const gen = apply(act({ type: "doc", case: "NIW - Jane Doe", from: "soc" }), { ...cw, profile: profileWith({ firstName: "Jane", lastName: "Doe", soc: { ...emptySoc(), importance: "Grid storage matters." } }) });
ok("doc: generated from the profile, with the standard title and kind", !gen.error && gen.docs![0].kind === "Summary of Contributions" && gen.docs![0].title === "Summary of Contributions" && gen.docs![0].content.includes("Grid storage matters."), gen.error);
const rn = run(act({ type: "docEdit", doc: "cover letter", rename: "Cover Letter v2" }), cw);
ok("doc: rename", rn.after.docs[0].title === "Cover Letter v2" && revert(rn.after, rn.undo).state.docs[0].title === "Cover Letter");
const dd = apply(act({ type: "docEdit", doc: "Cover Letter", remove: true }), cw);
ok("doc: deletion releases the attachments of its chat and is final", dd.final === true && dd.docs!.length === 1 && eq(dd.release, ["a1"]));

/* ---------- 会话 ---------- */

const rnm = run(act({ type: "chat", op: "rename", title: "NIW 准备" }), cw);
ok("chat: rename the current conversation, and undo it", rnm.r.conv?.title === "NIW 准备" && revert(rnm.after, rnm.undo).state.conv.title === "聊聊 NIW");
const lnk = run(act({ type: "chat", op: "link", case: "EB-1A Plan" }), cw);
ok("chat: link to a case, and undo it", lnk.r.conv?.caseId === "c2" && revert(lnk.after, lnk.undo).state.conv.caseId === undefined, lnk.r);
ok("chat: unlink", apply(act({ type: "chat", op: "link", case: "" }), { ...cw, conv: { id: "v1", title: "t", caseId: "c1" } }).conv?.caseId === undefined && !apply(act({ type: "chat", op: "link" }), { ...cw, conv: { id: "v1", title: "t", caseId: "c1" } }).error);
const nw = apply(act({ type: "chat", op: "new", title: "EB-1A 评估", case: "EB-1A Plan" }), cw);
ok("chat: a new conversation carries its title and case", eq(nw.effect, { newChat: { title: "EB-1A 评估", caseId: "c2" } }) && nw.final === true);
ok("chat: another conversation can be deleted by title", eq(apply(act({ type: "chat", op: "delete", match: "EB-1A 的问题" }), cw).effect, { deleteChat: "v2" }));
ok("chat: the current conversation cannot delete itself", /不能在这个会话里删除它自己/.test(describe(act({ type: "chat", op: "delete", match: "聊聊 NIW" }), cw).problem ?? ""));
ok("chat: rename without a title, or delete without a target, is not an action", readActions(`<action>{"type":"chat","op":"rename"}</action><action>{"type":"chat","op":"delete"}</action><action>{"type":"chat","op":"wipe"}</action>`).actions.length === 0);

/* ---------- 带用户去某一页 ---------- */

const goScholar = act({ type: "go", to: "profile.scholar" });
ok("go: profile tab", eq(placeOf(goScholar, cw), { view: "profile", tab: "scholar" }) && describe(goScholar, cw).title === "打开「我的档案 · 学术记录与引用」");
ok("go: a case page needs to know which case", eq(placeOf(act({ type: "go", to: "case.pack", case: "EB-1A Plan" }), cw), { view: "cases", caseId: "c2", tab: "pack" }) && Boolean(describe(act({ type: "go", to: "case.pack" }), cw).problem));
ok("go: a document opens inside its case", eq(placeOf(act({ type: "go", to: "doc", doc: "Personal Statement" }), cw), { view: "cases", caseId: "c2", tab: "docs", docId: "d2" }));
ok("go: unknown pages are dropped", readActions(`<action>{"type":"go","to":"admin"}</action>`).actions.length === 0);

/* ---------- 撤销的规则 ---------- */

// 应用之后用户自己又改了其中一处：撤销时那一处不动，其余的改回去
const multi = run(act({ type: "soc", set: { importance: "New importance." }, append: { awards: "Second Award" } }), two);
const edited2 = { ...multi.after, profile: { ...multi.after.profile, soc: { ...multi.after.profile.soc, importance: "User rewrote this." } } };
const part = revert(edited2, multi.undo);
ok("undo: a field the user changed afterwards is kept, the rest is reverted", part.left.length === 1 && part.state.profile.soc.importance === "User rewrote this." && part.state.profile.soc.awards === "Best Paper 2025", part);
// 两张卡片叠在一起：先加项目，再改它。先撤销第一张不行，先撤销第二张再撤销第一张可以
const empty = world({});
const c1 = run(add, empty);
const w2 = { ...empty, profile: c1.after.profile };
const c2 = run(act({ type: "soc", updateProjects: [{ match: "项目 1", set: { summary: "Rewritten." } }] }), w2);
ok("undo: an added project that a later card changed is not removed", revert(c2.after, c1.undo).left.length === 1 && revert(c2.after, c1.undo).state.profile.soc.projects.length === 1);
const step = revert(c2.after, c2.undo);
ok("undo: undoing the later card first, then the earlier one, restores the start", step.left.length === 0 && revert(step.state, c1.undo).state.profile.soc.projects.length === 0);
ok("undo: undoing twice changes nothing more", eq(revert(revert(c1.after, c1.undo).state, c1.undo).state.profile.soc.projects, []));
ok("undo: the modification time is not treated as content", diff({ a: 1, updatedAt: 1 }, { a: 1, updatedAt: 2 }).length === 0 && eq({ a: 1, updatedAt: 1 }, { a: 1, updatedAt: 9 }));
ok("undo: untouched parts of the profile are not recorded", multi.undo.every((c) => c.path[0] === "profile" && c.path[1] === "soc") && multi.undo.length === 2, multi.undo);
ok("undo: survives being stored as JSON", eq(revert(JSON.parse(JSON.stringify(rFix.after)), JSON.parse(JSON.stringify(rFix.undo))).state.profile.soc.projects, two.profile.soc.projects));

/* ---------- 兼容以前存下来的卡片；给模型看的现状 ---------- */

const legacy = { type: "soc", set: { importance: "Old card." }, append: {}, addProjects: [], updateProjects: [{ match: "Sodium Battery Lifetime Model", set: { funding: "F" } }], addReviews: [] } as unknown as ChatAction;
ok("compat: a card stored before these fields existed still shows and applies", describe(legacy, two).rows.length === 2 && apply(legacy, two).profile!.soc.projects[1].funding === "F");
const legacyProfile = { type: "profile", set: { firstName: "Jane" }, addDegrees: [] } as unknown as ChatAction;
ok("compat: same for an old profile card", apply(legacyProfile, two).profile!.firstName === "Jane");

const text = worldText({ ...cw, profile: two.profile, linkedCaseId: "c1" });
ok("state: projects are listed by number, the empty one is called out", text.includes("项目 1：整个是空的") && text.includes("项目 2：「Sodium Battery Lifetime Model」") && text.includes("还空着：开始时间"), text);
ok("state: cases list their documents, files, criteria and ticks; conversations are listed", text.includes("「Cover Letter」") && text.includes("Award Letter.pdf") && text.includes("主张的标准：judging") && text.includes("清单已勾：cv") && text.includes("这个会话关联的就是它") && text.includes("现在这个会话的标题：「聊聊 NIW」") && text.includes("「EB-1A 的问题」"), text);

// 撤销记录里留着「当时存进案件的那个文件」的信息：文件之后被删掉时，不能因为这条记录就以为它还在用
ok("files: an undo record does not count as a reference to a file", eq(fileIds([{ id: "m", actions: [{ id: "x", undo: sv.undo }] }]), []) && fileIds(sv.after.cases).includes(sv.r.copy!.to), fileIds([{ undo: sv.undo }]));

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
