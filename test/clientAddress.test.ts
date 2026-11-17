import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loginRateLimitKeys, resolveClientAddress } from "../src/server/clientAddress.ts";
import { rateLimit } from "../src/server/httpRateLimit.ts";
import { appOrigin } from "../src/server/ids.ts";

describe("client address and login rate limits", () => {
  it("uses the remote address unless proxy headers are explicitly trusted", () => {
    assert.equal(resolveClientAddress("::ffff:192.168.1.25", {}, false), "192.168.1.25");
    assert.equal(resolveClientAddress("10.0.0.3", { forwardedFor: "198.51.100.7, 10.0.0.2" }, true), "198.51.100.7");
  });

  it("uses a sanitized request IP instead of an untrusted forwarded header", () => {
    const request = new Request("http://localhost/api/auth/login", {
      headers: { "x-real-ip": "192.168.1.25", "x-forwarded-for": "198.51.100.7" },
    });
    assert.equal(loginRateLimitKeys(request, "  STUDENT@example.com ").ip, "login:ip:192.168.1.25");
  });

  it("normalizes login email and applies independent IP and account limits", () => {
    const first = loginRateLimitKeys(new Request("http://localhost", { headers: { "x-real-ip": "192.168.1.25" } }), " Student@Example.com ");
    const second = loginRateLimitKeys(new Request("http://localhost", { headers: { "x-real-ip": "192.168.1.26" } }), "student@example.com");
    assert.equal(first.email, "login:email:student@example.com");
    assert.equal(first.ip, "login:ip:192.168.1.25");
    assert.equal(second.ip, "login:ip:192.168.1.26");
    assert.equal(second.email, first.email);
  });

  it("allows 20 distinct users and limits repeated attempts for a single account", () => {
    for (let index = 1; index <= 20; index++) {
      const request = new Request("http://localhost", { headers: { "x-real-ip": `192.168.1.${index}` } });
      const keys = loginRateLimitKeys(request, `student${index}@example.com`);
      assert.equal(rateLimit(keys.ip, 30, 600_000), true);
      assert.equal(rateLimit(keys.email, 12, 600_000), true);
    }

    for (let index = 1; index <= 12; index++) {
      const request = new Request("http://localhost", { headers: { "x-real-ip": `198.51.100.${index}` } });
      assert.equal(rateLimit(loginRateLimitKeys(request, "target@example.com").email, 12, 600_000), true);
    }
    assert.equal(rateLimit(loginRateLimitKeys(new Request("http://localhost", { headers: { "x-real-ip": "203.0.113.1" } }), "target@example.com").email, 12, 600_000), false);
  });

  it("uses the request origin instead of a localhost APP_URL", () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = "http://localhost:3000";
    try {
      assert.equal(appOrigin(new Request("http://192.168.1.25:3000/api/invite")), "http://192.168.1.25:3000");
    } finally {
      if (previous === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previous;
    }
  });

  it("keeps an explicitly configured public APP_URL", () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = "https://quorum.example.com/";
    try {
      assert.equal(appOrigin(new Request("http://192.168.1.25:3000/api/invite")), "https://quorum.example.com");
    } finally {
      if (previous === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previous;
    }
  });
});
