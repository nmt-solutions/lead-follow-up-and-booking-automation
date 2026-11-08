import { createHash } from "node:crypto";

/** sha256_sorted_json_v1: the original #51 canonical report digest. */
export function sha256SortedJsonV1(value: unknown) {
  const normalized: unknown = JSON.parse(JSON.stringify(value));
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, sorted(item)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(sorted(normalized)))
    .digest("hex");
}
