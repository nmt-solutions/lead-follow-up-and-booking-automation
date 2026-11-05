import { z } from "zod";
export const securityStatusSchema = z.object({
  email: z.email(),
  enrolled: z.boolean(),
  required: z.boolean(),
  verified: z.boolean(),
  readiness: z.enum(["mfa-satisfied", "mfa-incomplete"]),
  operatorVerified: z.boolean(),
  operator: z.boolean(),
});
export type SecurityStatus = z.infer<typeof securityStatusSchema>;
export const enrollmentSchema = z.object({
  method: z.literal("totp"),
  totpURI: z.string().startsWith("otpauth://"),
  backupCodes: z.array(z.string()),
});
export const recoveryCodesSchema = z.object({
  backupCodes: z.array(z.string()),
});
