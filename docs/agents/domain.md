# Domain docs

## Before exploring

Read the root `GLOSSARY.md` and any relevant decisions in `docs/adr/`.

If these files do not exist, proceed silently. The `domain-modeling` skill creates them when terminology or decisions are resolved.

## Layout

This repository uses one domain context:

- `GLOSSARY.md`: shared terms at the repository root.
- `docs/adr/`: architecture decision records, numbered `0001-<decision>.md`.

## Vocabulary and decisions

Use the glossary's terms when naming domain concepts in code, issues, tests, and explanations. Note unresolved terminology gaps for `domain-modeling`.

When a proposal conflicts with an ADR, identify the ADR and explain why the decision should be reopened.
