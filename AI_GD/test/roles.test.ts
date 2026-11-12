import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizedRole } from "../src/lib/roles.ts";
import { hostPasswordMatches, isHostEmail, readHostConfig } from "../src/lib/hostAccount.ts";
import { registerSchema } from "../src/lib/validators.ts";

const env = { HOST_EMAIL: " Host@Example.com ", HOST_PASSWORD: "a-good-host-password" };

describe("host account from the environment", () => {
  it("reads and normalises HOST_EMAIL and HOST_PASSWORD", () => {
    const config = readHostConfig(env);
    assert.deepEqual(config, { ok: true, email: "host@example.com", password: "a-good-host-password" });
  });
  it("rejects missing, invalid, short or overlong values", () => {
    assert.equal(readHostConfig({}).ok, false);
    assert.equal(readHostConfig({ HOST_EMAIL: "nope", HOST_PASSWORD: "a-good-host-password" }).ok, false);
    assert.equal(readHostConfig({ HOST_EMAIL: "h@e.com", HOST_PASSWORD: "short" }).ok, false);
    assert.equal(readHostConfig({ HOST_EMAIL: "h@e.com", HOST_PASSWORD: "x".repeat(81) }).ok, false);
  });
  it("recognises the host email case-insensitively, and never when unset", () => {
    assert.equal(isHostEmail("HOST@example.COM", env), true);
    assert.equal(isHostEmail("other@example.com", env), false);
    assert.equal(isHostEmail("host@example.com", {}), false);
  });
  it("compares passwords exactly", () => {
    assert.equal(hostPasswordMatches("a-good-host-password", "a-good-host-password"), true);
    assert.equal(hostPasswordMatches("a-good-host-passwor", "a-good-host-password"), false);
    assert.equal(hostPasswordMatches("", "a-good-host-password"), false);
  });
  it("only grants the stored host role to the configured email", () => {
    assert.equal(authorizedRole("host@example.com", "HOST", env), "HOST");
    assert.equal(authorizedRole("HOST@EXAMPLE.COM", "HOST", env), "HOST");
    assert.equal(authorizedRole("other@example.com", "HOST", env), "PARTICIPANT");
    assert.equal(authorizedRole("host@example.com", "PARTICIPANT", env), "PARTICIPANT");
    assert.equal(authorizedRole("host@example.com", "HOST", {}), "PARTICIPANT");
  });
  it("does not accept a role from public registration input", () => {
    const account = { name: "Example User", email: "user@example.com", password: "password123" };
    assert.deepEqual(registerSchema.parse(account), account);
    assert.equal(registerSchema.safeParse({ ...account, role: "HOST" }).success, false);
  });
});
