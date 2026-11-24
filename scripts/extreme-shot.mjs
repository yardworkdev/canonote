import { chromium } from "playwright";
import { mkdirSync, cpSync } from "node:fs";

const dirs = ["I-plate", "II-wax", "III-workbench"];
// Each variant references ./fonts — share one copy instead of duplicating files.
for (const d of dirs) {
  mkdirSync(`/tmp/extreme/${d}/fonts`, { recursive: true });
  cpSync("/tmp/extreme/fonts", `/tmp/extreme/${d}/fonts`, { recursive: true });
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
for (const d of dirs) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const failed = [];
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  await page.goto(`http://127.0.0.1:8105/${d}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/extreme/${d}.png` });
  const fonts = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
  );
  console.log(d, "| fonts:", [...new Set(fonts)].join(", "), "| failed:", failed.length ? failed : "none");
  await page.close();
}
await browser.close();
