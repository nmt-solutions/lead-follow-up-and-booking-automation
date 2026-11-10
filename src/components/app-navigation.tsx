"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Check,
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  LayoutDashboard,
  Plus,
  Search,
  Inbox,
  Send,
  BarChart3,
  Settings2,
  CreditCard,
  Users,
  Plug,
  Folder,
  ShieldCheck,
  Bell,
  SlidersHorizontal,
} from "lucide-react";
import { MotionConfig } from "framer-motion";
import { Brand } from "./brand";
import { SignOut } from "./sign-out";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Button } from "./ui/button";

export type NavigationBusiness = {
  id: string;
  name: string;
  canManage: boolean;
  canManageAi: boolean;
};
const sales = [
  { path: "", label: "Overview", icon: LayoutDashboard },
  { path: "/discovery", label: "Find prospects", icon: Search },
  { path: "/inbox", label: "Sales inbox", icon: Inbox },
  { path: "/campaigns", label: "Outreach", icon: Send },
  { path: "/reports", label: "Reports", icon: BarChart3 },
];
const settings = [
  { path: "/configuration", label: "Business setup", icon: Settings2 },
  { path: "/mailboxes", label: "Email inboxes", icon: Inbox },
  { path: "/calendar", label: "Booking calendar", icon: Plug },
  { path: "/whatsapp", label: "WhatsApp", icon: Plug },
  { path: "/senders", label: "Email senders", icon: Send },
  { path: "/knowledge", label: "Saved answers", icon: CircleHelp },
  { path: "/team", label: "Team", icon: Users },
  { path: "/billing", label: "Billing details", icon: CreditCard },
  { path: "/subscription-payments", label: "Subscription", icon: CreditCard },
  { path: "/seller-documents", label: "Invoices", icon: Folder },
];
const more = [
  { path: "/profile", label: "Business profile" },
  { path: "/notifications", label: "Notifications" },
  { path: "/files", label: "Files" },
  { path: "/operations", label: "Activity and recovery" },
  { path: "/email-eligibility", label: "Email permissions" },
  {
    path: "/commercial-authority",
    label: "Sales approval rules",
    manage: true,
  },
  { path: "/sender-health", label: "Email delivery health", manage: true },
  { path: "/subscription-quotes", label: "Subscription quotes", manage: true },
  { path: "/reach-changes", label: "Search coverage", manage: true },
  { path: "/pilots", label: "Paid pilot", manage: true },
  {
    path: "/financial-adjustments",
    label: "Refunds and disputes",
    manage: true,
  },
  { path: "/tax", label: "Tax details", manage: true },
  { path: "/data", label: "Export or remove data" },
];

