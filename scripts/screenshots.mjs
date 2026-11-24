import { chromium } from "playwright";

const base = "http://127.0.0.1:8099";
const out = "docs/screenshots";

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {},
);
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

const note = `# Launch notes

The notebook stores markdown and nothing else: no HTML copy, no rich-text model, no conversion while you type.

## What changed this week

- Agent edits arrive as suggestions
- Nothing changes until a human accepts
- Export stays plain markdown

> The point is not that an agent can write. The point is that you can say no.
`;

await page.goto(`${base}/app.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /create note/i }).first().click();
await page.waitForTimeout(1200);
const body = page.locator("textarea").first();
await body.click();
await body.fill(note);
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/notebook.png` });
console.log("notebook.png");

await page.keyboard.press("Control+k");
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/command-palette.png` });
console.log("command-palette.png");
await page.keyboard.press("Escape");

await page.waitForTimeout(400);
const storage = page.getByText(/Stored in this browser/i).first();
if (await storage.count()) {
  await storage.click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/storage-panel.png` });
  console.log("storage-panel.png");
} else {
  console.log("storage control not found; left unchanged");
}

await page.goto(`${base}/index.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/landing.png` });
console.log("landing.png");

await browser.close();
