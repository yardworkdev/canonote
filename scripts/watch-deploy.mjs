// Trigger a Vercel deploy hook, then wait for production to actually change.
// Usage: DEPLOY_HOOK_URL='https://api.vercel.com/v1/integrations/deploy/...' node scripts/watch-deploy.mjs
// Optional: SITE_URL (default https://notes-editor-two.vercel.app), EXPECT (default "canonote"),
//           TIMEOUT_MIN (default 10).

const hook = process.env.DEPLOY_HOOK_URL;
const site = process.env.SITE_URL ?? "https://notes-editor-two.vercel.app/";
const expect = process.env.EXPECT ?? "canonote";
const timeoutMin = Number(process.env.TIMEOUT_MIN ?? 10);

async function titleOf(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "canonote-deploy-watch" } });
  const html = await res.text();
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return { status: res.status, title: m ? m[1].trim() : "" };
}

if (hook) {
  const res = await fetch(hook, { method: "POST" });
  console.log("hook responded:", res.status, (await res.text()).slice(0, 200));
} else {
  console.log("no DEPLOY_HOOK_URL set — watching the live site only");
}

const before = await titleOf(site);
console.log("now:", before.status, JSON.stringify(before.title));

const deadline = Date.now() + timeoutMin * 60_000;
let last = before.title;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 15_000));
  const now = await titleOf(site);
  if (now.title !== last) {
    console.log("changed:", JSON.stringify(now.title));
    last = now.title;
  }
  if (now.title.toLowerCase().includes(expect.toLowerCase())) {
    console.log("LIVE:", JSON.stringify(now.title), "after", Math.round((Date.now() - (deadline - timeoutMin * 60_000)) / 1000), "s");
    process.exit(0);
  }
}
console.log("still serving:", JSON.stringify(last), "— deploy did not reach production within", timeoutMin, "min");
process.exit(1);
