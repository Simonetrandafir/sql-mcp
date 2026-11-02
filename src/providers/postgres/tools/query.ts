import { createQueryHandler, createQueryTool } from "../../../core/query.js";
import { executeSql, validateReadOnly } from "../client.js";

export const queryTools = [createQueryTool("PostgreSQL", "LIMIT")];
export const handleQueryTool = createQueryHandler(executeSql, validateReadOnly);
