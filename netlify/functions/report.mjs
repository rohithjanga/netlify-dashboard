// GET /api/reports/<name>  ->  the JSON report stored in S3, passed through unchanged.
//
// Why a function: the S3 bucket is private and must stay private. This function
// runs on Netlify's servers, holds a READ-ONLY key in Netlify environment
// variables, and returns only the objects named in REPORTS below — the browser
// never receives a credential and cannot ask for any other key in the bucket.
//
// Environment variables (Netlify UI → Site configuration → Environment variables,
// scope "Functions"):
//   DASHBOARD_S3_BUCKET              e.g. ishadp-…-us-east-1-an
//   DASHBOARD_S3_REGION              e.g. us-east-1
//   DASHBOARD_S3_ACCESS_KEY_ID       read-only IAM user (s3:GetObject on the keys below)
//   DASHBOARD_S3_SECRET_ACCESS_KEY
// Not named AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION on purpose:
// Netlify Functions run on AWS Lambda, which reserves those names for its own
// execution role, so Netlify does not let a site set them for functions.
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

// Report name (the part after /api/reports/) -> S3 key. An allow-list, not a
// prefix: adding a report is a reviewed one-line change here.
// Every page report lives under dashboards/registrations/, uploaded by
// data-analysis-scripts/FullAutomation/publish_dashboard_reports.sh (generated from
// knowledge/warehouse/exports/dataAnalyticsAutomation/). The read-only IAM key needs
// s3:GetObject on that prefix only.
const PREFIX = "dashboards/registrations/";
export const REPORTS = Object.fromEntries([
  "ieo-dashboard",
  "dash-programs",
  "app-dashboard",
  "dash-meditators",
  "dash-future-meditators",
  "dash-visits",
  "dash-msr",
].map((name) => [name, `${PREFIX}${name}.json`]));

function env(name) {
  // Netlify.env exists on Netlify; process.env covers `netlify dev` and tests.
  const v = (globalThis.Netlify?.env?.get(name)) ?? process.env[name];
  if (!v) throw new Error(`missing environment variable ${name}`);
  return v;
}

let client;
function s3() {
  client ??= new S3Client({
    region: env("DASHBOARD_S3_REGION"),
    credentials: {
      accessKeyId: env("DASHBOARD_S3_ACCESS_KEY_ID"),
      secretAccessKey: env("DASHBOARD_S3_SECRET_ACCESS_KEY"),
    },
  });
  return client;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default async (req, context) => {
  if (req.method !== "GET") return json(405, { error: "GET only" });
  const name = context.params?.name ?? new URL(req.url).pathname.split("/").pop();
  const key = Object.hasOwn(REPORTS, name) ? REPORTS[name] : null;
  if (!key) return json(404, { error: `unknown report ${JSON.stringify(name)}` });

  try {
    const obj = await s3().send(new GetObjectCommand({ Bucket: env("DASHBOARD_S3_BUCKET"), Key: key }));
    const body = await obj.Body.transformToString("utf-8");
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        // lets the page (and you) see which object and version was served
        "x-report-key": key,
        ...(obj.LastModified ? { "x-report-last-modified": obj.LastModified.toISOString() } : {}),
      },
    });
  } catch (err) {
    // Log the detail server-side; tell the browser only what it needs.
    console.error(`[report] ${name} -> s3://…/${key}: ${err.name}: ${err.message}`);
    if (err.name === "NoSuchKey") return json(404, { error: `${name} has not been published to S3 yet` });
    if (err.name === "AccessDenied") return json(502, { error: "the dashboard's S3 key cannot read this report" });
    if (String(err.message).startsWith("missing environment variable")) return json(500, { error: err.message });
    return json(502, { error: "could not read the report from S3" });
  }
};

export const config = { path: "/api/reports/:name" };
