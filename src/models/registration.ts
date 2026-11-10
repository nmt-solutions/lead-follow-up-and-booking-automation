import { z } from "zod";

export const profileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    accountType: z.enum(["company", "personal"]),
    companyName: z.string().trim().max(120).default(""),
  })
  .superRefine((profile, ctx) => {
    if (profile.accountType === "company" && !profile.companyName)
      ctx.addIssue({
        code: "custom",
        path: ["companyName"],
        message: "Enter your company name.",
      });
  })
  .transform((profile) => ({
    ...profile,
    companyName: profile.accountType === "company" ? profile.companyName : "",
  }));

export type RegistrationProfile = z.infer<typeof profileSchema>;
export const passwordSchema = z.strictObject({
  password: z.string().min(12).max(128),
});
