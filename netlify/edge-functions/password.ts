// Password-protects the whole site — the page AND /api/reports — with HTTP Basic
// auth over HTTPS.
//
// Why this exists: Netlify's built-in "Password protection" is a paid-plan
// feature, and without protection anyone with the URL could read the dashboard
// and its data. An edge function runs on the free plan.
//
// Environment variables (scope "Edge functions"):
//   DASHBOARD_USER       login name shown in the browser prompt
//   DASHBOARD_PASSWORD   a long random password, shared only with the team
// If DASHBOARD_PASSWORD is not set the site refuses every request (fails closed).
import type { Config, Context } from "@netlify/edge-functions";

function safeEqual(a: string, b: string): boolean {
  // constant-time comparison so the password cannot be guessed byte by byte
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export default async (request: Request, context: Context) => {
  const user = Netlify.env.get("DASHBOARD_USER") ?? "isha";
  const password = Netlify.env.get("DASHBOARD_PASSWORD");
  if (!password) {
    return new Response("Dashboard is not configured (DASHBOARD_PASSWORD unset).", { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try { decoded = atob(header.slice(6)); } catch { /* malformed header -> 401 */ }
    const i = decoded.indexOf(":");
    if (i > 0 && safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), password)) {
      return context.next();
    }
  }
  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Registrations dashboard", charset="UTF-8"' },
  });
};

export const config: Config = { path: "/*" };
