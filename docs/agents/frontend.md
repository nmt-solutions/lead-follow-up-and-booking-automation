# Frontend implementation

## Required stack

Use Next.js/React with **Tailwind CSS and shadcn/ui** for all website UI, including marketing pages and the application. Use Tailwind utilities, variants and shared theme tokens for styling, and compose/customize shadcn/ui components for controls and interaction primitives. Keep Tailwind's stylesheet entry point and shared token definitions centralized; use this styling system consistently rather than adding CSS Modules, CSS-in-JS, another CSS framework or another component kit.

Use semantic HTML and Tailwind for layout/content that does not need a shadcn component. Maintain shadcn's keyboard, focus, labeling and interaction behavior when customizing its components. Exact package versions and scaffold configuration are pinned when the application is created. [Tailwind with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [shadcn/ui with Next.js](https://ui.shadcn.com/docs/installation/next).

## Required skills

Before writing or changing frontend code, load and apply **both** skills:

- `apple-design`: interaction response, purposeful and interruptible motion, typography, materials and accessibility preferences.
- `apple-design-diwu`: design review, accessibility, layout, hierarchy and component/flow craft. Load its relevant reference pages before applying or citing a guideline, following the skill's reference-loading rules.

Resolve the skill names through the available skill catalog. The current local installations are `C:/Users/tauqu/.agents/skills/apple-design/SKILL.md` and `C:/Users/tauqu/.agents/skills/apple-design-diwu/SKILL.md`; their references are relative to those directories. If a path changes, locate the named skill before continuing frontend work rather than silently omitting it.

Apply their principles to the web, preserving browser conventions and shadcn behavior. Native Apple platform rules are not automatically web requirements. Use translucency and motion where they clarify interaction or hierarchy; provide reduced-motion, reduced-transparency and increased-contrast behavior where applicable.

## Completion

Review the changed flow with both skills before finishing. Verify responsive layout, text scaling, semantic labels, keyboard navigation, visible focus, measured contrast from actual tokens and relevant accessibility preferences. Check the affected loading, empty, error and success states, and interruptibility where motion exists. Report verification limits explicitly; do not claim a rendered or accessibility check that was not performed.
