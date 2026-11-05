/** Preserve full certificate and hostname verification across pg versions. */
export function databaseConnectionUrl(value: string, direct = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid database connection configuration.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Expected a PostgreSQL connection.");
  }
  const neon = url.hostname.endsWith(".neon.tech");
  const sslmode = url.searchParams.get("sslmode");
  if (
    neon ||
    (sslmode && ["prefer", "require", "verify-ca"].includes(sslmode))
  ) {
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.delete("uselibpqcompat");
  }
  if (direct && neon) url.hostname = url.hostname.replace("-pooler.", ".");
  return url.toString();
}
