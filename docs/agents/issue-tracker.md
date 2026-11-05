# Issue tracker: GitHub

Issues and specs live in `Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation`. Use the `gh` CLI from this repository.

## Conventions

- Before the first issue write of a session, verify the target with `gh repo view --json nameWithOwner`. File issues only in this project's repository.
- Create: `gh issue create --title "..." --body-file <file>`.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels,assignees`; add label filters as needed.
- Comment: `gh issue comment <number> --body-file <file>`. Use UTF-8 files with actual newlines for multiline bodies.
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: reserved for user acceptance; implementation alone ends at `in-test`. If the user explicitly asks you to close an accepted issue, post the explanation as a separate comment, then run `gh issue close <number>`.
- Sub-issues: `gh issue create --parent <parent> ...` or `gh issue edit <parent> --add-sub-issue <child>`. If unavailable, link the child in the parent's task list and put `Part of #<parent>` in the child body.
- Dependencies: `gh issue edit <child> --add-blocked-by <blocker>`. Preserve native relationships even after a prerequisite reaches `in-test`; they record the dependency, while the readiness rules below determine whether implementation can proceed. If native dependencies are unavailable, use a `Blocked by: #<number>` fallback.
- Count open native blockers: `gh api repos/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/<number> --jq .issue_dependencies_summary.blocked_by`. This is GitHub's raw count, not the implementation readiness decision.

## Dependency readiness

`in-test` means the AI implementation, required database changes, automated checks, review and push are complete. Human testing happens later. This status satisfies a prerequisite for dependent implementation while user acceptance remains pending.

Before starting dependent work, inspect each prerequisite's state and labels using `gh api repos/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/<number>/dependencies/blocked_by`. Also fetch any prerequisites recorded in the body's `Implementation prerequisites` section or a `Blocked by:` fallback.

- A prerequisite marked `rework` blocks dependent implementation until corrected and returned to `in-test`; this takes precedence over stale completion labels or state.
- Otherwise, a prerequisite that is closed or labelled `in-test` or `done` is satisfied for implementation.
- Any other unresolved prerequisite remains blocking. Start when every prerequisite is satisfied.

Keep native blocking relationships visible for traceability. GitHub's native Blocked badge follows issue closure rather than these lifecycle labels, so an open `in-test` prerequisite can still produce a Blocked badge or positive raw blocker count. This display does not block agent implementation when the readiness rules are satisfied. Preserve the relationship and the prerequisite's open state; do not remove links or close issues to clear the badge.

Body sections named `Implementation prerequisites` and `Implementation dependents` may supplement native relationships with `- #<number>` references. Preserve these mentions and the native links. These readiness rules override generic skill filters that require every blocker to be closed.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Implementation handoff and user acceptance

Use the lifecycle labels in [triage labels](triage-labels.md). The user owns UI validation and acceptance.

1. Preserve the issue's agreed acceptance criteria. Clarify or supplement them only when a necessary testable requirement is missing or ambiguous; retain the original scope and identify the clarification. Sufficient criteria need no rewrite. Implementation limitations remain limitations, rather than weaker acceptance criteria.
2. Complete the implementation, required database changes, automated checks, code review, commit and push. UI/browser validation is performed by the user; it is not an agent completion gate. Follow [frontend guidance](frontend.md) for the existing UI standards.
3. Add a concise handoff comment with the commit, automated check and database results, known limitations, and manual workflow steps with expected outcomes for the user to test against the criteria. Identify UI validation and user acceptance as pending; automated results do not establish human acceptance.
4. Leave the issue **open**, add `in-test`, and remove `ready-for-agent`, `rework` and `done` when present. Preserve its native dependency relationships. Do not close the issue or mark it `done` after implementation.
5. The user either accepts it by applying `done` and closing it, or requests changes by applying `rework`, keeping/reopening it and recording failing steps with expected and actual results. Clear the previous lifecycle label. Labels and GitHub's open/closed state are maintained manually.

Continue dependent work within the user's authorized implementation scope as soon as its prerequisites satisfy the readiness rules. `in-test` does not require another approval or a pause. A label change alone does not authorize an unrequested implementation or rework round. When asked to pause after the current implementation, finish its handoff and wait.

## Skill operations

- "Publish to the issue tracker" means create a GitHub issue; "fetch the relevant ticket" means read the issue and its comments.
- Wayfinding maps use `wayfinder:map`; child tickets use `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task` and link to the map as sub-issues.
- A map holds Notes, Decisions-so-far, and Fog. Pick the first open, unassigned child in map order whose prerequisites satisfy the dependency readiness rules, and claim it with `gh issue edit <number> --add-assignee "@me"`.
- Resolve a wayfinding ticket by commenting with the answer, closing it, and adding a summary and link to the map's Decisions-so-far.
