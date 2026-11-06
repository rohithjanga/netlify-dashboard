# Registrations dashboard on Netlify

The dashboard page (`public/index.html`) is a static file. Tabs that have been moved to
the warehouse fetch their report JSON from `/api/reports/<name>`, a Netlify Function that
reads it from the private S3 bucket with a read-only key held in Netlify's environment
variables. An edge function password-protects the whole site, data included.

```
browser ──HTTPS + password──▶ Netlify
                               ├─ public/index.html            (static page)
                               └─ /api/reports/<name>          (function, server-side)
                                    └─ S3 GetObject (read-only key) ─▶ s3://<bucket>/<allow-listed key>
```

| File | Purpose |
|---|---|
| `netlify.toml` | Site config: publish `public/`, functions, security headers |
| `netlify/functions/report.mjs` | `/api/reports/<name>` → one allow-listed S3 object |
| `netlify/edge-functions/password.ts` | Basic-auth password on every path |
| `sync_page.py` | Copies the page in, empties its warehouse blocks, points them at `/api/reports/…` |
| `public/index.html` | The page as served (output of `sync_page.py`, committed) |
| `test/report.test.mjs` | Function tests with S3 stubbed (`npm test`) |
| `.env.example` | Variable names for local `netlify dev` |

## Which report comes from where

| `/api/reports/<name>` | S3 key | Written by |
|---|---|---|
| `ieo-dashboard`, `app-dashboard` | `reports/v1/latest/<name>.json` | the nightly export on ishadp |
| `dash-programs`, `dash-meditators`, `dash-future-meditators`, `dash-visits`, `dash-msr` | `dashboards/registrations/<name>.json` | uploaded by hand (below) until they join the nightly |

Today only the program tabs read through the loader. The IEO tab still uses its embedded
block, and the other tabs the hand export, until each is converted.

---

## One-time setup

### 1. AWS: a read-only key for the site (IT / AWS admin)

Create an IAM user (e.g. `netlify-dashboard-reader`) with an access key and only this policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "s3:GetObject",
    "Resource": [
      "arn:aws:s3:::<bucket>/reports/v1/latest/*",
      "arn:aws:s3:::<bucket>/dashboards/registrations/*"
    ]
  }]
}
```

No bucket CORS change is needed: the browser only talks to the Netlify site, and the
function calls S3 server-side. Do not reuse the exporter's `S3_ARCHIVE_*` key, which can
write.

### 2. Put the page reports in S3 (repeat whenever you want fresh numbers)

From `data-analysis-scripts/` (needs write access to the bucket):

```bash
source .venv/bin/activate
python3 -m tools.export --manifest-dir knowledge/warehouse/exports/dataAnalyticsAutomation --out /tmp/dash
aws s3 cp /tmp/dash/latest/ s3://<bucket>/dashboards/registrations/ \
    --recursive --exclude "*" --include "dash-*.json" --content-type application/json
```

### 3. Netlify: create the site

1. Sign in at https://app.netlify.com (an account in IT's team, so the site is not tied to one person).
2. **Add new site → Import an existing project → GitHub →** `ishausa/data-analysis-scripts`.
3. Build settings:
   - **Base directory:** `dashboard-site`
   - **Build command:** leave empty (netlify.toml supplies a no-op)
   - **Publish directory:** `dashboard-site/public`
   - **Functions directory:** `dashboard-site/netlify/functions`
4. **Deploy site.** The first deploy works but every request answers *503 not configured*
   until step 4 sets the password; this is deliberate (fails closed).

### 4. Netlify: environment variables

**Site configuration → Environment variables → Add a variable**, for each one below.
Tick **"Contains secret values"** for the secret ones; set the scopes shown.

| Variable | Value | Scopes |
|---|---|---|
| `DASHBOARD_S3_BUCKET` | the bucket name | Functions |
| `DASHBOARD_S3_REGION` | `us-east-1` | Functions |
| `DASHBOARD_S3_ACCESS_KEY_ID` | read-only key from step 1 | Functions (secret) |
| `DASHBOARD_S3_SECRET_ACCESS_KEY` | its secret | Functions (secret) |
| `DASHBOARD_USER` | login name, e.g. `isha` | Edge functions |
| `DASHBOARD_PASSWORD` | long random string (`openssl rand -base64 24`) | Edge functions (secret) |

**Why not `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`?** Netlify Functions
run on AWS Lambda, which reserves those names for its own role, so Netlify won't let a
site use them for functions. The function reads the `DASHBOARD_S3_*` names and passes them
to the S3 client explicitly.

Then **Deploys → Trigger deploy → Deploy site** so the variables take effect.

### 5. Check it

1. Open the site URL → the browser asks for the user / password from step 4.
2. Open a program tab: the first card reads *Source: warehouse · as of …* with the
   generation time of the file you uploaded in step 2.
3. Optional, from a terminal:
   ```bash
   curl -s -u isha:'<password>' https://<site>.netlify.app/api/reports/dash-programs \
     | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['provenance']['generatedAt'], list(d))"
   curl -s -o /dev/null -w '%{http_code}\n' https://<site>.netlify.app/        # 401 without the password
   ```
4. Problems show in **Logs → Functions → report** (S3 errors are logged there, never sent
   to the browser).

---

## Updating

| Change | Do |
|---|---|
| Fresh numbers for the page reports | Step 2 again. No redeploy: the page fetches on every load. |
| Page changed (a tab converted, layout) | `python3 sync_page.py ../../regitstrationNumbersHtmlTest/index-automation.html`, commit `public/index.html`, push. Netlify redeploys. |
| New report | Add one line to `REPORTS` in `netlify/functions/report.mjs`, add its key to the IAM policy, push. |
| Rotate the password or S3 key | Change the variable in Netlify, then **Trigger deploy**. |

## Local testing

```bash
cd dashboard-site
npm install
cp .env.example .env        # fill in; .env is git-ignored
npm test                    # function tests, S3 stubbed
npx netlify dev             # http://localhost:8888, real S3 via your .env
```

## Notes

- The page still embeds the hand-exported data for tabs not yet converted. It is served
  only behind the password; remove it tab by tab as each tab moves to the warehouse.
- Netlify's free-plan limits (function invocations, bandwidth) change over time; check
  the current plan page. This site makes one function call per report per page load.
- Netlify's built-in password protection is a paid feature; the edge function gives the
  same result on the free plan. If the team later wants per-person logins, Netlify's
  options or an identity provider can replace it without touching the function.
