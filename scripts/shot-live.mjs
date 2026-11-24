import { chromium } from "playwright";
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
for (const [name, url] of [
  ["landing", "https://canonote.vercel.app/"],
  ["app", "https://canonote.vercel.app/app"],
]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch((e) => console.log(name, "nav", e.message));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/tmp/live/${name}.png` });
  const info = await page.evaluate(() => ({
    title: document.title,
    accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    accentStrong: getComputedStyle(document.documentElement).getPropertyValue("--accent-strong").trim(),
    h1: document.querySelector("h1")?.textContent.trim().slice(0, 60),
    h1Align: document.querySelector("h1") ? getComputedStyle(document.querySelector("h1")).textAlign : null,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
  console.log(name, JSON.stringify(info));
  await page.close();
}
await browser.close();
