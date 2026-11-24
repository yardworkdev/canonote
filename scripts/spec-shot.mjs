import { chromium } from "playwright";
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 });
const failed = [];
page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
await page.goto("http://127.0.0.1:8104/", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/spec/specimens.png", fullPage: true });
const loaded = await page.evaluate(() =>
  ["Inter Tight", "Archivo", "Bricolage Grotesque", "Space Grotesk"].map((f) => [f, document.fonts.check(`400 16px "${f}"`)]),
);
console.log(JSON.stringify({ loaded, failed }, null, 1));
await browser.close();
