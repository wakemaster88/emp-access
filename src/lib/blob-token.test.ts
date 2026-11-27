import assert from "node:assert/strict";
import { test } from "node:test";
import { privateBlobToken } from "./blob-token";

test("Privater Blob-Token: nur BLOB_PRIVATE_READ_WRITE_TOKEN zählt", () => {
  assert.equal(privateBlobToken({ BLOB_PRIVATE_READ_WRITE_TOKEN: "vercel_blob_rw_privat" }), "vercel_blob_rw_privat");
  assert.equal(privateBlobToken({ BLOB_PRIVATE_READ_WRITE_TOKEN: "  vercel_blob_rw_privat \n" }), "vercel_blob_rw_privat");
  // Der öffentliche Audio-Speicher wird nie für private Dateien genommen.
  assert.equal(privateBlobToken({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_oeffentlich" }), undefined);
  assert.equal(privateBlobToken({ BLOB_PRIVATE_READ_WRITE_TOKEN: "", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_oeffentlich" }), undefined);
  assert.equal(privateBlobToken({ BLOB_PRIVATE_READ_WRITE_TOKEN: "   " }), undefined);
  assert.equal(privateBlobToken({}), undefined);
});
