import { NoSuchKey } from "@aws-sdk/client-s3";
import { ApplicationError } from "../models/application-error";

// The external object-store read boundary used by both retained and target copies.
export async function readRecoveryObject<T>(
  read: () => Promise<T>,
): Promise<T | null> {
  try {
    return await read();
  } catch (error: unknown) {
    if (error instanceof NoSuchKey) return null;
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("PROVIDER_UNAVAILABLE");
  }
}
