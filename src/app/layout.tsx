import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Business profile", template: "%s · Business profile" },
  description: "Keep your Business profile private and ready to return to.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
