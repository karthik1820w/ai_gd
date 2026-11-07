import { writeFileSync, mkdirSync } from "fs";
import { networkInterfaces } from "os";
import selfsigned from "selfsigned";

const altNames: Array<{ type: number; value?: string; ip?: string }> = [
  { type: 2, value: "localhost" },
  { type: 7, ip: "127.0.0.1" },
];
for (const entries of Object.values(networkInterfaces())) {
  for (const entry of entries ?? []) {
    if (entry.family === "IPv4" && !entry.internal) altNames.push({ type: 7, ip: entry.address });
  }
}
const pems = await selfsigned.generate([{ name: "commonName", value: "localhost" }], {
  days: 365,
  keySize: 2048,
  algorithm: "sha256",
  extensions: [{ name: "subjectAltName", altNames }],
});
mkdirSync("certs", { recursive: true });
writeFileSync("certs/key.pem", pems.private);
writeFileSync("certs/cert.pem", pems.cert);
console.log("Wrote certs/key.pem and certs/cert.pem. Browsers will warn until you trust this local certificate.");
