// Minimal Apify client — runs an actor synchronously and returns its dataset
// items. Used for Facebook/Instagram discovery (Meta blocks direct scraping).
export const apifyConfigured = () => Boolean(process.env.APIFY_TOKEN);

export async function runActor(actorId, input, { timeoutSecs = 180 } = {}) {
  if (!apifyConfigured()) throw new Error("APIFY_TOKEN missing");
  const id = actorId.replace("/", "~");
  const url = `https://api.apify.com/v2/acts/${id}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=${timeoutSecs}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout((timeoutSecs + 20) * 1000),
  });
  if (!res.ok) throw new Error(`Apify ${actorId} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
