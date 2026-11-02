import { createQueryHandler, createQueryTool } from "../../../core/query.js";
import { executeSql, validateReadOnly } from "../client.js";

export const queryTools = [createQueryTool("SQL Server", "TOP or FETCH NEXT")];
export const handleQueryTool = createQueryHandler(executeSql, validateReadOnly);
