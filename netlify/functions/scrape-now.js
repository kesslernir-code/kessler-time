// Triggered by the admin page right after a place is added, so its events show
// within ~2 minutes instead of waiting for the next scheduled scrape.
// Password-checked; holds the GitHub token server-side (Netlify env var).
export async function handler(event) {
  if (event.httpMethod !== "POST") return resp(405, { error: "method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return resp(400, { error: "bad json" }); }

  if (!process.env.ADMIN_PW || body.secret !== process.env.ADMIN_PW) {
    return resp(401, { error: "wrong password" });
  }

  const repo = process.env.GH_REPO; // e.g. kesslernir-code/kessler-time
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/scrape.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kessler-time",
    },
    body: JSON.stringify({ ref: "main" }),
  });

  if (res.status === 204) return resp(200, { ok: true });
  return resp(502, { error: "dispatch failed", status: res.status, detail: (await res.text()).slice(0, 200) });
}

const resp = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});
