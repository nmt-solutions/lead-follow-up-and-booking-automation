# Lead Relay UI

The interface helps people identify their Business, understand their access and complete the next setup action. Its character comes from a NMT pale blue background, white glass panels, blue gradient actions, explicit status, and one translucent header. Product copy describes capabilities that exist.

## Theme

`src/app/globals.css` is the source of truth for light-only semantic colors, material opacity, radii, type, spacing and elevation. Use Tailwind semantic utilities; extend the global tokens when a new role is needed. The application stays light regardless of the operating system appearance preference.

- Surface: `background` for the page; `card` for readable data, forms and dialogs; `muted` for subordinate groups.
- Content: `foreground` and `muted-foreground`; `primary` for the main action and links; `success`, `warning` and `destructive` paired with text that names the state.
- Boundaries: `border` groups content; `input` identifies controls; `ring` supplies visible keyboard focus.
- Shape: control, group and panel radius tokens map to `rounded-lg`, `rounded-xl` and `rounded-2xl`. Elevation separates panels and modal overlays.
- Type: the same self-hosted fonts as NMT Solutions: Manrope for body and controls, Space Grotesk for headings, Geist for the wordmark, and Geist Mono only for keys and codes. Headings use medium weight and tracking of -0.045em; body text uses weight 450. Body 1rem, secondary 0.875rem, metadata 0.75rem. `page-title` supplies the responsive title scale and tracking.
- Rhythm: 0.25rem spacing grid, 1.5–2rem panel padding, 2rem section gaps, `page-container` for width and responsive gutters. Layouts wrap by available space and grow with text.

## Material

`glass-chrome` follows NMT's floating header: 77% white, a white edge, 28px blur, 22px corners, an inset highlight, and soft blue shadows. `glass-panel` follows its service cards: 83% white, a fine white edge, 19px corners, an inset highlight, and a subtle outline. Keep text and form fields readable; avoid nested blur. Buttons use NMT's blue gradient, 13px Space Grotesk text, 13px corners, and a pressed state.

Opaque fallback is automatic without backdrop-filter support, with reduced transparency, increased contrast or forced colors. Reduced motion removes transitions and animations. Browser conventions take precedence over native Apple navigation conventions.

## Components and flows

Reuse `src/components/ui`: shadcn Button, Field, FieldGroup, Input, Textarea, Label, NativeSelect, Select, DropdownMenu, Sidebar, Sheet, Skeleton, Card, Table, Empty, Alert and Badge; Radix-backed Checkbox, Tabs, Collapsible and AlertDialog preserve their keyboard and focus behavior. Use semantic links for navigation and buttons for commands. Native selects remain appropriate for short role lists.

Controls have 44px minimum height, visible focus, persistent labels and appropriate autocomplete/input mode. Validate external responses before using them. Keep one prominent task per section. Destructive security changes use AlertDialog with a named consequence and cancel action.

Status appears next to the affected action. Reserve alert semantics for errors and status semantics for completion. Preserve unsaved forms through expired sessions; link to Security when MFA is required. Loading, empty, denied, error and success states each explain a next action. Distinguish authenticator enrollment, current-session verification and overall production readiness.

## Navigation and setup

Use the shared shadcn sidebar and business dropdown. Keep sales actions separate from business settings. The sidebar groups sales actions, resources, and expandable business settings. The command menu searches available pages and businesses with Ctrl/Cmd K. The business landing page is an overview with recorded activity, recent conversations, and setup state; profile editing lives at `/businesses/[businessId]/profile`.

New business setup has four steps: business, customers, location, and review. Save the profile and confirmed configuration in one transaction. Customer types require explicit selection. Use the entered address as the default search area and offer a separate area only when the user needs it. Billing can prefill the same address, with an explicit review before saving legal details.

Account sign-up collects first and last name, Company or Personal account type, and a company name when applicable. These fields never grant roles. Email/password is the default sign-in method; magic links remain optional. Verify signup email using the native verification link so Better Auth preserves the chosen password. Authenticator verification uses one six-digit input and a recovery-code alternative. Enrollment renders its QR code locally, retains a manual setup key, and shows recovery codes only after verification. Password recovery uses an email link plus fresh MFA; saving a password revokes other sessions.

`/onboarding` is full screen without the app sidebar. After saving the business, `/onboarding/[businessId]` offers email, calendar, and first-search steps. Each is optional, with Skip for now and Set up later. A navigation-only cookie can resume a setup step; it never establishes access, consent, or search authorization. Fixed provider callbacks retain the onboarding context. Legacy calendar callbacks use an exact Business-bound onboarding return path. Small illustrations animate once per step and respect reduced motion. Search reuses saved product, customer, and geographic details, with explicit public-query and usage approval before starting. Unconfigured providers or search services explain how to continue later. Finish setup stays available from the Business overview.

Use Framer Motion for brief step changes, with reduced-motion support. The welcome illustration uses a lazy-loaded React Three Fiber scene with demand rendering and a fallback. Keep it out of forms and sales records. Route loading uses shared skeletons. Prospect searches, AI previews, and outreach use task tabs. Preserve form contents when changing tabs.

The public `/` landing page explains the product, includes a labeled interactive walkthrough, and links to sign-in. Public routes `/getting-started`, `/privacy-policy`, and `/terms` use the same fonts, logo, and controls. The vendor guide explains the implemented flow. Policies describe current capabilities without inventing retention periods, guaranteed results, free trials, or blanket permission to contact prospects.

## Review

Use both required design skills from `docs/agents/frontend.md`. Review the complete path at compact/desktop widths and 200% text size, by keyboard, in the light appearance and with accessibility preferences. Measure contrast from actual theme tokens against every surface they appear on; target 4.5:1 for ordinary text and 3:1 for control boundaries/focus. Record the measurements and verification limits with completion evidence.

## Consent-first connections

Email setup starts with Connect Google or Connect Microsoft. The server creates a reserved draft, requests read/send consent, and binds the verified provider address after callback. A successful new connection also creates its ordinary sales reply identity and route; it does not authorize first-contact campaigns. History stays off. Drafts and technical connection IDs stay out of the customer's normal view. Advanced processing/history controls are optional.

Calendars use a provider card, external consent, and one calendar choice. Ready connections collapse to the chosen calendar and an explicit Manage connection menu. Email and calendar grants remain separate. After operator registration, fixed OAuth callback URLs use short-lived callback-only cookies to route the existing single-use, actor/session-bound database state. Existing callback behavior stays active until the corresponding fixed-callback environment flag is enabled.
