import { z } from "zod";

const shortText = z.string().trim().max(200);
export const addressSchema = z.strictObject({
  street: z.string().trim().max(500),
  locality: shortText,
  region: shortText,
  postalCode: z.string().trim().max(40),
  country: shortText,
});
export const buyerCategorySchema = z
  .strictObject({
    label: z.string().trim().min(1, "Enter a buyer category name.").max(200),
    identity: z.enum(["organization", "sole_proprietor", "individual"]),
    use: z.enum(["business_end_user", "reseller", "personal_use"]),
    requiresBuyingRequest: z.boolean(),
  })
  .superRefine((buyer, context) => {
    if (
      buyer.use === "personal_use" &&
      (buyer.identity !== "individual" || !buyer.requiresBuyingRequest)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Personal-use consumers require an explicit public buying request and individual identity.",
      });
    }
    if (buyer.identity === "individual" && buyer.use !== "personal_use") {
      context.addIssue({
        code: "custom",
        message: "Use sole proprietor or organization for business purchasing.",
      });
    }
  });
const marketSchema = z.string().trim().min(1, "Enter a market.").max(200);
export const configurationDetailsSchema = z.strictObject({
  specifications: z.string().trim().max(4000),
  minimumOrder: z.string().trim().max(500),
  deliveryConstraints: z.string().trim().max(2000),
  serviceConstraints: z.string().trim().max(2000),
  address: addressSchema,
  additionalMarkets: z.array(marketSchema).max(30),
  buyerCategories: z
    .array(buyerCategorySchema)
    .min(1, "Add at least one buyer category.")
    .max(30),
  exclusions: z.array(z.string().trim().min(1).max(300)).max(50),
});
export const configurationInputSchema = configurationDetailsSchema
  .extend({
    offering: z
      .string()
      .trim()
      .min(1, "Describe your products or services.")
      .max(4000),
    homeMarket: marketSchema,
    homeMarketConfirmed: z.literal(true),
    buyersReviewed: z.literal(true),
  })
  .superRefine((configuration, context) => {
    const markets = [
      configuration.homeMarket,
      ...configuration.additionalMarkets,
    ].map((value) => value.toLocaleLowerCase("en-US"));
    if (new Set(markets).size !== markets.length)
      context.addIssue({
        code: "custom",
        path: ["additionalMarkets"],
        message:
          "List each market once; additional markets must differ from Home market.",
      });
    const buyers = configuration.buyerCategories.map(
      (buyer) =>
        `${buyer.label.toLocaleLowerCase("en-US")}:${buyer.identity}:${buyer.use}`,
    );
    if (new Set(buyers).size !== buyers.length)
      context.addIssue({
        code: "custom",
        path: ["buyerCategories"],
        message: "List each buyer category once.",
      });
  });
export const savedConfigurationSchema = configurationDetailsSchema.extend({
  homeMarketConfirmedAt: z.iso.datetime().nullable(),
  buyersReviewedAt: z.iso.datetime().nullable(),
});
export type ConfigurationInput = z.infer<typeof configurationInputSchema>;
export type SavedConfiguration = z.infer<typeof savedConfigurationSchema>;
export type BuyerCategory = z.infer<typeof buyerCategorySchema>;

export function confirmedConfiguration(
  input: ConfigurationInput,
  at: Date,
): SavedConfiguration {
  const {
    offering,
    homeMarket,
    homeMarketConfirmed,
    buyersReviewed,
    ...details
  } = input;
  void offering;
  void homeMarket;
  return {
    ...details,
    homeMarketConfirmedAt: homeMarketConfirmed ? at.toISOString() : null,
    buyersReviewedAt: buyersReviewed ? at.toISOString() : null,
  };
}

// Industry-neutral starting points. These are suggestions, never selected targeting.
export const buyerSuggestions: readonly BuyerCategory[] = [
  {
    label: "Organizations buying for business use",
    identity: "organization",
    use: "business_end_user",
    requiresBuyingRequest: false,
  },
  {
    label: "Sole proprietors buying for business use",
    identity: "sole_proprietor",
    use: "business_end_user",
    requiresBuyingRequest: false,
  },
  {
    label: "Retailers and distributors",
    identity: "organization",
    use: "reseller",
    requiresBuyingRequest: false,
  },
];

export function suggestHomeMarket(
  address: z.infer<typeof addressSchema>,
): string | null {
  if (!address.country.trim()) return null;
  const suggestion = [address.locality, address.region, address.country]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(", ");
  return suggestion.length <= 200 ? suggestion : null;
}
