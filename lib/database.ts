import { Pool } from "pg";
import { config } from "./config";

const globalPool = globalThis as typeof globalThis & { __interviewerPool?: Pool };

export function getDatabasePool(): Pool {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required for Postgres storage.");
  globalPool.__interviewerPool ??= new Pool({ connectionString: config.databaseUrl });
  return globalPool.__interviewerPool;
}