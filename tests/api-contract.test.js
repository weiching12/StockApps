import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../cloudflare/worker.js";
import { testDatabase } from "./helpers/t86-db.js";
import { createManifest, marketDay, mergeShard, normalizeCatalog, normalizeFlows, normalizePrices, MANIFEST_KEY, shardKey, shardOf } from "../cloudflare/twse.js";

const spec = JSON.parse(readFileSync(new URL("../public/openapi.json", import.meta.url)));
// Contract smoke checker for the schema keywords used here, not a general OAS validator.
function check(schema, value) {
  if (schema.$ref) return check(spec.components.schemas[schema.$ref.split("/").at(-1)], value);
  for (const part of schema.allOf ?? []) check(part, value);
  if (schema.anyOf) {
    assert.ok(schema.anyOf.some((part) => { try { check(part, value); return true; } catch { return false; } }));
    return;
  }
  if ("const" in schema) assert.deepEqual(value, schema.const);
  if (schema.enum) assert.ok(schema.enum.includes(value));
  if (schema.type === "null") assert.equal(value, null);
  if (schema.type === "object") {
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    for (const key of schema.required ?? []) assert.ok(key in value, `Missing ${key}`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in value) check(child, value[key]);
  }
  if (schema.type === "array") {
    assert.ok(Array.isArray(value));
    if (schema.minItems) assert.ok(value.length >= schema.minItems);
    if (schema.maxItems) assert.ok(value.length <= schema.maxItems);
    for (const item of value) check(schema.items ?? {}, item);
  }
  if (schema.type === "string") { assert.equal(typeof value, "string"); if (schema.pattern) assert.match(value, new RegExp(schema.pattern)); }
  if (["number", "integer"].includes(schema.type)) {
    assert.ok(Number.isFinite(value)); if (schema.type === "integer") assert.ok(Number.isInteger(value));
    if (schema.minimum !== undefined) assert.ok(value >= schema.minimum);
    if (schema.maximum !== undefined) assert.ok(value <= schema.maximum);
  }
}

test("documented market, stock, history and analysis responses match the published contract", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/twse-20261016.json", import.meta.url)));
  const catalog = normalizeCatalog(fixture.companies), date = "2026-10-16";
  const day = marketDay(catalog, normalizePrices(fixture.prices, date), normalizeFlows(fixture.flows, date));
  const manifest = createManifest(catalog, [date], "contract", "2026-10-16T12:00:00Z", day.coverage);
  const data = new Map([[MANIFEST_KEY, manifest]]);
  for (let index = 0; index < 128; index++) data.set(shardKey("contract", index), { ...mergeShard(catalog, index, null, [day]), generation: "contract", index });
  const db = testDatabase();
  db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0005_research_snapshots.sql", import.meta.url), "utf8"));
  db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0010_entry_research.sql", import.meta.url), "utf8"));
  const env = { MARKET_DATA: { get: async (key) => structuredClone(data.get(key) ?? null) }, T86_DB: db };
  for (const [path, definition] of Object.entries(spec.paths)) {
    if (path.endsWith("presence") || path.includes("/push/") || path.includes("/auth/")) continue;
    const concrete = path.replace("{symbol}", "2330").replace("{generation}", "contract")
      .replace("{index}", String(shardOf("2330"))).replace("{name}", encodeURIComponent(catalog[0].sector)) +
      (path === "/api/v1/favorites/summary" || path === "/api/v1/favorites/research" ? "?symbols=2330" : "");
    const response = await worker.fetch(new Request(`https://example.test${concrete}`), env);
    assert.equal(response.status, 200, concrete);
    check(definition.get.responses[200].content["application/json"].schema, await response.json());
    const head = await worker.fetch(new Request(`https://example.test${concrete}`, { method: "HEAD" }), env);
    assert.equal(head.status, 200); assert.equal(await head.text(), "");
  }
  const invalid = await worker.fetch(new Request("https://example.test/api/v1/stocks?limit=201"), env);
  assert.equal(invalid.status, 400); check(spec.components.schemas.Error, await invalid.json());
  db.sqlite.close();
});


test("documented account operations use their declared methods and cookie-based responses", async () => {
  const { authDatabase } = await import("./helpers/auth-db.js");
  const { hashPassword } = await import("../cloudflare/auth/password.js");
  const db = authDatabase();
  try {
    db.sqlite.prepare("INSERT INTO app_users(id, username, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)")
      .run("contract-user", "contract-user", await hashPassword("contract-test-password"), "user", Date.now());
    const env = { T86_DB: db };
    const response = await worker.fetch(new Request("https://example.test/api/v1/auth/login", {
      method: "POST", headers: { Origin: "https://example.test" },
      body: JSON.stringify({ username: "contract-user", password: "contract-test-password" }),
    }), env);
    assert.equal(response.status, 200);
    check(spec.paths["/api/v1/auth/login"].post.responses[200].content["application/json"].schema, await response.json());
    let cookie = response.headers.get("set-cookie");
    db.sqlite.prepare("UPDATE app_users SET must_change_password = 1 WHERE id = 'contract-user'").run();
    for (const path of ["/api/presence", "/api/v1/presence"]) {
      const restricted = await worker.fetch(new Request(`https://example.test${path}`, { headers: { Cookie: cookie } }), env);
      assert.equal(restricted.status, 403);
      const failure = await restricted.json();
      assert.equal(path.startsWith("/api/v1/") ? failure.error.code : failure.code, "PASSWORD_CHANGE_REQUIRED");
    }
    const changed = await worker.fetch(new Request("https://example.test/api/v1/auth/change-password", {
      method: "POST", headers: { Cookie: cookie, Origin: "https://example.test" },
      body: JSON.stringify({ password: "new-contract-test-password", confirmPassword: "new-contract-test-password" }),
    }), env);
    assert.equal(changed.status, 200);
    const changedBody = await changed.json();
    assert.equal(changedBody.user.mustChangePassword, false);
    check(spec.paths["/api/v1/auth/change-password"].post.responses[200].content["application/json"].schema, changedBody);
    cookie = changed.headers.get("set-cookie");
    const me = await worker.fetch(new Request("https://example.test/api/v1/auth/me", { headers: { Cookie: cookie } }), env);
    assert.equal(me.status, 200);
    check(spec.paths["/api/v1/auth/me"].get.responses[200].content["application/json"].schema, await me.json());
    const logout = await worker.fetch(new Request("https://example.test/api/v1/auth/logout", { method: "POST", headers: { Cookie: cookie, Origin: "https://example.test" } }), env);
    assert.equal(logout.status, 200);
    const anonymous = await worker.fetch(new Request("https://example.test/api/v1/auth/me", { headers: { Cookie: cookie } }), env);
    const body = await anonymous.json();
    assert.deepEqual(body, { user: null });
    check(spec.paths["/api/v1/auth/me"].get.responses[200].content["application/json"].schema, body);
    assert.equal(spec.components.securitySchemes.AccountSession.name, "__Host-stock_session");
  } finally { db.sqlite.close(); }
});
