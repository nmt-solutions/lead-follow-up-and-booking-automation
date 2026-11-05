import "server-only";
import { z } from "zod";
import { ApplicationError } from "../models/application-error";

const environmentSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
  BETTER_AUTH_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().min(1),
  AUTH_EMAIL_FROM: z.email(),
});

export function readEnvironment() {
  const parsed = environmentSchema.safeParse(process.env);
  if (!parsed.success) throw new ApplicationError("SETUP_REQUIRED");
  if (
    process.env.NODE_ENV === "production" &&
    !parsed.data.BETTER_AUTH_URL.startsWith("https://")
  )
    throw new ApplicationError("SETUP_REQUIRED");
  return parsed.data;
}
