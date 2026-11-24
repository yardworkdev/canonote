import { chromium } from "playwright";

// "The text is in the center, make it start from the left side" (Ves, 2026-11-08).
// This measures where the reading column actually begins, so the answer is a
// number and not an opinion.
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const base = process.argv[2] || "http://127.0.0.1:8110";
for (const [name, path, sel] of [
  ["landing", "/", "h1"],
  ["demo", "/demo/", "h1"],
  ["app", "/app/", 'textarea[aria-label="Note editor"]'],
]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(base + path, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(800);
  const box = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const pane = el?.closest("main, .page, body, div");
    const r = el?.getBoundingClientRect();
    return r ? { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth } : null;
  }, sel);
  console.log(name, JSON.stringify(box), box ? `left margin = ${box.left}px of ${box.vw}` : "not found");
  await page.screenshot({ path: `/tmp/live/left-${name}.png` });
  await page.close();
}
await browser.close();
