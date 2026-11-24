import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:8101/notes-editor/";
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const failed = [];
page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
page.on("pageerror", (e) => failed.push(`js-error ${e.message}`));

await page.goto(base, { waitUntil: "networkidle" });
const cta = page.getByRole("link", { name: /open the notebook/i }).first();
console.log("cta href:", await cta.getAttribute("href"));
await cta.click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1200);
const editor = page.locator('textarea[aria-label="Note editor"]').first();
console.log(
  JSON.stringify(
    { landedOn: page.url(), editorVisible: await editor.isVisible(), failed },
    null,
    1,
  ),
);
await browser.close();
