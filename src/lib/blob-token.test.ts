import assert from "node:assert/strict";
import { test } from "node:test";
import { privateBlobAuthFrom, privateBlobConfigured, publicBlobToken } from "./blob-token";

test("Privater Blob-Speicher: Token mit Präfix BLOB_PRIVATE", () => {
  assert.deepEqual(privateBlobAuthFrom({ BLOB_PRIVATE_READ_WRITE_TOKEN: "vercel_blob_rw_privat" }, undefined), { token: "vercel_blob_rw_privat" });
  assert.deepEqual(privateBlobAuthFrom({ BLOB_PRIVATE_READ_WRITE_TOKEN: "  vercel_blob_rw_privat \n" }, undefined), { token: "vercel_blob_rw_privat" });
  // Token geht vor der OIDC-Anbindung.
  assert.deepEqual(
    privateBlobAuthFrom({ BLOB_PRIVATE_READ_WRITE_TOKEN: "vercel_blob_rw_privat", BLOB_PRIVATE_STORE_ID: "store_privat" }, "oidc"),
    { token: "vercel_blob_rw_privat" },
  );
});

test("Privater Blob-Speicher: OIDC nur mit Token der Anfrage, Store-ID nie allein", () => {
  assert.deepEqual(privateBlobAuthFrom({ BLOB_PRIVATE_STORE_ID: " store_privat " }, " oidc "), { storeId: "store_privat", oidcToken: "oidc" });
  // Ohne OIDC-Token fiele @vercel/blob auf den öffentlichen Speicher zurück.
  assert.equal(privateBlobAuthFrom({ BLOB_PRIVATE_STORE_ID: "store_privat" }, undefined), undefined);
  assert.equal(privateBlobAuthFrom({ BLOB_PRIVATE_STORE_ID: "store_privat", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_oeffentlich" }, "  "), undefined);
  assert.equal(privateBlobAuthFrom({ BLOB_PRIVATE_STORE_ID: "  " }, "oidc"), undefined);
});

test("Privater Blob-Speicher: der öffentliche Audio-Speicher zählt nie", () => {
  assert.equal(privateBlobAuthFrom({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_oeffentlich" }, "oidc"), undefined);
  // Eine Anbindung ohne Präfix (BLOB_STORE_ID) gilt nicht als privater Speicher.
  assert.equal(privateBlobAuthFrom({ BLOB_STORE_ID: "store_irgendwas" }, "oidc"), undefined);
  assert.equal(privateBlobAuthFrom({ BLOB_PRIVATE_READ_WRITE_TOKEN: "", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_oeffentlich" }, undefined), undefined);
  assert.equal(privateBlobAuthFrom({}, undefined), undefined);
  assert.equal(privateBlobConfigured({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_oeffentlich", BLOB_STORE_ID: "store_irgendwas" }), false);
  assert.equal(privateBlobConfigured({ BLOB_PRIVATE_STORE_ID: "store_privat" }), true);
  assert.equal(privateBlobConfigured({ BLOB_PRIVATE_READ_WRITE_TOKEN: "vercel_blob_rw_privat" }), true);
});

test("Öffentlicher Blob-Token: nur BLOB_READ_WRITE_TOKEN", () => {
  assert.equal(publicBlobToken({ BLOB_READ_WRITE_TOKEN: " vercel_blob_rw_oeffentlich " }), "vercel_blob_rw_oeffentlich");
  assert.equal(publicBlobToken({ BLOB_PRIVATE_READ_WRITE_TOKEN: "vercel_blob_rw_privat" }), undefined);
  assert.equal(publicBlobToken({ BLOB_READ_WRITE_TOKEN: "" }), undefined);
});
