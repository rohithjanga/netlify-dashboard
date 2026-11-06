// Unit tests for the report function. S3 is stubbed — no network, no credentials.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { S3Client } from "@aws-sdk/client-s3";

process.env.DASHBOARD_S3_BUCKET = "test-bucket";
process.env.DASHBOARD_S3_REGION = "us-east-1";
process.env.DASHBOARD_S3_ACCESS_KEY_ID = "AKIATEST";
process.env.DASHBOARD_S3_SECRET_ACCESS_KEY = "secret";

let lastCommand, nextResult;
S3Client.prototype.send = async function (cmd) {
  lastCommand = cmd.input;
  if (nextResult instanceof Error) throw nextResult;
  return nextResult;
};
const { default: handler, REPORTS } = await import("../netlify/functions/report.mjs");
const call = (name, method = "GET") =>
  handler(new Request(`https://site.test/api/reports/${name}`, { method }), { params: { name } });

beforeEach(() => { lastCommand = undefined; nextResult = undefined; });

test("serves an allow-listed report from its S3 key, unchanged", async () => {
  const body = '{"provenance":{"generatedAt":"2026-11-05T00:00:00Z"},"programs":[]}';
  nextResult = { Body: { transformToString: async () => body }, LastModified: new Date("2026-11-05T05:00:00Z") };
  const res = await call("dash-programs");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), body);
  assert.deepEqual(lastCommand, { Bucket: "test-bucket", Key: REPORTS["dash-programs"] });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("refuses names outside the allow-list without touching S3", async () => {
  for (const name of ["../secrets", "reports%2Fv1%2Flatest%2Fmanifest", "constructor", "toString", ""]) {
    const res = await call(name);
    assert.equal(res.status, 404, name);
    assert.equal(lastCommand, undefined, name);
  }
});

test("only GET", async () => {
  assert.equal((await call("dash-programs", "POST")).status, 405);
});

test("missing object -> 404 with a plain message, no S3 detail", async () => {
  nextResult = Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey" });
  const res = await call("dash-msr");
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /not been published/);
});

test("access denied -> 502 that does not leak the bucket or key id", async () => {
  nextResult = Object.assign(new Error("User arn:aws:iam::1:user/x is not authorized on test-bucket"), { name: "AccessDenied" });
  const res = await call("ieo-dashboard");
  const text = await res.text();
  assert.equal(res.status, 502);
  assert.doesNotMatch(text, /test-bucket|arn:aws|AKIA/);
});
