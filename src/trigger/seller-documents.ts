import { productionCron } from "./cron";
import { schedules } from "@trigger.dev/sdk";
import { recoverSellerDocuments } from "../seller-documents/worker";

export const sellerDocumentRecovery = schedules.task({
  id: "recover-seller-documents",
  cron: productionCron(process.env.TRIGGER_SELLER_DOCUMENT_RECOVERY_CRON),
  retry: { maxAttempts: 3 },
  run: async () => {
    try {
      return await recoverSellerDocuments();
    } catch {
      throw new Error(
        "Seller document recovery failed. Review saved artifact status.",
      );
    }
  },
});
