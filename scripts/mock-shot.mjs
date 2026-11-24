import { chromium } from "playwright";
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
for (const [name, url] of [
  ["variant-a", "http://127.0.0.1:8103/a.html"],
  ["variant-b", "http://127.0.0.1:8103/b.html"],
]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const failed = [];
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `/tmp/mock/${name}.png` });
  console.log(name, failed.length ? failed : "ok");
  await page.close();
}
await browser.close();
