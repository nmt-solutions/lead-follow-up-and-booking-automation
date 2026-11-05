import { AppShell } from "@/components/app-shell";
export default function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
