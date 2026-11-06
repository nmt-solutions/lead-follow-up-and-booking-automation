import type {
  AdjustDocument,
  DocumentSnapshot,
  SellerDocument,
} from "../models/seller-documents";
import { ApplicationError } from "../models/application-error";

function prorate(
  original: bigint,
  net: bigint,
  total: bigint,
  rounding: DocumentSnapshot["lines"][number]["rule"]["revision"]["rule"]["rounding"],
) {
  if (net === total) return original;
  const increment = BigInt(rounding.incrementMinor),
    denominator = total * increment,
    numerator = original * net;
  let units = numerator / denominator;
  const remainder = numerator % denominator;
  if (
    rounding.mode !== "down" &&
    (remainder * 2n > denominator ||
      (remainder * 2n === denominator &&
        (rounding.mode === "half_up" || units % 2n === 1n)))
  )
    units++;
  const rounded = units * increment;
  return rounded > original ? original : rounded;
}
/** Credit the change in cumulative ORIGINAL component allocation. Never recalculate current rates.
 * Full credit exhausts exactly the original line/component, including subtotal-rounding remainders. */
export function allocateCredit(
  original: SellerDocument,
  prior: SellerDocument[],
  input: AdjustDocument,
) {
  const cumulative: NonNullable<DocumentSnapshot["adjustment"]>["cumulative"] =
    [];
  const lines = input.lines.map((request) => {
    const line = original.snapshot.lines.find(
      (l) => l.input.id === request.lineId,
    );
    if (!line) throw new ApplicationError("CONFLICT");
    const previous = prior
      .flatMap((d) => d.snapshot.lines)
      .filter((l) => l.input.id === request.lineId);
    const netBefore = previous.reduce((s, l) => s + BigInt(l.netMinor), 0n),
      netAfter = netBefore + BigInt(request.netMinor),
      originalNet = BigInt(line.netMinor);
    if (netAfter > originalNet || originalNet === 0n)
      throw new ApplicationError("CONFLICT");
    const componentAllocation = line.components.map((c) => {
      const before = previous
        .flatMap((l) => l.components)
        .filter((p) => p.name === c.name)
        .reduce((s, p) => s + BigInt(p.amountMinor), 0n);
      const after = prorate(
        BigInt(c.amountMinor),
        netAfter,
        originalNet,
        line.rule.revision.rule.rounding,
      );
      if (after < before || after > BigInt(c.amountMinor))
        throw new ApplicationError("CONFLICT");
      return { name: c.name, before, after };
    });
    const components = componentAllocation.map((c) => ({
      name: c.name,
      amountMinor: String(c.after - c.before),
    }));
    const tax = components.reduce((s, c) => s + BigInt(c.amountMinor), 0n);
    cumulative.push({
      lineId: request.lineId,
      netBefore: String(netBefore),
      netAfter: String(netAfter),
      components: componentAllocation.map((c) => ({
        name: c.name,
        before: String(c.before),
        after: String(c.after),
      })),
    });
    return {
      ...line,
      netMinor: request.netMinor,
      taxMinor: String(tax),
      totalMinor: String(BigInt(request.netMinor) + tax),
      components,
    };
  });
  const totals = {
    netMinor: String(lines.reduce((s, l) => s + BigInt(l.netMinor), 0n)),
    taxMinor: String(lines.reduce((s, l) => s + BigInt(l.taxMinor), 0n)),
    totalMinor: String(lines.reduce((s, l) => s + BigInt(l.totalMinor), 0n)),
  };
  return { lines, totals, cumulative };
}
