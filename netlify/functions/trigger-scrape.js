// Netlify function: trigger the GitHub Actions scrape workflow.
// Requires GH_TOKEN (a GitHub PAT with actions:write) and ADMIN_PW env vars.
export async function handler(event) {
  if (event.httpMethod !== "POST") return resp(405, { error: "method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return resp(400, { error: "bad json" }); }

  if (!process.env.ADMIN_PW || body.secret !== process.env.ADMIN_PW)
    return resp(401, { error: "wrong password" });

  const token = process.env.GH_TOKEN;
  if (!token) return resp(500, { error: "GH_TOKEN not configured" });

  const res = await fetch(
    "https://api.github.com/repos/kesslernir-code/kessler-time/actions/workflows/scrape.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (res.status === 204) return resp(200, { ok: true, message: "Scraper started!" });
  const text = await res.text().catch(() => "");
  return resp(502, { error: `GitHub API ${res.status}`, detail: text.slice(0, 200) });
}

const resp = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});
