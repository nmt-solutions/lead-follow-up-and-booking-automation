# Issue tracker: GitHub

Issues and specs live in `Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation`. Use the `gh` CLI from this repository.

## Conventions

- Before the first issue write of a session, verify the target with `gh repo view --json nameWithOwner`. File issues only in this project's repository.
- Create: `gh issue create --title "..." --body-file <file>`.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels,assignees`; add label filters as needed.
- Comment: `gh issue comment <number> --body-file <file>`. Use UTF-8 files with actual newlines for multiline bodies.
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: post the explanation as a separate comment, then run `gh issue close <number>`.
- Sub-issues: `gh issue create --parent <parent> ...` or `gh issue edit <parent> --add-sub-issue <child>`. If unavailable, link the child in the parent's task list and put `Part of #<parent>` in the child body.
- Dependencies: `gh issue edit <child> --add-blocked-by <blocker>`. If unavailable, put `Blocked by: #<number>` at the top of the child body. Work starts when all blockers are closed.
- Count open native blockers: `gh api repos/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/<number> --jq .issue_dependencies_summary.blocked_by`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill operations

- "Publish to the issue tracker" means create a GitHub issue; "fetch the relevant ticket" means read the issue and its comments.
- Wayfinding maps use `wayfinder:map`; child tickets use `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task` and link to the map as sub-issues.
- A map holds Notes, Decisions-so-far, and Fog. Pick the first open, unassigned child in map order whose blockers are closed, and claim it with `gh issue edit <number> --add-assignee "@me"`.
- Resolve a wayfinding ticket by commenting with the answer, closing it, and adding a summary and link to the map's Decisions-so-far.
