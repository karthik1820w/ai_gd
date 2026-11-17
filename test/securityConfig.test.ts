import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { secureCookie } from "../src/lib/securityConfig.ts";

describe("secure session cookie configuration", () => {
  it("follows the request protocol instead of NODE_ENV", () => {
    assert.equal(secureCookie(new Request("http://quorum.local"), undefined, true), false);
    assert.equal(secureCookie(new Request("https://quorum.local"), undefined, false), true);
  });

  it("honors trusted forwarded HTTPS and explicit overrides", () => {
    assert.equal(secureCookie(new Request("http://quorum.local", { headers: { "x-forwarded-proto": "https" } }), undefined, false), true);
    assert.equal(secureCookie(new Request("https://quorum.local"), "off", true), false);
    assert.equal(secureCookie(new Request("http://quorum.local"), "on", false), true);
    assert.throws(() => secureCookie(undefined, "maybe", false), /COOKIE_SECURE/);
  });
});
