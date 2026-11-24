import { chromium } from "playwright";
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failed = [];
page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
await page.goto("http://127.0.0.1:8099/app.html", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const create = page.getByRole("button", { name: /create note/i }).first();
if (await create.count()) await create.click().catch(() => {});
await page.waitForTimeout(700);
const result = await page.evaluate(async () => {
  const ta = document.querySelector('textarea');
  const cs = ta ? getComputedStyle(ta) : null;
  await document.fonts.ready;
  return {
    family: cs?.fontFamily,
    size: cs?.fontSize,
    newsreaderLoaded: document.fonts.check('400 17px Newsreader'),
    instrumentLoaded: document.fonts.check('400 40px "Instrument Serif"'),
    loadedFaces: [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.style}`).slice(0, 10),
  };
});
console.log(JSON.stringify({ ...result, failed }, null, 1));
await browser.close();
