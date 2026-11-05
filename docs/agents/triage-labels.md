# Triage labels

Use this mapping whenever a skill names a triage role.

| Role            | Tracker label     | Meaning                                  |
| --------------- | ----------------- | ---------------------------------------- |
| needs-triage    | `needs-triage`    | Maintainer evaluation needed             |
| needs-info      | `needs-info`      | Waiting for more information             |
| ready-for-agent | `ready-for-agent` | Fully specified for agent implementation |
| ready-for-human | `ready-for-human` | Human implementation required            |
| wontfix         | `wontfix`         | Will not be actioned                     |

## Implementation lifecycle

These statuses supplement the five triage roles; they do not replace them. Use at most one lifecycle label per issue.

| Label     | Issue state | Set by                                          | Meaning                                                                        |
| --------- | ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `in-test` | Open        | Agent after implementation and automated checks | Ready for the user's workflow/UI testing; acceptance is pending                |
| `rework`  | Open        | User                                            | Testing found changes needed; record failing steps and expected/actual results |
| `done`    | Closed      | User                                            | Implementation accepted after testing                                          |

Flow: `ready-for-agent` → `in-test` → `done`, or `in-test` → `rework` → `in-test` after an authorized fix round. Remove `ready-for-agent` at handoff and clear the previous lifecycle label on each transition. Preserve unrelated topic labels. Updating a label does not automatically change GitHub's open/closed state or start agent work.

Follow [the implementation handoff](issue-tracker.md#implementation-handoff-and-user-acceptance) for evidence, acceptance criteria and ownership.
