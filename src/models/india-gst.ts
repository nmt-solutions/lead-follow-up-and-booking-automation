// GSTN state master: https://docs.ewaybillgst.gov.in/apidocs/state-code.html
export const indiaStates = [
  {
    code: "35",
    name: "Andaman and Nicobar Islands",
    aliases: ["AN", "Andaman and Nicobar"],
  },
  { code: "37", name: "Andhra Pradesh", aliases: ["AP"] },
  { code: "12", name: "Arunachal Pradesh", aliases: ["AR"] },
  { code: "18", name: "Assam", aliases: ["AS"] },
  { code: "10", name: "Bihar", aliases: ["BR"] },
  { code: "04", name: "Chandigarh", aliases: ["CH"] },
  { code: "22", name: "Chhattisgarh", aliases: ["CT", "CG"] },
  {
    code: "26",
    name: "Dadra and Nagar Haveli and Daman and Diu",
    aliases: ["DN", "DH", "Dadra and Nagar Haveli & Daman and Diu"],
  },
  { code: "07", name: "Delhi", aliases: ["DL", "NCT of Delhi", "New Delhi"] },
  { code: "30", name: "Goa", aliases: ["GA"] },
  { code: "24", name: "Gujarat", aliases: ["GJ"] },
  { code: "06", name: "Haryana", aliases: ["HR"] },
  { code: "02", name: "Himachal Pradesh", aliases: ["HP"] },
  { code: "01", name: "Jammu and Kashmir", aliases: ["JK", "Jammu & Kashmir"] },
  { code: "20", name: "Jharkhand", aliases: ["JH"] },
  { code: "29", name: "Karnataka", aliases: ["KA"] },
  { code: "32", name: "Kerala", aliases: ["KL"] },
  { code: "38", name: "Ladakh", aliases: ["LA"] },
  { code: "31", name: "Lakshadweep", aliases: ["LD"] },
  { code: "23", name: "Madhya Pradesh", aliases: ["MP"] },
  { code: "27", name: "Maharashtra", aliases: ["MH"] },
  { code: "14", name: "Manipur", aliases: ["MN"] },
  { code: "17", name: "Meghalaya", aliases: ["ML"] },
  { code: "15", name: "Mizoram", aliases: ["MZ"] },
  { code: "13", name: "Nagaland", aliases: ["NL"] },
  { code: "21", name: "Odisha", aliases: ["OD", "OR", "Orissa"] },
  { code: "34", name: "Puducherry", aliases: ["PY", "Pondicherry"] },
  { code: "03", name: "Punjab", aliases: ["PB"] },
  { code: "08", name: "Rajasthan", aliases: ["RJ"] },
  { code: "11", name: "Sikkim", aliases: ["SK"] },
  { code: "33", name: "Tamil Nadu", aliases: ["TN"] },
  { code: "36", name: "Telangana", aliases: ["TS", "TG"] },
  { code: "16", name: "Tripura", aliases: ["TR"] },
  { code: "09", name: "Uttar Pradesh", aliases: ["UP"] },
  { code: "05", name: "Uttarakhand", aliases: ["UK", "UT", "Uttaranchal"] },
  { code: "19", name: "West Bengal", aliases: ["WB"] },
] as const;
export function indiaStateCode(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/^IN-/i, "")
    .replaceAll("&", "and")
    .replace(/\s+/g, " ")
    .toLowerCase();
  return (
    indiaStates.find((state) =>
      [state.code, state.name, ...state.aliases].some(
        (candidate) =>
          candidate.toLowerCase() === normalized ||
          (/^\d{1,2}$/.test(normalized) &&
            state.code === normalized.padStart(2, "0")),
      ),
    )?.code ?? null
  );
}
/** Syntax and check digit only; this does not query GST registration or eligibility. */
export function validGstin(value: string): boolean {
  if (
    !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value) ||
    !indiaStateCode(value.slice(0, 2))
  )
    return false;
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0,
    factor = 2;
  for (let index = 13; index >= 0; index--) {
    const product = alphabet.indexOf(value[index]) * factor;
    sum += Math.floor(product / 36) + (product % 36);
    factor = factor === 2 ? 1 : 2;
  }
  return alphabet[(36 - (sum % 36)) % 36] === value[14];
}
