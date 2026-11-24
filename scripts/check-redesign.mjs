// Visual check of the redesign: landing, the demo before/after accepting,
// and the notebook itself. Prints computed colours so the palette can be
// asserted without eyeballing a screenshot.
import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:8102";
const out = process.env.OUT ?? "/tmp/shots";
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);

const report = {};

// 1. landing
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failed = [];
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${out}/landing-new.png`, fullPage: false });
  report.landing = {
    title: await page.title(),
    accent: await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    ),
    primaryLabel: await page.locator(".btn-primary").first().innerText(),
    demoLink: await page.evaluate(
      () => [...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === "./demo"),
    ),
    failed,
  };
  await page.close();
}

// 2. demo: before, accept, after
{
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  await page.goto(base + "/demo/", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${out}/demo-before.png`, fullPage: true });
  const beforeText = await page.locator("#target").innerText();
  await page.getByRole("button", { name: "Accept" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/demo-after.png`, fullPage: true });
  report.demo = {
    beforeText,
    afterText: await page.locator("#target").innerText(),
    settled: await page.locator(".settled-line").innerText(),
    presence: await page.locator("#presence-text").innerText(),
    rawHasProposed: (await page.locator("#raw").innerText()).includes("until the pricing page is final"),
  };
  await page.close();
}

// 3. app: serif note surface + accent
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/app/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/app-new.png` });
  const ta = page.locator('textarea[aria-label="Note editor"]').first();
  report.app = {
    editorVisible: await ta.isVisible().catch(() => false),
    font: await ta.evaluate((el) => getComputedStyle(el).fontFamily).catch(() => null),
    size: await ta.evaluate((el) => getComputedStyle(el).fontSize).catch(() => null),
    accent400: await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent-400").trim(),
    ),
    errors,
  };
  await page.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 1));
