// Deployment-owned links only. No URL from a provider response, error or customer
// input is echoed into the interface. Queries/fragments/bearer links are excluded.
export function configuredOperationLogs(
  environment: Record<string, string | undefined>,
) {
  const entries = [
    {
      key: "OPERATIONS_TRIGGER_LOG_URL",
      label: "Trigger run logs",
      host: "cloud.trigger.dev",
      path: /^\/orgs\/[a-zA-Z0-9_-]+\/projects\/[a-zA-Z0-9_-]+\/runs\/?$/,
    },
    {
      key: "OPERATIONS_VERCEL_LOG_URL",
      label: "Vercel runtime logs",
      host: "vercel.com",
      path: /^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/logs\/?$/,
    },
    {
      key: "OPERATIONS_NEON_LOG_URL",
      label: "Neon monitoring",
      host: "console.neon.tech",
      path: /^\/app\/projects\/[a-zA-Z0-9_-]+\/(?:monitoring|branches)\/?$/,
    },
  ];
  const links: { label: string; url: string }[] = [],
    unavailable: string[] = [];
  for (const entry of entries) {
    const value = environment[entry.key];
    if (!value) {
      unavailable.push(
        `${entry.label}: an authorized resource URL has not been configured.`,
      );
      continue;
    }
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.hostname !== entry.host ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !entry.path.test(url.pathname)
      )
        throw new Error("Unsafe link");
      links.push({ label: entry.label, url: url.href });
    } catch {
      unavailable.push(
        `${entry.label}: the configured link is unavailable or does not match an allowed resource path.`,
      );
    }
  }
  return { links, unavailable };
}
