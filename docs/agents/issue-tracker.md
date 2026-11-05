# Issue tracker: GitHub

Issues and specs live in `Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation`. Use the `gh` CLI from this repository.

## Conventions

- Before the first issue write of a session, verify the target with `gh repo view --json nameWithOwner`. File issues only in this project's repository.
- Create: `gh issue create --title "..." --body-file <file>`.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels,assignees`; add label filters as needed.
- Comment: `gh issue comment <number> --body-file <file>`. Use UTF-8 files with actual newlines for multiline bodies.
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: after implementation, database changes, automated checks, review and push, post the handoff as a separate comment, add `done`, then run `gh issue close <number> --reason completed`. Human verification is tracked separately by `tested`.
- Sub-issues: `gh issue create --parent <parent> ...` or `gh issue edit <parent> --add-sub-issue <child>`. If unavailable, link the child in the parent's task list and put `Part of #<parent>` in the child body.
- Dependencies: `gh issue edit <child> --add-blocked-by <blocker>`. Preserve native relationships after implementation and closure; they record the dependency, while the readiness rules below determine whether implementation can proceed. If native dependencies are unavailable, use a `Blocked by: #<number>` fallback.
- Count open native blockers: `gh api repos/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/<number> --jq .issue_dependencies_summary.blocked_by`. This is GitHub's raw count, not the implementation readiness decision.

## Dependency readiness

`done` and closed means the AI implementation, required database changes, automated checks, review and push are complete. Human testing happens later and is recorded with the separate `tested` label. A completed prerequisite satisfies dependent implementation even without `tested`. Legacy `in-test` issues also represent completed AI implementation; migrate them to `done` and closed.

Before starting dependent work, inspect each prerequisite's state and labels using `gh api repos/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/<number>/dependencies/blocked_by`. Also fetch any prerequisites recorded in the body's `Implementation prerequisites` section or a `Blocked by:` fallback.

- A prerequisite marked `rework` blocks dependent implementation until corrected and completed again; this takes precedence over `done`, `tested` and closed state.
- Otherwise, a prerequisite that is closed or labelled `in-test` or `done` is satisfied for implementation.
- Any other unresolved prerequisite remains blocking. Start when every prerequisite is satisfied.

Keep native blocking relationships visible for traceability. Closing an implemented prerequisite naturally resolves its native Blocked badge. A legacy open `in-test` prerequisite can still produce a positive raw blocker count while satisfying implementation readiness. A closed prerequisite marked `rework` remains blocking under these rules even if GitHub does not show a native block. Use the individual states and labels; preserve the links.

Body sections named `Implementation prerequisites` and `Implementation dependents` may supplement native relationships with `- #<number>` references. Preserve these mentions and the native links. These readiness rules override generic skill filters that require every blocker to be closed.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Implementation handoff and user acceptance

Use the labels in [triage labels](triage-labels.md). Implementation completion and human verification are separate. The user owns UI validation and acceptance.

1. Preserve the issue's agreed acceptance criteria. Clarify or supplement them only when a necessary testable requirement is missing or ambiguous; retain the original scope and identify the clarification. Sufficient criteria need no rewrite. Implementation limitations remain limitations, rather than weaker acceptance criteria.
2. Complete the implementation, required database changes, automated checks, code review, commit and push. UI/browser validation is performed by the user; it is not an agent completion gate. Follow [frontend guidance](frontend.md) for the existing UI standards.
3. Add a concise handoff comment with the commit, automated check and database results, known limitations, and manual workflow steps with expected outcomes for the user to test against the criteria. Identify UI validation and user acceptance as pending; automated results do not establish human acceptance.
4. Add `done`, remove `ready-for-agent`, `in-test` and resolved `rework` when present, and close the issue as **completed** after the separate handoff comment. Preserve native dependency relationships and acceptance criteria. Leave `tested` absent until the user verifies the implementation; automated tests and code review do not grant it.
5. The user finds completed issues without `tested` to test later. After successful testing, the user adds `tested`. If changes are needed, the user adds `rework` and records failing steps with expected and actual results; the issue may still be closed when feedback arrives.

At the next authorized iteration, include `gh issue list --state all --label rework --json number,title,state,body,labels,comments` so feedback on closed issues is visible. Reopen an issue when beginning its fix, clear `done` and stale `tested`, and use the same implementation/check/push/closure handoff after correction. A `rework` label is a change request within an ongoing authorized round; the user need not manually reopen the issue. Label edits alone do not launch an agent outside an authorized round.

Continue dependent work within the user's authorized implementation scope as soon as its prerequisites satisfy the readiness rules. Pending human testing and absence of `tested` do not require another approval or a pause. When asked to pause after the current implementation, finish its handoff and wait.

## Skill operations

- "Publish to the issue tracker" means create a GitHub issue; "fetch the relevant ticket" means read the issue and its comments.
- Wayfinding maps use `wayfinder:map`; child tickets use `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task` and link to the map as sub-issues.
- A map holds Notes, Decisions-so-far, and Fog. Pick the first open, unassigned child in map order whose prerequisites satisfy the dependency readiness rules, and claim it with `gh issue edit <number> --add-assignee "@me"`.
- Resolve a wayfinding ticket by commenting with the answer, closing it, and adding a summary and link to the map's Decisions-so-far.
