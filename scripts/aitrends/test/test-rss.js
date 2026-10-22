const fs = require("node:fs");
const path = require("node:path");
const { parseFeed } = require("../lib/rss");

let fail = 0;
let n = 0;
const check = (name, ok, extra) => {
  n++;
  if (!ok) {
    fail++;
    console.log("FAIL " + name + (extra ? " " + extra : ""));
  }
};

const FIX = path.join(__dirname, "fixtures");
const files = [
  "techcrunch-ai.xml", "verge-ai.xml", "crunchbase-news.xml", "openai-news.xml", "google-ai.xml", "robotreport.xml",
  "therecord.xml", "govuk-ai.atom", "takara-papers.xml", "inc42.xml", "gnews-funding.xml", "the-decoder.xml",
];
const RAW_ENTITY = /&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const counts = {};
for (const f of files) {
  const xml = fs.readFileSync(path.join(FIX, f), "utf8");
  const items = parseFeed(xml, { name: f, section_hint: "story", source_name: "Fixture" });
  counts[f] = items.length;
  check(f + " yields items", items.length > 0);
  check(f + " titles present", items.every((i) => i.title && i.title.trim() === i.title));
  check(f + " published is ISO", items.every((i) => ISO.test(i.published || "")), JSON.stringify(items.filter((i) => !ISO.test(i.published || "")).slice(0, 1)));
  check(f + " summaries have no tags", items.every((i) => !/<[a-z\/!][^>]*>/i.test(i.summary)));
  check(f + " summaries have no raw entities", items.every((i) => !RAW_ENTITY.test(i.summary)));
  check(f + " titles have no tags or entities", items.every((i) => !/<[a-z\/!][^>]*>/i.test(i.title) && !RAW_ENTITY.test(i.title)));
  check(f + " summary capped", items.every((i) => i.summary.length <= 1500));
  check(f + " links present", items.every((i) => /^https?:\/\//.test(i.link)));
  check(f + " ids unique sha1", new Set(items.map((i) => i.id)).size === items.length && items.every((i) => /^[0-9a-f]{40}$/.test(i.id)));
  check(f + " carries feed fields", items.every((i) => i.feed === f && i.section_hint === "story"));
}

// Atom: rel=alternate link, updated -> published.
{
  const items = parseFeed(fs.readFileSync(path.join(FIX, "govuk-ai.atom"), "utf8"), { name: "g", section_hint: "policy", source_name: "UK Gov" });
  check("atom link is the alternate href", items.every((i) => i.link.startsWith("https://www.gov.uk/")));
  check("atom keeps feed source_name", items.every((i) => i.source_name === "UK Gov"));
  check("atom first date", items[0].published === "2026-10-15T13:36:00.000Z", items[0].published);
}

// Google News: publisher suffix stripped, source_name = publisher.
{
  const items = parseFeed(fs.readFileSync(path.join(FIX, "gnews-funding.xml"), "utf8"), { name: "gn", section_hint: "money", source_name: "Google News" });
  const first = items[0];
  check("gnews title suffix stripped", first.title === "E-commerce AI startup Loops raises $3.5M to create smoother online shopping experiences", first.title);
  check("gnews source_name is publisher", first.source_name === "SiliconANGLE", first.source_name);
  check("gnews no title still ends with its publisher", items.every((i) => !i.title.endsWith(" - " + i.source_name)));
  check("gnews source_name never the feed default", items.every((i) => i.source_name !== "Google News"));
}

// Non-Google feed keeps the feed's source_name.
{
  const items = parseFeed(fs.readFileSync(path.join(FIX, "techcrunch-ai.xml"), "utf8"), { name: "t", section_hint: "money", source_name: "TechCrunch" });
  check("plain feed uses feed source_name", items.every((i) => i.source_name === "TechCrunch"));
}

// Synthetic: entities decoded before tags are stripped, items without titles skipped, bad dates null.
{
  const xml = `<rss><channel>
    <item><title>Good &amp; fine</title><link>https://x.test/a</link><pubDate>not a date</pubDate>
      <description>&lt;p&gt;Hello &lt;a href="https://x.test"&gt;world&lt;/a&gt; &amp;amp; more&lt;/p&gt;</description></item>
    <item><title></title><link>https://x.test/b</link></item>
    <item><title><![CDATA[CDATA <b>title</b>]]></title><link>https://x.test/c</link>
      <content:encoded><![CDATA[<p>Body &#8217;s text</p>]]></content:encoded></item>
  </channel></rss>`;
  const items = parseFeed(xml, { name: "s", section_hint: "story", source_name: "S" });
  check("synthetic: untitled skipped", items.length === 2);
  check("synthetic: entity title", items[0].title === "Good & fine", items[0].title);
  check("synthetic: unparseable date is null", items[0].published === null);
  check("synthetic: escaped html stripped", items[0].summary === "Hello world & more", items[0].summary);
  check("synthetic: cdata title stripped", items[1].title === "CDATA title", items[1].title);
  check("synthetic: content:encoded used", items[1].summary === "Body ’s text", items[1].summary);
  check("synthetic: id stable", items[0].id === parseFeed(xml, { name: "s" })[0].id);
}

console.log("items per fixture: " + JSON.stringify(counts));
console.log(fail === 0 ? `ALL PASS (${n} checks)` : `${fail} of ${n} FAILED`);
process.exit(fail === 0 ? 0 : 1);
