import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {},
);
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL("docs/og.html").href, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "public/og.png" });
console.log("og.png written");
await browser.close();
