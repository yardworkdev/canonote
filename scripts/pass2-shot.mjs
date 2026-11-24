import { chromium } from "playwright";
import { mkdirSync, cpSync } from "node:fs";

const dirs = ["IV-broadside", "V-console"];
for (const d of dirs) {
  mkdirSync(`/tmp/pass2/${d}/fonts`, { recursive: true });
  cpSync("/tmp/pass2/fonts", `/tmp/pass2/${d}/fonts`, { recursive: true });
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
for (const d of dirs) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2 });
  const failed = [];
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  await page.goto(`http://127.0.0.1:8106/${d}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  // Check the rule set mechanically instead of trusting the eye.
  const audit = await page.evaluate(() => {
    const radii = new Set();
    const gradients = [];
    [...document.querySelectorAll("*")].forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.borderTopLeftRadius && cs.borderTopLeftRadius !== "0px") radii.add(cs.borderTopLeftRadius);
      if ((cs.backgroundImage || "none") !== "none" && cs.backgroundImage.includes("gradient"))
        gradients.push(el.tagName + "." + (el.className || "").toString().slice(0, 24));
      if (cs.boxShadow && cs.boxShadow !== "none" && !cs.boxShadow.includes("rgb(0, 0, 0)"))
        gradients.push("coloured-shadow:" + el.tagName);
    });
    const families = new Set();
    [...document.querySelectorAll("*")].forEach((el) => {
      const f = getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "");
      families.add(f);
    });
    return { radii: [...radii], suspicious: gradients.slice(0, 6), families: [...families] };
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

  await page.screenshot({ path: `/tmp/pass2/${d}.png` });
  console.log(JSON.stringify({ dir: d, ...audit, hOverflow: overflow, failed: failed.slice(0, 3) }));
  await page.close();
}
await browser.close();
