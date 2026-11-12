/** Turn a database/Prisma failure into a plain-language hint. Never includes the original message or any secret. */
export function describeDbError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/db\.[a-z0-9]+\.supabase\.co/i.test(raw) && /Can't reach database server|ENOTFOUND|ECONNREFUSED|timed out|P1001/i.test(raw))
    return "Supabase's direct database host may not be reachable from your deployment. Use the Session pooler connection string (aws-0-<region>.pooler.supabase.com, user postgres.<ref>) as DATABASE_URL.";
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/Environment variable not found|must start with the protocol|invalid port number|Error parsing connection string/i.test(message))
    return "DATABASE_URL is missing or is not a valid postgresql:// connection string. Set it in your deployment environment.";
  if (code === "P1000" || /Authentication failed|password authentication failed/i.test(message))
    return "The database rejected the username or password in DATABASE_URL.";
  if (code === "P1001" || /Can't reach database server|ECONNREFUSED|ENOTFOUND|timed out/i.test(message))
    return "The database cannot be reached. Check the host, port, and network access rules for your deployment.";
  if (code === "P1003" || /Database .* does not exist/i.test(message))
    return "The database name in DATABASE_URL does not exist.";
  if (code === "P1011" || /TLS|SSL/i.test(message))
    return "SSL problem. Add ?sslmode=require to DATABASE_URL.";
  if (code === "P2021" || code === "P2022" || /relation ".*" does not exist|table .* does not exist|column .* does not exist/i.test(message))
    return "The tables are missing or out of date: the schema has not been pushed to this database. Run `npx prisma db push` against it.";
  if (/prepared statement|bind message supplies|pgbouncer/i.test(message))
    return "Connection-pooler problem. Add ?pgbouncer=true&connection_limit=1 to DATABASE_URL (the app also does this automatically for Supabase pooler URLs).";
  if (code === "P2037" || /too many (database )?connections|remaining connection slots/i.test(message))
    return "Too many database connections. Use your provider's pooled connection string.";
  if (/Query Engine|query_engine|rhel-openssl|binaryTargets/i.test(message))
    return "The Prisma engine for the deployment runtime is missing. Regenerate Prisma Client and redeploy.";
  return "Unexpected database error. Check your deployment logs for the error details.";
}

/** Add pgbouncer settings to a pooled (Supabase/Neon-style) URL so Prisma works on serverless. */
export function withPoolerSettings(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    const pooled = /pooler|pgbouncer/i.test(parsed.hostname) || parsed.port === "6543";
    if (!pooled) return url;
    if (!parsed.searchParams.has("pgbouncer")) parsed.searchParams.set("pgbouncer", "true");
    if (!parsed.searchParams.has("connection_limit")) parsed.searchParams.set("connection_limit", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}
