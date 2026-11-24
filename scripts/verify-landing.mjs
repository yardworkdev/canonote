import { chromium } from "playwright";

const base = "http://127.0.0.1:8099";
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(`${base}/index.html`, { waitUntil: "networkidle" });

const title = await page.title();
const h1 = (await page.locator("h1").first().innerText()).replace(/\s+/g, " ");
const cta = page.getByRole("link", { name: /open the notebook/i }).first();
const href = await cta.getAttribute("href");
const shotVisible = await page.locator("figure.shot img").isVisible();
const shotNatural = await page.locator("figure.shot img").evaluate((i) => i.naturalWidth);
const steps = await page.locator(".step").count();

console.log(JSON.stringify({ title, h1, href, shotVisible, shotNatural, steps }, null, 1));

// Follow the marketing path the way a visitor does: /app, not /app.html.
await page.goto(`${base}/app.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const editor = page.locator('textarea[aria-label="Note editor"]').first();
console.log("editor visible:", await editor.isVisible());

await browser.close();
