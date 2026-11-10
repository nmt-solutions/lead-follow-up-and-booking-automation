"use client";
import { EmailConnection, type EmailConnectionProps } from "./email-connection";
export function GmailConnection(props: EmailConnectionProps) {
  return <EmailConnection provider="gmail" {...props} />;
}
