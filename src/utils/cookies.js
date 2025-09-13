/**
 * Parse cookies input.
 * Accepts JSON array of cookies, JSON object with {cookies:[...]}, or raw Cookie header string.
 * Why: FB requires proper domain scoping; users often paste header strings.
 */
export function parseCookiesInput(input, urlForDomain = "https://www.facebook.com/") {
  if (!input || typeof input !== "string") return [];
  const trimmed = input.trim();

  // Try JSON first
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return normalizeCookieArray(parsed, urlForDomain);
    if (parsed && Array.isArray(parsed.cookies)) return normalizeCookieArray(parsed.cookies, urlForDomain);
  } catch (_) {
    // raw header fallback
  }

  // Cookie header string: "key=value; key2=value2"
  const out = [];
  for (const pair of trimmed.split(/;\s*/)) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name) continue;
    out.push({ name, value, domain: extractDomain(urlForDomain), path: "/" });
  }
  return out;
}

function normalizeCookieArray(arr, urlForDomain) {
  const domain = extractDomain(urlForDomain);
  return arr
    .filter((c) => c && c.name && typeof c.value === "string")
    .map((c) => ({
      name: String(c.name),
      value: String(c.value),
      domain: c.domain || domain,
      path: c.path || "/",
      httpOnly: !!c.httpOnly,
      secure: c.secure !== false,
      sameSite: c.sameSite || "Lax",
      expires: c.expires || undefined
    }));
}

function extractDomain(u) {
  try {
    const { hostname } = new URL(u || "https://www.facebook.com/");
    return hostname.startsWith(".") ? hostname : `.${hostname}`;
  } catch {
    return ".facebook.com";
  }
}