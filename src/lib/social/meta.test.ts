import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MetaApiError, fetchMetaStats, graphClient, insightValues, metaAuthorizeUrl, metaConfig, metaErrorText, metaRedirectUri,
  publishToMeta, type FetchLike, type MetaConfig, type MetaTarget,
} from "./meta";
import { countHashtags, metaCaption, publishProblem, type PublishablePost } from "./meta-rules";
import { stateMatches } from "./meta-state";

const CFG: MetaConfig = { appId: "123456789", appSecret: "geheim", configId: null, graphVersion: "v25.0" };
const TARGET: MetaTarget = { pageId: "111", pageToken: "SEITENTOKEN", igUserId: "999" };

interface Call {
  method: string;
  path: string;
  params: Record<string, string>;
}

/** Fake-Graph: beantwortet Aufrufe der Reihe nach über `route`. */
function fakeGraph(route: (c: Call) => unknown) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const params = Object.fromEntries((method === "GET" ? url.searchParams : new URLSearchParams(String(init?.body))).entries());
    const call = { method, path: url.pathname.replace(/^\/v25\.0/, ""), params };
    calls.push(call);
    const body = route(call);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { client: graphClient(CFG, fetchImpl), calls };
}

const post = (p: Partial<PublishablePost>): PublishablePost => ({
  channel: "INSTAGRAM",
  format: "POST",
  text: "Nikolausfahren am 6.12.",
  media: ["https://blob.example/a.jpg"],
  link: null,
  containerId: null,
  ...p,
});

test("metaConfig: nur mit App-ID und Geheimnis, Version prüfbar", () => {
  assert.equal(metaConfig({}), null);
  assert.equal(metaConfig({ META_APP_ID: "abc", META_APP_SECRET: "x" }), null);
  const cfg = metaConfig({ META_APP_ID: " 123456789 ", META_APP_SECRET: " s ", META_GRAPH_VERSION: "v99.0" });
  assert.equal(cfg?.appId, "123456789");
  assert.equal(cfg?.appSecret, "s");
  assert.equal(cfg?.graphVersion, "v99.0");
  assert.equal(metaConfig({ META_APP_ID: "123456789", META_APP_SECRET: "s", META_GRAPH_VERSION: "latest" })?.graphVersion, "v25.0");
});

test("metaAuthorizeUrl: Rechte, state und Rücksprung", () => {
  const redirect = metaRedirectUri("https://www.emp-access.de/");
  assert.equal(redirect, "https://www.emp-access.de/api/social/meta/callback");
  const u = new URL(metaAuthorizeUrl(CFG, redirect, "zufall"));
  assert.equal(u.origin + u.pathname, "https://www.facebook.com/v25.0/dialog/oauth");
  assert.equal(u.searchParams.get("client_id"), "123456789");
  assert.equal(u.searchParams.get("redirect_uri"), redirect);
  assert.equal(u.searchParams.get("state"), "zufall");
  assert.ok(u.searchParams.get("scope")?.includes("instagram_content_publish"));
  assert.ok(u.searchParams.get("scope")?.includes("pages_manage_posts"));
  const withConfig = new URL(metaAuthorizeUrl({ ...CFG, configId: "777" }, redirect, "z"));
  assert.equal(withConfig.searchParams.get("config_id"), "777");
  assert.equal(withConfig.searchParams.get("scope"), null);
});

test("graphClient: Token und appsecret_proof, POST als Formular", async () => {
  const { client, calls } = fakeGraph(() => ({ id: "1" }));
  await client.get("/me", { fields: "id" }, "TOKEN");
  await client.post("/111/feed", { message: "Hallo" }, "TOKEN");
  assert.equal(calls[0].params.access_token, "TOKEN");
  assert.match(calls[0].params.appsecret_proof, /^[0-9a-f]{64}$/);
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].params.message, "Hallo");
  assert.equal(calls[1].params.appsecret_proof, calls[0].params.appsecret_proof);
  await assert.rejects(client.get("/../x", {}, "T"));
});

