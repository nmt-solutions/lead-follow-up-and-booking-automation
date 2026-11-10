"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  Folder,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  Mail,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  BarChart3,
  CalendarDays,
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
  DropdownMenuGroup,
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
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./ui/command";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Separator } from "./ui/separator";
import { Button } from "./ui/button";

export type NavigationBusiness = {
  id: string;
  name: string;
  canManage: boolean;
  canManageAi: boolean;
};
type Item = {
  path: string;
  label: string;
  icon: typeof Search;
  manage?: boolean;
  ai?: boolean;
};
const work: Item[] = [
  { path: "", label: "Overview", icon: LayoutDashboard },
  { path: "/discovery", label: "Find prospects", icon: Search },
  { path: "/inbox", label: "Conversations", icon: Inbox },
  { path: "/campaigns", label: "Outreach", icon: Send },
  { path: "/reports", label: "Reports", icon: BarChart3 },
  { path: "/ai", label: "AI assistant", icon: Sparkles, ai: true },
];
const resources: Item[] = [
  { path: "/knowledge", label: "Business knowledge", icon: BookOpen },
  { path: "/files", label: "Files", icon: Folder },
];
const connections: Item[] = [
  { path: "/mailboxes", label: "Email accounts", icon: Mail },
  { path: "/calendar", label: "Calendar", icon: CalendarDays, manage: true },
];
const settings: Item[] = [
  { path: "/configuration", label: "Business setup", icon: Settings2 },
  { path: "/profile", label: "Business profile", icon: Building2 },
  { path: "/whatsapp", label: "WhatsApp", icon: Inbox, manage: true },
  { path: "/senders", label: "Advanced sending", icon: Send },
  { path: "/team", label: "Team members", icon: Users, manage: true },
  {
    path: "/commercial-authority",
    label: "Sales approval rules",
    icon: ShieldCheck,
    manage: true,
  },
  { path: "/email-eligibility", label: "Email permissions", icon: ShieldCheck },
  {
    path: "/sender-health",
    label: "Email delivery health",
    icon: Mail,
    manage: true,
  },
  { path: "/notifications", label: "Notifications", icon: Inbox },
  { path: "/billing", label: "Billing details", icon: Wallet, manage: true },
  {
    path: "/plan",
    label: "Plan & billing",
    icon: Wallet,
    manage: true,
  },
  {
    path: "/subscription-quotes",
    label: "Subscription quotes",
    icon: FileText,
    manage: true,
  },
  {
    path: "/seller-documents",
    label: "Invoices",
    icon: FileText,
    manage: true,
  },
  {
    path: "/reach-changes",
    label: "Search coverage",
    icon: Search,
    manage: true,
  },
  {
    path: "/financial-adjustments",
    label: "Refunds and disputes",
    icon: Wallet,
    manage: true,
  },
  { path: "/tax", label: "Tax details", icon: FileText, manage: true },
  { path: "/pilots", label: "Paid pilot", icon: CalendarDays, manage: true },
  { path: "/operations", label: "Activity and recovery", icon: FileText },
  { path: "/data", label: "Export or remove data", icon: Folder },
];
function Navigation({
  businesses,
  email,
  children,
}: {
  businesses: NavigationBusiness[];
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile, state: sidebarState, isMobile } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  const business = businesses.find(
    (item) =>
      pathname === `/businesses/${item.id}` ||
      pathname.startsWith(`/businesses/${item.id}/`),
  );
  const base = business ? `/businesses/${business.id}` : "";
  const visible = (item: Item) =>
    (!item.manage || business?.canManage) &&
    (!item.ai || business?.canManageAi);
  const current = [...work, ...connections, ...resources, ...settings].find(
    (item) =>
      item.path &&
      (pathname === base + item.path ||
        pathname.startsWith(base + item.path + "/")),
  );
  const title = business
    ? (current?.label ?? "Overview")
    : pathname === "/businesses/new"
      ? "Business setup"
      : pathname === "/security"
        ? "Account security"
        : pathname.startsWith("/platform")
          ? "Platform administration"
          : "Your businesses";
  const close = () => setOpenMobile(false);
  const navigate = (href: string) => {
    setSearchOpen(false);
    close();
    router.push(href);
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  if (
    pathname === "/businesses/new" ||
    (pathname === "/businesses" && !businesses.length)
  )
    return (
      <div className="min-w-0 flex-1">
        <header className="glass-chrome mx-3 mt-3 flex items-center justify-between gap-4 rounded-[22px] px-5 py-3 sm:mx-6 sm:mt-4">
          <Link href="/" aria-label="Lead Relay home">
            <Brand />
          </Link>
          <Button variant="outline" asChild>
            <Link href="/businesses">Exit setup</Link>
          </Button>
        </header>
        <main id="main-content" className="px-5 py-8 sm:px-10">
          {children}
        </main>
      </div>
    );
  function menu(items: Item[]) {
    return (
      <SidebarMenu>
        {items.filter(visible).map((item) => {
          const href = base + item.path;
          const active = item.path
            ? pathname === href || pathname.startsWith(href + "/")
            : pathname === base;
          return (
            <SidebarMenuItem key={item.path}>
              <SidebarMenuButton asChild isActive={active}>
                <Link
                  href={href}
                  onClick={close}
                  aria-current={active ? "page" : undefined}
                >
                  <item.icon aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.ai && (
                    <span className="ml-auto text-[0.65rem] text-primary">
                      AI
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    );
  }
  return (
    <>
      <Sidebar
        collapsible="offcanvas"
        variant="floating"
        className="p-3 pr-0 [&_[data-slot=sidebar-inner]]:glass-chrome [&_[data-slot=sidebar-inner]]:rounded-[22px]"
      >
        <SidebarHeader className="gap-6 px-4 pb-4 pt-5">
          <div className="flex items-center justify-between gap-2">
            <Link
              className="min-w-0"
              href="/businesses"
              aria-label="Lead Relay home"
              onClick={close}
            >
              <Brand />
            </Link>
            <SidebarTrigger
              className="size-11 shrink-0"
              aria-label="Close sidebar"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-start gap-3 px-3 text-left"
              >
                <Avatar className="size-7 rounded-md">
                  <AvatarFallback className="rounded-md text-xs">
                    {business?.name.slice(0, 2).toUpperCase() || "B"}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {business?.name || "Your businesses"}
                </span>
                <ChevronsUpDown data-icon="inline-end" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>Switch business</DropdownMenuLabel>
              <DropdownMenuGroup>
                {businesses.map((item) => (
                  <DropdownMenuItem key={item.id} asChild>
                    <Link href={`/businesses/${item.id}`} onClick={close}>
                      <Building2 aria-hidden="true" />
                      <span className="flex-1 truncate">{item.name}</span>
                      {item.id === business?.id && <Check aria-hidden="true" />}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link href="/businesses/new" onClick={close}>
                    <Plus aria-hidden="true" />
                    Add business
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/businesses" onClick={close}>
                    View all businesses
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-3"
            onClick={() => setSearchOpen(true)}
          >
            <Search data-icon="inline-start" aria-hidden="true" />
            <span className="flex-1 text-left">Go to a page</span>
            <kbd className="rounded border border-border px-1.5 py-0.5 text-[0.65rem] font-normal">
              Ctrl K
            </kbd>
          </Button>
        </SidebarHeader>
        <SidebarContent className="gap-4 px-3">
          {business ? (
            <>
              <SidebarGroup>
                <SidebarGroupLabel>Sales</SidebarGroupLabel>
                {menu(work)}
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel>Connections</SidebarGroupLabel>
                {menu(connections)}
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel>Resources</SidebarGroupLabel>
                {menu(resources)}
              </SidebarGroup>
              <SidebarGroup>
                <Collapsible
                  key={`${base}:${settings.some((item) => pathname === base + item.path || pathname.startsWith(base + item.path + "/"))}`}
                  defaultOpen={settings.some(
                    (item) =>
                      pathname === base + item.path ||
                      pathname.startsWith(base + item.path + "/"),
                  )}
                  className="group/settings"
                >
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton>
                      <Settings2 aria-hidden="true" />
                      <span>More settings</span>
                      <ChevronDown
                        className="ml-auto transition-transform group-data-[state=open]/settings:rotate-180"
                        aria-hidden="true"
                      />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-1 border-l border-border pl-2">
                    {menu(settings)}
                  </CollapsibleContent>
                </Collapsible>
              </SidebarGroup>
            </>
          ) : (
            <SidebarGroup>
              <SidebarGroupLabel>Businesses</SidebarGroupLabel>
              <SidebarMenu>
                {[
                  {
                    href: "/businesses",
                    label: "Your businesses",
                    icon: Building2,
                  },
                  {
                    href: "/businesses/new",
                    label: "Add business",
                    icon: Plus,
                  },
                ].map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href}
                    >
                      <Link href={item.href} onClick={close}>
                        <item.icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter className="gap-4 p-4">
          <Button asChild variant="ghost" className="w-full justify-start">
            <Link href="/getting-started">
              <BookOpen aria-hidden="true" />
              Getting started
            </Link>
          </Button>
          <Separator />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 px-1"
              >
                <Avatar className="size-8">
                  <AvatarFallback>
                    {email.slice(0, 1).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-xs">
                    {email || "Your account"}
                  </span>
                  <span className="block text-[0.65rem] text-muted-foreground">
                    Account and security
                  </span>
                </span>
                <ChevronsUpDown data-icon="inline-end" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-64">
              <DropdownMenuLabel>Your account</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link href="/security" onClick={close}>
                    <ShieldCheck aria-hidden="true" />
                    Account security
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/privacy-policy">Privacy policy</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/terms">Terms and conditions</Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <div className="px-1">
                <SignOut />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>
      <div className="min-w-0 flex-1">
        <header className="glass-chrome sticky top-3 z-20 mx-3 mt-3 flex min-h-17 items-center gap-3 rounded-[22px] px-4 sm:top-4 sm:mx-6 sm:mt-4 sm:px-5">
          {(isMobile || sidebarState === "collapsed") && (
            <SidebarTrigger className="size-11" aria-label="Open sidebar" />
          )}
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-2 text-xs"
          >
            <Link
              href={base || "/businesses"}
              className="hidden max-w-56 truncate text-muted-foreground sm:block"
            >
              {business?.name || "Lead Relay"}
            </Link>
            <ChevronRight
              className="hidden size-3 text-muted-foreground sm:block"
              aria-hidden="true"
            />
            <span className="truncate font-medium" aria-current="page">
              {title}
            </span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="icon">
              <Link
                href="/getting-started"
                aria-label="Help and getting started"
              >
                <HelpCircle aria-hidden="true" />
              </Link>
            </Button>
            {business?.canManageAi && (
              <Button
                asChild
                variant="outline"
                className="hidden sm:inline-flex"
              >
                <Link href={base + "/ai"}>
                  <Sparkles data-icon="inline-start" aria-hidden="true" />
                  AI assistant
                </Link>
              </Button>
            )}
          </div>
        </header>
        <main
          id="main-content"
          className="app-content px-4 py-7 sm:px-8 lg:px-10 lg:py-9"
        >
          {children}
        </main>
      </div>
      <CommandDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Go to a page"
        description="Find a Lead Relay page or switch your business."
      >
        <CommandInput
          aria-label="Search pages or businesses"
          placeholder="Search pages or businesses..."
        />
        <CommandList>
          <CommandEmpty>No matching pages.</CommandEmpty>
          {business && (
            <>
              <CommandGroup heading="Sales">
                {[...work, ...connections, ...resources]
                  .filter(visible)
                  .map((item) => (
                    <CommandItem
                      key={item.path}
                      onSelect={() => navigate(base + item.path)}
                    >
                      <item.icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </CommandItem>
                  ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Business settings">
                {settings.filter(visible).map((item) => (
                  <CommandItem
                    key={item.path}
                    onSelect={() => navigate(base + item.path)}
                  >
                    <item.icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          <CommandGroup heading="Businesses">
            {businesses.map((item) => (
              <CommandItem
                key={item.id}
                onSelect={() => navigate(`/businesses/${item.id}`)}
              >
                <Building2 aria-hidden="true" />
                {item.name}
              </CommandItem>
            ))}
            <CommandItem onSelect={() => navigate("/businesses/new")}>
              <Plus aria-hidden="true" />
              Add business
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Help">
            <CommandItem onSelect={() => navigate("/getting-started")}>
              <BookOpen aria-hidden="true" />
              Vendor getting-started guide
            </CommandItem>
            <CommandItem onSelect={() => navigate("/security")}>
              <ShieldCheck aria-hidden="true" />
              Account security
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
export function AppNavigation({
  defaultOpen = true,
  ...props
}: {
  businesses: NavigationBusiness[];
  email?: string;
  defaultOpen?: boolean;
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
      <SidebarProvider defaultOpen={defaultOpen}>
        <Navigation {...props} email={props.email ?? ""} />
      </SidebarProvider>
    </MotionConfig>
  );
}
