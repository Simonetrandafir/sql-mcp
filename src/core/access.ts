import "./environment.js";

export type AccessLevel = "read" | "write";

export function getAccessLevel(): AccessLevel {
  const value = (process.env.SQL_ACCESS_LEVEL ?? "write").trim().toLowerCase();
  if (value !== "read" && value !== "write") {
    throw new Error("SQL_ACCESS_LEVEL must be 'read' or 'write'.");
  }
  return value;
}
