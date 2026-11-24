import { chromium } from "playwright";
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: Number(process.env.SHOT_H || 900) }, deviceScaleFactor: 2 });
await page.goto(process.argv[2], { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: process.argv[3] });
const hues = await page.evaluate(() => {
  const set = new Set();
  [...document.body.querySelectorAll("*")].forEach((el) => {
    const c = getComputedStyle(el);
    [c.color, c.backgroundColor, c.borderLeftColor].forEach((v) => {
      const m = (v || "").match(/rgba?\((\d+), (\d+), (\d+)/);
      if (m) set.add(`${m[1]},${m[2]},${m[3]}`);
    });
  });
  return [...set].filter((v) => {
    const [r, g, b] = v.split(",").map(Number);
    return Math.max(r, g, b) - Math.min(r, g, b) > 6; // any chroma at all
  });
});
console.log("chromatic colours left:", hues);
await browser.close();