test("Fehler von Meta: Token ungültig → neu verbinden, Meldung ohne Token", async () => {
  const { client } = fakeGraph(
    () => new Response(JSON.stringify({ error: { message: "Error validating access token EAAB" + "x".repeat(30), code: 190 } }), { status: 400 }),
  );
  const err = await client.get("/me", {}, "T").catch((e: unknown) => e);
  assert.ok(err instanceof MetaApiError);
  assert.equal(err.tokenInvalid, true);
  assert.ok(!err.message.includes("xxxxxxxxxx"));
  assert.match(metaErrorText(err), /neu verbinden/);
  const user = fakeGraph(() => new Response(JSON.stringify({ error: { message: "Invalid parameter", error_user_msg: "Das Bild ist zu klein", code: 100 } }), { status: 400 }));
  const e2 = await user.client.get("/x", {}, "T").catch((e: unknown) => e);
  assert.equal(metaErrorText(e2), "Das Bild ist zu klein");
});

test("publishProblem: Regeln je Kanal und Format", () => {
  const ig = { igUserId: "999" };
  assert.equal(publishProblem(post({}), ig), null);
  assert.match(publishProblem(post({}), null)!, /nicht verbunden/);
  assert.match(publishProblem(post({}), { igUserId: null })!, /kein Instagram-Profil/);
  assert.match(publishProblem(post({ media: [] }), ig)!, /mindestens ein Bild/);
  assert.match(publishProblem(post({ format: "REEL" }), ig)!, /Video/);
  assert.equal(publishProblem(post({ format: "REEL", media: ["https://x.de/v.mp4"] }), ig), null);
  assert.match(publishProblem(post({ format: "CAROUSEL" }), ig)!, /2 bis 10/);
  assert.match(publishProblem(post({ text: "x".repeat(2201) }), ig)!, /2200/);
  assert.match(publishProblem(post({ text: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ") }), ig)!, /30 Hashtags/);
  assert.match(publishProblem(post({ channel: "TIKTOK" }), ig)!, /nur auf Instagram und Facebook/);
  assert.match(publishProblem(post({ channel: "FACEBOOK", format: "STORY" }), ig)!, /von Hand/);
  assert.equal(publishProblem(post({ channel: "FACEBOOK", media: [] }), { igUserId: null }), null);
  assert.equal(publishProblem(post({ channel: "FACEBOOK", media: [], text: "", link: "https://x.de" }), { igUserId: null }), null);
  assert.equal(countHashtags("#a #b c#d #ü"), 3);
});

test("metaCaption: Hashtags der Kampagne, Link nur bei Facebook-Bildern", () => {
  assert.equal(metaCaption({ channel: "INSTAGRAM", text: "Hallo", link: "https://x.de", media: ["a"] }, "#wake"), "Hallo\n\n#wake");
  assert.equal(metaCaption({ channel: "FACEBOOK", text: "Hallo", link: "https://x.de", media: ["a"] }, null), "Hallo\n\nhttps://x.de");
  assert.equal(metaCaption({ channel: "FACEBOOK", text: "Hallo", link: "https://x.de", media: [] }, null), "Hallo");
});

test("Instagram: ein Bild → Container, Status, veröffentlichen, Link", async () => {
  const { client, calls } = fakeGraph((c) => {
    if (c.method === "POST" && c.path === "/999/media") return { id: "C1" };
    if (c.path === "/C1") return { status_code: "FINISHED" };
    if (c.path === "/999/media_publish") return { id: "M1" };
    if (c.path === "/M1") return { permalink: "https://www.instagram.com/p/abc/" };
    throw new Error(`unerwartet ${c.path}`);
  });
  const r = await publishToMeta(client, TARGET, post({}), "#wakeboard");
  assert.deepEqual(r, { state: "PUBLISHED", externalId: "M1", postUrl: "https://www.instagram.com/p/abc/" });
  assert.equal(calls[0].params.image_url, "https://blob.example/a.jpg");
  assert.equal(calls[0].params.caption, "Nikolausfahren am 6.12.\n\n#wakeboard");
  assert.equal(calls[0].params.access_token, "SEITENTOKEN");
  assert.equal(calls[2].params.creation_id, "C1");
});

test("Instagram: Karussell mit Kind-Containern", async () => {
  let n = 0;
  const { client, calls } = fakeGraph((c) => {
    if (c.method === "POST" && c.path === "/999/media") return { id: c.params.media_type === "CAROUSEL" ? "P" : `K${++n}` };
    if (c.path === "/P") return { status_code: "FINISHED" };
    if (c.path === "/999/media_publish") return { id: "M2" };
    return {};
  });
  const r = await publishToMeta(client, TARGET, post({ format: "CAROUSEL", media: ["https://b/1.jpg", "https://b/2.mp4"] }), null);
  assert.equal(r.state, "PUBLISHED");
  assert.equal(calls[0].params.is_carousel_item, "true");
  assert.equal(calls[1].params.media_type, "VIDEO");
  assert.equal(calls[1].params.video_url, "https://b/2.mp4");
  assert.equal(calls[2].params.children, "K1,K2");
  assert.equal(calls[2].params.caption, "Nikolausfahren am 6.12.");
});

test("Instagram: Reel in Verarbeitung, später fertig posten", async () => {
  let ready = false;
  const { client, calls } = fakeGraph((c) => {
    if (c.method === "POST" && c.path === "/999/media") return { id: "R1" };
    if (c.path === "/R1") return { status_code: ready ? "FINISHED" : "IN_PROGRESS" };
    if (c.path === "/999/media_publish") return { id: "M3" };
    return {};
  });
  const reel = post({ format: "REEL", media: ["https://b/v.mov"] });
  const first = await publishToMeta(client, TARGET, reel, null, { waitMs: 0 });
  assert.deepEqual(first, { state: "PROCESSING", containerId: "R1" });
  assert.equal(calls[0].params.media_type, "REELS");
  ready = true;
  const before = calls.length;
  const second = await publishToMeta(client, TARGET, { ...reel, containerId: "R1" }, null, { waitMs: 0 });
  assert.equal(second.state, "PUBLISHED");
  assert.ok(!calls.slice(before).some((c) => c.method === "POST" && c.path === "/999/media"), "kein zweiter Container");
});

test("Instagram: Story ohne Text, Fehler im Container wird gemeldet", async () => {
  const { client, calls } = fakeGraph((c) => {
    if (c.method === "POST" && c.path === "/999/media") return { id: "S1" };
    if (c.path === "/S1") return { status_code: "ERROR", status: "Error: Media ID is not available" };
    return {};
  });
  const err = await publishToMeta(client, TARGET, post({ format: "STORY" }), "#x").catch((e: unknown) => e);
  assert.ok(err instanceof MetaApiError);
  assert.equal(err.status, 422);
  assert.equal(calls[0].params.media_type, "STORIES");
  assert.equal(calls[0].params.caption, undefined);
});

test("Facebook: ein Bild, mehrere Bilder, nur Text mit Link", async () => {
  const one = fakeGraph((c) => (c.path === "/111/photos" ? { id: "PH", post_id: "111_5" } : { permalink_url: "https://www.facebook.com/111/posts/5" }));
  const r1 = await publishToMeta(one.client, TARGET, post({ channel: "FACEBOOK", link: "https://t.de/?utm_campaign=n" }), null);
  assert.deepEqual(r1, { state: "PUBLISHED", externalId: "111_5", postUrl: "https://www.facebook.com/111/posts/5" });
  assert.equal(one.calls[0].params.url, "https://blob.example/a.jpg");
  assert.match(one.calls[0].params.message, /utm_campaign=n$/);

  let n = 0;
  const many = fakeGraph((c) => (c.path === "/111/photos" ? { id: `F${++n}` } : c.path === "/111/feed" ? { id: "111_9" } : {}));
  await publishToMeta(many.client, TARGET, post({ channel: "FACEBOOK", media: ["https://b/1.jpg", "https://b/2.jpg"] }), null);
  assert.equal(many.calls[0].params.published, "false");
  assert.equal(many.calls[2].params["attached_media[1]"], JSON.stringify({ media_fbid: "F2" }));

  const text = fakeGraph((c) => (c.path === "/111/feed" ? { id: "111_10" } : { permalink_url: "/111/posts/10" }));
  const r3 = await publishToMeta(text.client, TARGET, post({ channel: "FACEBOOK", media: [], link: "https://t.de" }), null);
  assert.equal(text.calls[0].params.link, "https://t.de");
  assert.equal(text.calls[0].params.message, "Nikolausfahren am 6.12.");
  assert.equal(r3.state === "PUBLISHED" && r3.postUrl, "https://www.facebook.com/111/posts/10");
});

test("insightValues: values und total_value", () => {
  assert.deepEqual(
    insightValues({ data: [{ name: "reach", values: [{ value: 120 }] }, { name: "views", total_value: { value: 300 } }, { name: "x" }] }),
    { reach: 120, views: 300 },
  );
  assert.deepEqual(insightValues(null), {});
});

test("fetchMetaStats: Instagram-Insights, Facebook-Reaktionen, fehlende Metriken ohne Abbruch", async () => {
  const ig = fakeGraph((c) =>
    c.path === "/M1/insights"
      ? { data: [{ name: "reach", values: [{ value: 500 }] }, { name: "views", values: [{ value: 800 }] }, { name: "total_interactions", values: [{ value: 42 }] }] }
      : { permalink: "https://www.instagram.com/p/abc/", like_count: 30, comments_count: 5 },
  );
  const s1 = await fetchMetaStats(ig.client, TARGET, { channel: "INSTAGRAM", format: "POST", externalId: "M1" });
  assert.deepEqual(s1, { reach: 500, views: 800, interactions: 42, clicks: null, postUrl: "https://www.instagram.com/p/abc/" });

  const fb = fakeGraph((c) => {
    if (c.path.endsWith("/insights")) return new Response(JSON.stringify({ error: { message: "metric deprecated", code: 100 } }), { status: 400 });
    return { permalink_url: "https://www.facebook.com/x", shares: { count: 2 }, reactions: { summary: { total_count: 10 } }, comments: { summary: { total_count: 3 } } };
  });
  const s2 = await fetchMetaStats(fb.client, TARGET, { channel: "FACEBOOK", format: "POST", externalId: "111_5" });
  assert.deepEqual(s2, { reach: null, views: null, interactions: 15, clicks: null, postUrl: "https://www.facebook.com/x" });

  const dead = fakeGraph(() => new Response(JSON.stringify({ error: { message: "expired", code: 190 } }), { status: 400 }));
  await assert.rejects(fetchMetaStats(dead.client, TARGET, { channel: "INSTAGRAM", format: "POST", externalId: "M1" }), MetaApiError);
});

test("stateMatches: Zufallswert und Mandant müssen passen", () => {
  assert.equal(stateMatches("abc123.7", "abc123", 7), true);
  assert.equal(stateMatches("abc123.7", "abc124", 7), false);
  assert.equal(stateMatches("abc123.7", "abc123", 8), false);
  assert.equal(stateMatches(undefined, "abc123", 7), false);
  assert.equal(stateMatches("abc123.7", null, 7), false);
});

test("isRetryable: Netz und vorübergehende Fehler ja, Token und Regeln nein", async () => {
  const { isRetryable } = await import("./meta");
  assert.equal(isRetryable(new TypeError("fetch failed")), true);
  assert.equal(isRetryable(new MetaApiError("x", { status: 500 })), true);
  assert.equal(isRetryable(new MetaApiError("x", { status: 400, code: 190 })), false);
  assert.equal(isRetryable(new MetaApiError("Instagram braucht ein Bild", { status: 400 })), false);
  assert.match(metaErrorText(new TypeError("fetch failed")), /nicht erreichbar/);
});
