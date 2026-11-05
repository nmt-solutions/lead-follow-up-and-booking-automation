import { z } from "zod";
import { buyerCategorySchema } from "./configuration";
const text = z.string().trim().min(1).max(200);
export const briefSchema = z.strictObject({
  offering: z.string().max(4000),
  publicOffering: z.string().max(400),
  requirements: z.strictObject({
    specifications: z.string().max(4000),
    minimumOrder: z.string().max(500),
    deliveryConstraints: z.string().max(2000),
    serviceConstraints: z.string().max(2000),
  }),
  buyers: z.array(buyerCategorySchema).max(30),
  markets: z.array(text).max(30),
  exclusions: z.array(z.string().max(300)).max(50),
  homeMarket: z.string().max(200),
});
