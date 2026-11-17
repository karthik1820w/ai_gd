import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeSTTPacket, decodeSTTPacket } from "../src/server/transcriber.ts";

describe("STT worker IPC protocol framing", () => {
  it("encodes and decodes STT packets with 8-byte big-endian header", () => {
    const requestId = 42;
    const fakePCM = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);

    const packet = encodeSTTPacket(requestId, fakePCM);
    assert.equal(packet.length, 8 + fakePCM.length);

    // Verify big-endian request id and byte length in header
    assert.equal(packet.readUInt32BE(0), 42);
    assert.equal(packet.readUInt32BE(4), 6);

    const decoded = decodeSTTPacket(packet);
    assert.ok(decoded);
    assert.equal(decoded.id, 42);
    assert.equal(decoded.length, 6);
    assert.deepEqual(decoded.pcm, fakePCM);
  });

  it("returns null if packet is incomplete or smaller than 8 bytes", () => {
    const truncated = Buffer.from([0x00, 0x00, 0x00]);
    assert.equal(decodeSTTPacket(truncated), null);

    // 8 bytes header claiming 10 bytes payload, but only 2 bytes attached
    const partial = Buffer.alloc(10);
    partial.writeUInt32BE(1, 0);
    partial.writeUInt32BE(10, 4);
    assert.equal(decodeSTTPacket(partial), null);
  });
});

