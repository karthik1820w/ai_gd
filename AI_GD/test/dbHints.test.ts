import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeDbError, withPoolerSettings } from "../src/lib/dbHints.ts";

describe("database hints", () => {
  it("explains common failures without echoing the message", () => {
    assert.match(describeDbError(Object.assign(new Error("x"), { code: "P2021" })), /npx prisma db push/);
    assert.match(describeDbError(Object.assign(new Error("Can't reach database server at `db.x.co:5432`"), { code: "P1001" })), /cannot be reached/);
    assert.match(describeDbError(new Error("Environment variable not found: DATABASE_URL")), /DATABASE_URL/);
    assert.match(describeDbError(new Error("prepared statement \"s0\" already exists")), /pgbouncer/);
    assert.match(describeDbError(new Error("Authentication failed against database server")), /username or password/);
    assert.doesNotMatch(describeDbError(new Error("secret-host.internal")), /secret-host/);
  });
  it("gives Render-specific hints for hosted database failures", () => {
    assert.match(describeDbError(new Error("Environment variable not found: DATABASE_URL")), /Render service environment/);
    assert.match(describeDbError(Object.assign(new Error("Can't reach database server at `db.project.supabase.co:5432`"), { code: "P1001" })), /Session pooler/);
    assert.match(describeDbError(new Error("Query Engine library for current platform")), /Render's Linux runtime/);
    assert.match(describeDbError(new Error("unexpected database response")), /Render service logs/);
  });
  it("adds pgbouncer settings only to pooled URLs", () => {
    const pooled = withPoolerSettings("postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres")!;
    assert.match(pooled, /pgbouncer=true/);
    assert.match(pooled, /connection_limit=1/);
    const direct = "postgresql://u:p@db.example.com:5432/app?sslmode=require";
    assert.equal(withPoolerSettings(direct), direct);
    assert.equal(withPoolerSettings(undefined), undefined);
    assert.equal(withPoolerSettings("not a url"), "not a url");
  });
});
