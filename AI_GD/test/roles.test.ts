import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizedRole, HOST_EMAIL } from "../src/lib/roles.ts";
import { registerSchema } from "../src/lib/validators.ts";

describe("host role authorization", () => {
  it("only grants the stored host role to the fixed host email", () => {
    assert.equal(authorizedRole(HOST_EMAIL, "HOST"), "HOST");
    assert.equal(authorizedRole(HOST_EMAIL.toUpperCase(), "HOST"), "HOST");
    assert.equal(authorizedRole("other@example.com", "HOST"), "PARTICIPANT");
    assert.equal(authorizedRole(HOST_EMAIL, "PARTICIPANT"), "PARTICIPANT");
  });

  it("does not accept a role from public registration input", () => {
    const account = { name: "Example User", email: "user@example.com", password: "password123" };
    assert.deepEqual(registerSchema.parse(account), account);
    assert.equal(registerSchema.safeParse({ ...account, role: "HOST" }).success, false);
  });
});
