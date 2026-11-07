/** Inspect the claimed original type; all returned bytes remain unchanged. */
export function validFilingEvidence(type: string, bytes: Uint8Array) {
  const prefix = Buffer.from(bytes.subarray(0, 8));
  if (type === "application/pdf")
    return prefix.subarray(0, 5).toString() === "%PDF-";
  if (type === "image/png")
    return prefix.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type !== "text/plain" || bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
