import Link from "next/link";
import type { ReactNode } from "react";

/** Keep the originating form and its uncertain request identity mounted. */
export function RecoveryLink({
  href,
  children,
  className = "underline",
}: {
  href: "/security" | "/sign-in";
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children} <span>(new tab)</span>
    </Link>
  );
}
