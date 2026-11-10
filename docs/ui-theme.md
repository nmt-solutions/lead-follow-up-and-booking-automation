# LeadRelay UI

The interface helps people identify their Business, understand their access and complete the next setup action. Its character comes from a neutral page background, white content panels, NMT indigo actions, explicit status, and one translucent header. Product copy describes capabilities that exist.

## Theme

`src/app/globals.css` is the source of truth for light/dark semantic colors, material opacity, radii, type, spacing and elevation. Use Tailwind semantic utilities; extend the global tokens when a new role is needed. Components consume the same roles in both appearances.

- Surface: `background` for the page; opaque `card` for data, forms and dialogs; `muted` for subordinate groups.
- Content: `foreground` and `muted-foreground`; `primary` for the main action and links; `success`, `warning` and `destructive` paired with text that names the state.
- Boundaries: `border` groups content; `input` identifies controls; `ring` supplies visible keyboard focus.
- Shape: control, group and panel radius tokens map to `rounded-lg`, `rounded-xl` and `rounded-2xl`. Elevation separates panels and modal overlays.
- Type: the same self-hosted fonts as NMT Solutions: Manrope for body and controls, Space Grotesk for headings, Geist for the wordmark, and Geist Mono only for keys and codes. Headings use medium weight and tracking of -0.045em; body text uses weight 450. Body 1rem, secondary 0.875rem, metadata 0.75rem. `page-title` supplies the responsive title scale and tracking.
- Rhythm: 0.25rem spacing grid, 1.5–2rem panel padding, 2rem section gaps, `page-container` for width and responsive gutters. Layouts wrap by available space and grow with text.

## Material

`glass-chrome` belongs to functional navigation above scrolling content. Its high-opacity fill, restrained blur, fine edge and shallow shadow preserve hierarchy. Form, credential, record and dialog content stays opaque. Use one glass layer; avoid nested blurred surfaces.

Opaque fallback is automatic without backdrop-filter support, with reduced transparency, increased contrast or forced colors. Reduced motion removes transitions and animations. Browser conventions take precedence over native Apple navigation conventions.

## Components and flows

Reuse `src/components/ui`: shadcn Button, Field, FieldGroup, Input, Textarea, Label, NativeSelect, Select, DropdownMenu, Sidebar, Sheet, Skeleton, Card, Table, Empty, Alert and Badge; Radix-backed Checkbox, Tabs, Collapsible and AlertDialog preserve their keyboard and focus behavior. Use semantic links for navigation and buttons for commands. Native selects remain appropriate for short role lists.

Controls have 44px minimum height, visible focus, persistent labels and appropriate autocomplete/input mode. Validate external responses before using them. Keep one prominent task per section. Destructive security changes use AlertDialog with a named consequence and cancel action.

Status appears next to the affected action. Reserve alert semantics for errors and status semantics for completion. Preserve unsaved forms through expired sessions; link to Security when MFA is required. Loading, empty, denied, error and success states each explain a next action. Distinguish authenticator enrollment, current-session verification and overall production readiness.

## Navigation and setup

Use the shared shadcn sidebar and business dropdown. Keep sales actions separate from business settings. The sidebar groups sales actions, resources, and expandable business settings. The command menu searches available pages and businesses with Ctrl/Cmd K. The business landing page is an overview with recorded activity, recent conversations, and setup state; profile editing lives at `/businesses/[businessId]/profile`.

New business setup has four steps: business, customers, location, and review. Save the profile and confirmed configuration in one transaction. Customer types require explicit selection. Use the entered address as the default search area and offer a separate area only when the user needs it. Billing can prefill the same address, with an explicit review before saving legal details.

Use Framer Motion for brief step changes, with reduced-motion support. The welcome illustration uses a lazy-loaded React Three Fiber scene with demand rendering and a fallback. Keep it out of forms and sales records. Route loading uses shared skeletons. Prospect searches, AI previews, and outreach use task tabs. Preserve form contents when changing tabs.

Public routes `/getting-started`, `/privacy-policy`, and `/terms` use the same fonts, logo, and controls. The vendor guide explains the implemented flow. Policies describe current capabilities without inventing retention periods, guaranteed results, free trials, or blanket permission to contact prospects.

## Review

Use both required design skills from `docs/agents/frontend.md`. Review the complete path at compact/desktop widths and 200% text size, by keyboard, in both appearances and with accessibility preferences. Measure contrast from actual theme tokens against every surface they appear on; target 4.5:1 for ordinary text and 3:1 for control boundaries/focus. Record the measurements and verification limits with completion evidence.
