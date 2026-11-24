import { readFileSync } from "node:fs";
import { parseScholarHtml, scholarUserId } from "@/lib/server/scholar";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -- " + JSON.stringify(detail)?.slice(0, 400))); };

const html = readFileSync(process.argv[2], "utf8");
const r = parseScholarHtml(html)!;
ok("parse: name, totals and h-index", r.author.name === "Jane Doe" && r.author.papers === 4 && r.author.citations === 531 && r.author.hIndex === 3 && r.author.more === false, r.author);
ok("parse: sorted by citations", JSON.stringify(r.works.map((w) => w.citations)) === "[320,150,61,0]", r.works.map((w) => w.citations));
ok("parse: entities and inline tags decoded", r.works[0].title === "Early-cycle prediction of battery lifetime & degradation" && r.works[1].title === "BattLife: an open benchmark for battery degradation", r.works.map((w) => w.title));
ok("parse: venue without the trailing year; year read", r.works[0].venue === "Nature Energy 9 (3), 123-134" && r.works[0].year === 2024, r.works[0]);
ok("parse: enabled 'show more' button means the list is incomplete", parseScholarHtml(html.replace(" disabled>", ">"))!.author.more === true);
ok("parse: not a Scholar page -> null", parseScholarHtml("<html><body>hello</body></html>") === null);

// 特意构造的输入：都要很快返回，不能把服务器卡住
const cases: [string, string][] = [
  ["<tr repeated", "<tr".repeat(500000)],
  ["rows never closed", 'id="gsc_prf_in">X</div>' + 'class="gsc_a_tr"'.repeat(150000)],
  ["angle brackets", 'id="gsc_prf_in">X</div><tr class="gsc_a_tr">' + "<".repeat(2500000)],
  ["stats cells", 'id="gsc_prf_in">X</div>' + 'class="gsc_rsb_std"'.repeat(150000)],
  ["title links", 'id="gsc_prf_in">X</div>' + ('class="gsc_a_tr"' + 'class="gsc_a_at"'.repeat(400)).repeat(400)],
  ["gray divs", 'id="gsc_prf_in">X</div>' + ('class="gsc_a_tr">' + '<div class="gs_gray"'.repeat(350)).repeat(400)],
];
for (const [name, bad] of cases) {
  const t = Date.now();
  parseScholarHtml(bad);
  const ms = Date.now() - t;
  ok(`crafted input (${name}, ${bad.length} chars) handled in ${ms} ms`, ms < 2500, ms);
}
ok("link: accepted with or without https, any Google domain", scholarUserId("scholar.google.com/citations?user=JicYPdAAAAAJ&hl=en") === "JicYPdAAAAAJ" && scholarUserId("https://scholar.google.com.hk/citations?hl=zh-CN&user=JicYPdAAAAAJ") === "JicYPdAAAAAJ");
ok("link: other sites and non-links rejected", scholarUserId("https://evil.com/?user=JicYPdAAAAAJ") === null && scholarUserId("not a url") === null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
