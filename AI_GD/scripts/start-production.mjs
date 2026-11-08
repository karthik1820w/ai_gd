import { existsSync } from "node:fs";

if (!existsSync(".next/BUILD_ID")) {
  console.error("Production build is missing. Run `npm run build` before `npm start`.");
  process.exit(1);
}

process.env.NODE_ENV = "production";
await import("../server/index.ts");
