export function productionCron(pattern: string | undefined) {
  if (!pattern?.trim()) return undefined;
  const environments: "PRODUCTION"[] = ["PRODUCTION"];
  return { pattern, timezone: "UTC", environments };
}
