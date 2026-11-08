import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { resolveMediaBinary } from "../src/server/media.ts";

describe("LiveKit binary resolution", () => {
  it("uses a platform-appropriate binary for Windows, Linux, and macOS", () => {
    assert.equal(path.basename(resolveMediaBinary("win32", "x64", "", "C:\\quorum")), "livekit-server.exe");
    assert.equal(path.basename(resolveMediaBinary("linux", "x64", "", "/srv/quorum")), "livekit-server");
    assert.equal(path.basename(resolveMediaBinary("darwin", "arm64", "", "/srv/quorum")), "livekit-server");
  });

  it("honors an explicit binary path", () => {
    assert.equal(
      resolveMediaBinary("linux", "x64", "custom/livekit", "/srv/quorum"),
      path.resolve("/srv/quorum", "custom/livekit"),
    );
  });

  it("rejects architectures without a release binary", () => {
    assert.throws(() => resolveMediaBinary("linux", "ia32", "", "/srv/quorum"), /not supported/);
  });
});
