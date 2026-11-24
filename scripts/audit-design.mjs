/**
 * Design audit — checks a rendered page against the constraints in DESIGN-RULES.md v2.
 *
 * Every check is a deterministic read of computed styles, because the failure mode this
 * guards against (the unnamed default) is invisible to the eye of the model that produced
 * it. Prints a pass/fail table plus measurements, and exits non-zero on any failure.
 *
 *   node scripts/audit-design.mjs <url> [screenshot-path]
 */
import { chromium } from "playwright";

const url = process.argv[2];
const shot = process.argv[3];
if (!url) {
  console.error("usage: node scripts/audit-design.mjs <url> [screenshot.png]");
  process.exit(2);
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const failed = [];
page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText} ${r.url()}`));
page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));

await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

const report = await page.evaluate(() => {
  const els = [...document.body.querySelectorAll("*")];
  const cs = (el) => getComputedStyle(el);
  const out = {};

  // 1 · corner radius above 2px (tell 19, 21)
  out.radiusHits = els
    .map((el) => [el.tagName + "." + String(el.className || "").slice(0, 30), cs(el).borderTopLeftRadius])
    .filter(([, r]) => r && r !== "0px" && parseFloat(r) > 2)
    .map(([n, r]) => `${n} → ${r}`);

  // 2 · gradients, any (tell 01, 02, 06)
  out.gradientHits = els
    .filter((el) => (cs(el).backgroundImage || "none") !== "none")
    .map((el) => el.tagName + "." + String(el.className || "").slice(0, 30));

  // 3 · shadows of any kind (tell 20)
  out.shadowHits = els
    .filter((el) => {
      const s = cs(el).boxShadow;
      return s && s !== "none";
    })
    .map((el) => el.tagName + "." + String(el.className || "").slice(0, 30));

  // 4 · coloured left rule used as a marker (tell 17)
  out.leftRuleHits = els
    .filter((el) => {
      const c = cs(el);
      if (parseFloat(c.borderLeftWidth) <= 2) return false;
      return c.borderLeftColor !== c.borderTopColor || c.borderTopWidth === "0px";
    })
    .map((el) => `${el.tagName}.${String(el.className || "").slice(0, 24)} ${cs(el).borderLeftWidth} ${cs(el).borderLeftColor}`);

  // 5 · faces in use, and whether each is loaded from a file we ship
  out.families = [...new Set(els.map((el) => cs(el).fontFamily.split(",")[0].replace(/["']/g, "")))];
  out.loadedFaces = [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`);

  // 6 · uppercase runs (tell 28, 10)
  out.upperHits = els
    .filter((el) => cs(el).textTransform === "uppercase" && el.textContent.trim().length > 2)
    .map((el) => el.textContent.trim().slice(0, 40));

  // 7 · centred blocks (tell 02, 83)
  const blocks = [...document.querySelectorAll("main > *, main p, main h1, header, footer")];
  out.centred = blocks.filter((el) => cs(el).textAlign === "center").length + " / " + blocks.length;

  // 8 · colour inventory: every value, so an accidental palette shows up
  const colours = new Set();
  els.forEach((el) => {
    const c = cs(el);
    [c.color, c.backgroundColor, c.borderTopColor].forEach((v) => {
      if (v && v !== "rgba(0, 0, 0, 0)" && v !== "transparent") colours.add(v);
    });
  });
  out.colours = [...colours].sort();

  // 9 · density: the document's share of the viewport (DESIGN-RULES v1 rule 6)
  const doc =
    document.querySelector(".document") ||
    document.querySelector(".col") ||
    document.querySelector("main > *") ||
    document.querySelector("h1")?.parentElement;
  out.density = doc ? +(doc.getBoundingClientRect().width / window.innerWidth).toFixed(3) : null;

  // 10 · contrast of every text colour against the surface behind it
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const ratio = (a, b) => {
    const [l1, l2] = [lum(parse(a).slice(0, 3)), lum(parse(b).slice(0, 3))].sort((x, y) => y - x);
    return +((l1 + 0.05) / (l2 + 0.05)).toFixed(2);
  };
  // Screen-reader-only text is not read through the eyes, so its contrast is not a
  // defect: .sr-only, clip-path tricks, and 1px clipped boxes are skipped here.
  const visuallyHidden = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return (
      s.clip === "rect(0px, 0px, 0px, 0px)" ||
      s.clipPath === "inset(50%)" ||
      s.position === "absolute" && r.width <= 1 && r.height <= 1
    );
  };

  out.contrast = els
    .filter((el) => el.children.length === 0 && el.textContent.trim().length > 3)
    .filter((el) => !visuallyHidden(el))
    .map((el) => {
      let bg = "rgba(0, 0, 0, 0)";
      let node = el;
      while (node && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
        bg = cs(node).backgroundColor;
        node = node.parentElement;
      }
      const r = ratio(cs(el).color, bg === "rgba(0, 0, 0, 0)" ? "rgb(255,255,255)" : bg);
      return { text: el.textContent.trim().slice(0, 34), size: parseFloat(cs(el).fontSize), ratio: r };
    })
    .filter((t) => t.ratio < 4.5);

  // 11 · optical alignment: the proposal should start level with the paragraph it edits
  const p2 = document.querySelectorAll(".document p")[1];
  const who = document.querySelector(".margin .who");
  out.alignment = p2 && who ? +(who.getBoundingClientRect().top - p2.getBoundingClientRect().top).toFixed(1) : null;

  return out;
});

if (shot) await page.screenshot({ path: shot });
await browser.close();

const checks = [
  ["no radius over 2px", report.radiusHits.length === 0, report.radiusHits],
  ["no gradients", report.gradientHits.length === 0, report.gradientHits],
  ["no shadows", report.shadowHits.length === 0, report.shadowHits],
  ["no coloured left rule", report.leftRuleHits.length === 0, report.leftRuleHits],
  ["no uppercase runs", report.upperHits.length === 0, report.upperHits],
  ["nothing centred", report.centred.startsWith("0 "), report.centred],
  ["contrast ≥ 4.5 everywhere", report.contrast.length === 0, report.contrast],
  ["document ≥ 33% of width", report.density >= 0.3, report.density],
  ["faces loaded", report.loadedFaces.length > 0, report.loadedFaces],
  ["no failed requests", failed.length === 0, failed],
];

const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
let bad = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${pad(name, 30)} ${JSON.stringify(detail)}`);
}
console.log("\nfamilies :", report.families.join(" | "));
console.log("colours  :", report.colours.join(" "));
console.log("align Δ  :", report.alignment, "px (proposal vs its paragraph; 0–6 is right)");
console.log(bad === 0 ? "\nclean" : `\n${bad} check(s) failed`);
process.exit(bad === 0 ? 0 : 1);
