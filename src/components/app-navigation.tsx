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
const settings: Item[] = [
  { path: "/configuration", label: "Business setup", icon: Settings2 },
  { path: "/profile", label: "Business profile", icon: Building2 },
  { path: "/mailboxes", label: "Email inboxes", icon: Mail },
  {
    path: "/calendar",
    label: "Booking calendar",
    icon: CalendarDays,
    manage: true,
  },
  { path: "/whatsapp", label: "WhatsApp", icon: Inbox, manage: true },
  { path: "/senders", label: "Email senders", icon: Send },
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
    path: "/subscription-payments",
    label: "Subscription",
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
  const { setOpenMobile } = useSidebar();
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
  const current = [...work, ...resources, ...settings].find(
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
      <Sidebar collapsible="offcanvas" className="border-r border-border">
        <SidebarHeader className="gap-6 px-5 pb-4 pt-6">
          <Link href="/businesses" aria-label="LeadRelay home" onClick={close}>
            <Brand />
          </Link>
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
                      <span>Business settings</span>
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
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-4">
            <BookOpen className="size-5 text-primary" aria-hidden="true" />
            <p className="text-sm font-semibold">New to LeadRelay?</p>
            <p className="text-xs leading-5 text-muted-foreground">
              Set up your business and run your first search.
            </p>
            <Button asChild variant="outline" className="mt-1 w-full">
              <Link href="/getting-started">
                Read the vendor guide
                <ChevronRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </div>
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
        <header className="glass-chrome sticky top-0 z-20 flex min-h-17 items-center gap-4 border-x-0 border-t-0 px-4 shadow-none sm:px-8">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-2 text-xs"
          >
            <Link
              href={base || "/businesses"}
              className="hidden max-w-56 truncate text-muted-foreground sm:block"
            >
              {business?.name || "LeadRelay"}
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
        description="Find a LeadRelay page or switch your business."
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
                {[...work, ...resources].filter(visible).map((item) => (
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
