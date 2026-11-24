import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:8100";
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const failed = [];
page.on("response", (r) => {
  if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
});
page.on("pageerror", (e) => failed.push(`js-error ${e.message}`));

// A static host with no rewrites: the directory URL is what a visitor's browser lands on.
const res = await page.goto(`${base}/app/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const editor = page.locator('textarea[aria-label="Note editor"]').first();
console.log(
  JSON.stringify(
    {
      status: res?.status(),
      title: await page.title(),
      editorVisible: await editor.isVisible(),
      failedRequests: failed,
    },
    null,
    1,
  ),
);
await browser.close();
