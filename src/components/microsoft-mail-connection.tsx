"use client";
import { EmailConnection, type EmailConnectionProps } from "./email-connection";
export function MicrosoftMailConnection(props: EmailConnectionProps) {
  return <EmailConnection provider="microsoft" {...props} />;
}
