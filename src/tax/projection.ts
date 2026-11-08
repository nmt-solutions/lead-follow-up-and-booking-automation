import type { TaxCalculation } from "../models/tax";

/** Customer transaction basis; the complete evaluation history stays private. */
export function publicTaxCalculation<
  T extends Pick<TaxCalculation, "configuration" | "lines">,
>(tax: T): T {
  const revisions = new Set(tax.lines.map((line) => line.rule.revision.id));
  const decisions = new Set(tax.lines.map((line) => line.rule.approval.id));
  return {
    ...tax,
    configuration: {
      revisions: tax.configuration.revisions.filter((rule) =>
        revisions.has(rule.id),
      ),
      decisions: tax.configuration.decisions.filter((decision) =>
        decisions.has(decision.id),
      ),
    },
  };
}
