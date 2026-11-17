import assert from "node:assert/strict";
import { describe, it } from "node:test";
import crypto from "node:crypto";
import { getIceServers } from "../src/server/ice.ts";

describe("ICE and TURN configuration", () => {
  it("defaults to STUN servers", () => {
    delete process.env.TURN_URLS;
    delete process.env.TURN_URL;
    delete process.env.TURN_SECRET;

    const servers = getIceServers("test-user");
    assert.ok(servers.length >= 1);
    assert.ok(servers[0].urls.toString().includes("stun:"));
  });

  it("generates coturn HMAC time-limited credentials when TURN_SECRET is set", () => {
    process.env.TURN_URLS = "turn:turn.example.com:3478";
    process.env.TURN_SECRET = "supersecretkey";

    try {
      const servers = getIceServers("test-user");
      const turnServer = servers.find((s) => s.username);
      assert.ok(turnServer);

      const [expiryStr, userId] = turnServer.username!.split(":");
      assert.equal(userId, "test-user");
      assert.ok(Number(expiryStr) > Date.now() / 1000);

      const expectedHmac = crypto
        .createHmac("sha1", "supersecretkey")
        .update(turnServer.username!)
        .digest("base64");
      assert.equal(turnServer.credential, expectedHmac);
    } finally {
      delete process.env.TURN_URLS;
      delete process.env.TURN_SECRET;
    }
  });
});

