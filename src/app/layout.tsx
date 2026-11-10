import type { Metadata } from "next";
import localFont from "next/font/local";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/brand";
import "./globals.css";

const display = localFont({
  src: "./fonts/display.woff2",
  variable: "--font-nmt-display",
  weight: "300 700",
  display: "swap",
});
const body = localFont({
  src: "./fonts/body.woff2",
  variable: "--font-nmt-body",
  weight: "200 800",
  display: "swap",
});
const geist = localFont({
  src: "./fonts/geist.woff",
  variable: "--font-nmt-geist",
  weight: "100 900",
  display: "swap",
});
const mono = localFont({
  src: "./fonts/mono.woff",
  variable: "--font-nmt-mono",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://leadrelay.nmtsolutions.in"),
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${geist.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
