// Deploy the built site to Vercel as the account that owns the project.
//
// Why this exists: a Vercel Hobby project only promotes deployments authored by a
// team member, so a git push from any other account lands as "Deployment was
// blocked". A CLI deploy using the owner's token is authored by the owner, so it
// promotes. The token is read from the environment or from a file — never from the
// repository, and never printed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { secretPath } from "./lib/secrets.mjs";

const tokenFile = process.env.VERCEL_TOKEN_FILE ?? secretPath("vercel-token");
const token =
  process.env.VERCEL_TOKEN?.trim() ||
  (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "");

if (!token) {
  console.error(
    `No Vercel token. Set VERCEL_TOKEN, or write the token to ${tokenFile} with chmod 600.\n` +
      "Create one at https://vercel.com/account/tokens (scope: the team that owns the project).",
  );
  process.exit(1);
}

console.log("deploying to production…");
try {
  const out = execFileSync(
    "npx",
    ["--yes", "vercel@latest", "deploy", "--prod", "--yes", `--token=${token}`, "."],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const url = (out.match(/https:\/\/[^\s]+/g) ?? []).pop();
  console.log("deployed:", url ?? out.trim().split("\n").pop());
} catch (err) {
  const stderr = String(err.stderr ?? "").replaceAll(token, "«redacted»");
  const stdout = String(err.stdout ?? "").replaceAll(token, "«redacted»");
  console.error("deploy failed");
  if (stdout.trim()) console.error(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
  process.exit(1);
}
