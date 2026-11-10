import { NextResponse } from "next/server";
import { isPlanId } from "@/content/plans";
import { siteOrigin } from "@/lib/public-site";
export function GET(request: Request) {
  const plan = new URL(request.url).searchParams.get("plan");
  const response = NextResponse.redirect(
    new URL("/sign-in?signup=1", siteOrigin),
  );
  // A navigation preference only. Every quote and paid allowance is verified server-side.
  if (isPlanId(plan))
    response.cookies.set("lr_plan", plan, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
    });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
