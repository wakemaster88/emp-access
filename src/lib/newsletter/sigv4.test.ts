import { test } from "node:test";
import assert from "node:assert/strict";
import { amzDate, awsUriEncode, signAwsRequest, signingKey } from "./sigv4";

// Beispiel aus der AWS-Dokumentation (IAM ListUsers, 30.08.2015). Stimmen
// Schlüssel und Signatur, stimmt der ganze Ablauf.
const EXAMPLE = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

test("signingKey: Schlüssel aus dem AWS-Beispiel", () => {
  assert.equal(
    signingKey(EXAMPLE.secretAccessKey, "20150830", "us-east-1", "iam").toString("hex"),
    "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9",
  );
});

test("signAwsRequest: Signatur aus dem AWS-Beispiel", () => {
  const headers = signAwsRequest({
    method: "GET",
    url: new URL("https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08"),
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    region: "us-east-1",
    service: "iam",
    credentials: EXAMPLE,
    now: new Date("2015-08-30T12:36:00Z"),
  });
  assert.equal(headers["x-amz-date"], "20150830T123600Z");
  assert.equal(headers.host, "iam.amazonaws.com");
  assert.equal(
    headers.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, " +
      "SignedHeaders=content-type;host;x-amz-date, " +
      "Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
  );
});

test("signAwsRequest: Sitzungstoken wird mitsigniert", () => {
  const headers = signAwsRequest({
    method: "POST",
    url: new URL("https://email.eu-central-1.amazonaws.com/v2/email/outbound-emails"),
    headers: { "content-type": "application/json" },
    body: "{}",
    region: "eu-central-1",
    service: "ses",
    credentials: { ...EXAMPLE, sessionToken: "TOKEN" },
    now: new Date("2026-11-27T10:00:00Z"),
  });
  assert.equal(headers["x-amz-security-token"], "TOKEN");
  assert.match(headers.authorization, /SignedHeaders=content-type;host;x-amz-date;x-amz-security-token,/);
  assert.match(headers.authorization, /Credential=AKIDEXAMPLE\/20261127\/eu-central-1\/ses\/aws4_request/);
});

test("awsUriEncode und amzDate", () => {
  assert.equal(awsUriEncode("a b!*'()@"), "a%20b%21%2A%27%28%29%40");
  assert.equal(amzDate(new Date("2026-01-02T03:04:05.678Z")), "20260102T030405Z");
});
