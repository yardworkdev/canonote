import { chromium } from "playwright";
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:8099/app.html", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const create = page.getByRole("button", { name: /create note/i }).first();
if (await create.count()) await create.click().catch(() => {});
await page.waitForTimeout(600);
const ta = page.locator("textarea").first();
const info = await ta.evaluate((el) => {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const p = el.parentElement.getBoundingClientRect();
  return {
    cls: el.className,
    maxWidth: cs.maxWidth,
    marginLeft: cs.marginLeft,
    marginRight: cs.marginRight,
    box: { x: Math.round(r.x), w: Math.round(r.width) },
    parent: { x: Math.round(p.x), w: Math.round(p.width) },
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
