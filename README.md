# Registrations dashboard on Netlify

The dashboard page (`public/index.html`) is a static file with **no data embedded**. Every
tab fetches its report JSON from `/api/reports/<name>`, a Netlify Function that reads it from
the private S3 bucket with a read-only key held in Netlify's environment variables. An edge
function password-protects the whole site, data included.

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
| `sync_page.py` | Copies the page in, empties its report blocks, points them at `/api/reports/…`; refuses a page that still embeds data |
| `public/index.html` | The page as served (output of `sync_page.py`, committed) |
| `test/report.test.mjs` | Function tests with S3 stubbed (`npm test`) |
| `.env.example` | Variable names for local `netlify dev` |

## Which report comes from where

Every report is `s3://<bucket>/dashboards/registrations/<name>.json`, uploaded by
`data-analysis-scripts/FullAutomation/publish_dashboard_reports.sh` (step 2).

| Tab(s) | `/api/reports/<name>` | Report definition (`data-analysis-scripts/knowledge/warehouse/exports/dataAnalyticsAutomation/`) |
|---|---|---|
| IEO | `ieo-dashboard` | `ieo_dashboard.yml` |
| 11 program tabs (IE City … Ishanga) | `dash-programs` | `dash_programs.yml` |
| Visitors section of iiis / IYCLA | `dash-visits` | `dash_visits.yml` |
| Sadhguru App, Miracle of Mind App | `app-dashboard` | `app_dashboard.yml` |
| Meditators | `dash-meditators` | `dash_meditators.yml` |
| Future Meditators | `dash-future-meditators` | `dash_future_meditators.yml` |
| MSR analytics | `dash-msr` | `dash_msr.yml` |
| Website - IE, Website - IEO | — | none yet: Google Analytics is not in the warehouse; the tabs show "coming soon" |

Until a report is uploaded, its tab shows "… could not be loaded — has not been published
to S3 yet" instead of numbers.

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
    "Resource": "arn:aws:s3:::<bucket>/dashboards/registrations/*"
  }]
}
```

No bucket CORS change is needed: the browser only talks to the Netlify site, and the
function calls S3 server-side. Do not reuse the exporter's `S3_ARCHIVE_*` key, which can
write.

### 2. Put the page reports in S3 (repeat whenever you want fresh numbers)

From the `data-analysis-scripts` repo (uses its `.venv`, `.env` warehouse access and the
S3 write key `S3_ARCHIVE_*`):

```bash
cd ~/Documents/Isha/CodeRepository/data-analysis-scripts
export DASHBOARD_S3_BUCKET=<bucket>
FullAutomation/publish_dashboard_reports.sh            # generate all 7 reports + DRY RUN of the upload
FullAutomation/publish_dashboard_reports.sh --upload   # generate + upload for real
```

It refuses to generate anything if last night's dbt run failed or is stale, and keeps a
copy of what it uploaded in `FullAutomation/reports/s3_upload_<date>/` (git-ignored).

### 3. Netlify: create the site

1. Sign in at https://app.netlify.com (an account in IT's team, so the site is not tied to one person).
2. **Add new site → Import an existing project → GitHub →** `rohithjanga/netlify-dashboard`.
3. Build settings:
   - **Base directory:** leave empty (this repo is the site)
   - **Build command:** leave empty (netlify.toml supplies a no-op)
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
   - Node version comes from `netlify.toml` (`NODE_VERSION = "22"`); nothing to set.
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
2. Click through every tab: each one's first card reads *Source: warehouse · …* with the
   generation time of the file you uploaded in step 2 (the Website tabs say "coming soon").
   The header's "Warehouse data generated" shows the newest of those times.
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
| Page changed (a tab converted, layout) | `python3 sync_page.py ../regitstrationNumbersHtmlTest/index-automation.html`, commit `public/index.html`, push. Netlify redeploys. |
| New report | Add its name to `REPORTS` in `netlify/functions/report.mjs` (served from `dashboards/registrations/`), add its block to the page's `REPORT_BLOCKS`, re-sync, push. |
| Rotate the password or S3 key | Change the variable in Netlify, then **Trigger deploy**. |

## Local testing

**Use Node 22** (`.nvmrc`). Node 25 and later removed `buffer.SlowBuffer`, which a library
inside netlify-cli still uses, so `npm install` / `netlify dev` fail there with
`Cannot read properties of undefined (reading 'prototype')`. Netlify runs this site on 22 too.

```bash
brew install node@22                                  # once; keg-only, leaves your default Node alone
export PATH="$(brew --prefix node@22)/bin:$PATH"      # this terminal only
node --version                                        # v22.x

cd netlify-dashboard
rm -rf node_modules                                   # clear the failed install
npm install
cp .env.example .env        # fill in; .env is git-ignored
npm test                    # function tests, S3 stubbed
npx netlify dev             # http://localhost:8888, real S3 via your .env
```

## Notes

- No data is embedded in the page; `sync_page.py` refuses to produce one that embeds any.
  The page source is `regitstrationNumbersHtmlTest/index-automation.html`; for a standalone
  `file://` check, `update_page_data.py` there can fill a COPY with reports — never sync that copy.
- Netlify's free-plan limits (function invocations, bandwidth) change over time; check
  the current plan page. This site makes one function call per report per page load.
- Netlify's built-in password protection is a paid feature; the edge function gives the
  same result on the free plan. If the team later wants per-person logins, Netlify's
  options or an identity provider can replace it without touching the function.
