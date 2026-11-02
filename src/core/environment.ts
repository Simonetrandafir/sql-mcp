import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";

// A portable executable reads configuration beside itself, even when launched
// by an MCP client or from a different working directory.
export const applicationDirectory = isSea()
  ? dirname(process.execPath)
  : fileURLToPath(new URL("../../", import.meta.url));

export const defaultAuditLogPath = isSea()
  ? join(applicationDirectory, "logs")
  : "logs";

dotenv.config({ path: join(applicationDirectory, ".env") });