function Navigation({
  businesses,
  children,
}: {
  businesses: NavigationBusiness[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const business = businesses.find(
    (item) =>
      pathname === `/businesses/${item.id}` ||
      pathname.startsWith(`/businesses/${item.id}/`),
  );
  const base = business ? `/businesses/${business.id}` : "";
  const current = [
    ...sales,
    ...settings,
    ...more,
    { path: "/ai", label: "AI settings" },
  ].find(
    (item) =>
      item.path &&
      (pathname === base + item.path ||
        pathname.startsWith(base + item.path + "/")),
  );
  const title = business
    ? (current?.label ?? "Overview")
    : pathname === "/businesses/new"
      ? "Add business"
      : pathname === "/security"
        ? "Security"
        : pathname.startsWith("/platform")
          ? "Platform administration"
          : "Your businesses";
  const close = () => setOpenMobile(false);
  return (
    <>
      <Sidebar variant="inset" collapsible="offcanvas">
        <SidebarHeader className="gap-5 p-4">
          <Link href="/businesses" onClick={close} aria-label="LeadRelay home">
            <Brand />
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-auto w-full justify-start gap-3 border-border bg-card p-3 text-left"
              >
                <Building2 className="size-5 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {business?.name ?? "Choose a business"}
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {business
                      ? "Switch business"
                      : `${businesses.length} available`}
                  </span>
                </span>
                <ChevronsUpDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-96 w-[var(--radix-dropdown-menu-trigger-width)] min-w-60 overflow-y-auto"
            >
              <DropdownMenuLabel>Your businesses</DropdownMenuLabel>
              {businesses.map((item) => (
                <DropdownMenuItem asChild key={item.id} className="min-h-11">
                  <Link onClick={close} href={`/businesses/${item.id}`}>
                    <Building2 aria-hidden="true" />
                    <span className="flex-1 truncate">{item.name}</span>
                    {business?.id === item.id && <Check aria-hidden="true" />}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="min-h-11">
                <Link href="/businesses/new" onClick={close}>
                  <Plus aria-hidden="true" />
                  Add business
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="min-h-11">
                <Link href="/businesses" onClick={close}>
                  View all businesses
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>
              {business ? "Sales" : "Get started"}
            </SidebarGroupLabel>
            <SidebarMenu>
              {(business
                ? sales
                : [
                    {
                      path: "/businesses",
                      label: "Your businesses",
                      icon: Building2,
                    },
                    {
                      path: "/businesses/new",
                      label: "Add business",
                      icon: Plus,
                    },
                  ]
              ).map((item) => {
                const href = business ? base + item.path : item.path;
                const active = business
                  ? item.path
                    ? pathname.startsWith(href)
                    : pathname === href
                  : pathname === href;
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link
                        href={href}
                        onClick={close}
                        aria-current={active ? "page" : undefined}
                      >
                        <item.icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
          {business && (
            <>
              <SidebarGroup>
                <SidebarGroupLabel>Manage business</SidebarGroupLabel>
                <SidebarMenu>
                  {settings
                    .filter(
                      (item) =>
                        business.canManage ||
                        [
                          "/configuration",
                          "/knowledge",
                          "/mailboxes",
                          "/senders",
                        ].includes(item.path),
                    )
                    .map((item) => (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          asChild
                          isActive={pathname.startsWith(base + item.path)}
                        >
                          <Link
                            href={base + item.path}
                            onClick={close}
                            aria-current={
                              pathname.startsWith(base + item.path)
                                ? "page"
                                : undefined
                            }
                          >
                            <item.icon aria-hidden="true" />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                </SidebarMenu>
              </SidebarGroup>
              <SidebarGroup>
                <Collapsible
                  defaultOpen={
                    more.some((item) => pathname === base + item.path) ||
                    pathname === base + "/ai"
                  }
                  className="group/more"
                >
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton>
                      <SlidersHorizontal aria-hidden="true" />
                      <span>More settings</span>
                      <ChevronRight
                        className="ml-auto transition-transform group-data-[state=open]/more:rotate-90"
                        aria-hidden="true"
                      />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenu className="mt-1 border-l border-border pl-3">
                      {more
                        .filter((item) => !item.manage || business.canManage)
                        .map((item) => (
                          <SidebarMenuItem key={item.path}>
                            <SidebarMenuButton
                              asChild
                              isActive={pathname === base + item.path}
                            >
                              <Link href={base + item.path} onClick={close}>
                                {item.label}
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      {business.canManageAi && (
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            asChild
                            isActive={pathname === base + "/ai"}
                          >
                            <Link href={base + "/ai"} onClick={close}>
                              AI settings
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )}
                    </SidebarMenu>
                  </CollapsibleContent>
                </Collapsible>
              </SidebarGroup>
            </>
          )}
        </SidebarContent>
        <SidebarFooter className="border-t border-border p-4">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/security"}>
                <Link href="/security" onClick={close}>
                  <ShieldCheck aria-hidden="true" />
                  <span>Account security</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="flex items-center justify-between gap-2">
            <a
              className="text-xs text-muted-foreground hover:text-primary"
              href="https://nmtsolutions.in"
              target="_blank"
              rel="noreferrer"
            >
              NMT Solutions
            </a>
            <SignOut />
          </div>
        </SidebarFooter>
      </Sidebar>
      <div className="min-w-0 flex-1 bg-background md:m-2 md:ml-0 md:rounded-2xl md:border md:border-border">
        <header className="glass-chrome sticky top-0 z-20 flex min-h-16 items-center gap-3 border-x-0 border-t-0 px-4 shadow-none sm:px-6 md:rounded-t-2xl">
          <SidebarTrigger />
          <span className="h-5 border-l border-border" aria-hidden="true" />
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-2 text-sm"
          >
            <Link
              href={base || "/businesses"}
              className="hidden max-w-52 truncate text-muted-foreground sm:block"
            >
              {business?.name ?? "LeadRelay"}
            </Link>
            <ChevronRight
              aria-hidden="true"
              className="hidden size-4 text-muted-foreground sm:block"
            />
            <span className="truncate font-medium" aria-current="page">
              {title}
            </span>
          </nav>
          {business && (
            <Button asChild variant="ghost" size="icon" className="ml-auto">
              <Link href={`${base}/notifications`} aria-label="Notifications">
                <Bell aria-hidden="true" />
              </Link>
            </Button>
          )}
        </header>
        <main
          id="main-content"
          className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-8 sm:py-10 lg:px-10"
        >
          {children}
        </main>
      </div>
    </>
  );
}

export function AppNavigation(props: {
  businesses: NavigationBusiness[];
  children: React.ReactNode;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-card p-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <SidebarProvider>
        <Navigation {...props} />
      </SidebarProvider>
    </MotionConfig>
  );
}
