# Triage labels

Use this mapping whenever a skill names a triage role.

| Role            | Tracker label     | Meaning                                  |
| --------------- | ----------------- | ---------------------------------------- |
| needs-triage    | `needs-triage`    | Maintainer evaluation needed             |
| needs-info      | `needs-info`      | Waiting for more information             |
| ready-for-agent | `ready-for-agent` | Fully specified for agent implementation |
| ready-for-human | `ready-for-human` | Human implementation required            |
| wontfix         | `wontfix`         | Will not be actioned                     |

## Implementation lifecycle and human testing

These labels supplement the five triage roles. Implementation completion and human verification are separate.

| Label     | Issue state                                      | Set by                                              | Meaning                                                                                        |
| --------- | ------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `done`    | Closed as completed                              | Agent after implementation, checks, review and push | AI implementation complete; human testing may still be pending                                 |
| `tested`  | Usually closed                                   | User after testing                                  | The current implementation passed human verification; automated checks do not grant this label |
| `rework`  | Open or closed when reported; reopen for the fix | User                                                | Changes needed; record failed steps and expected/actual results                                |
| `in-test` | Legacy                                           | Agent migrates to `done` and closed                 | Previous AI-complete status; human testing is now tracked by `tested`                          |

Flow: `ready-for-agent` → `done` and closed, initially without `tested`. The user then adds `tested` after successful testing, or `rework` if changes are needed. During an authorized fix round, reopen the issue, clear `done` and stale `tested`, then return it to closed `done` after correction. It awaits fresh human testing again.

`done` and `tested` may coexist. `rework` takes precedence over completion labels and closed state, so inspect rework issues across all states. Preserve unrelated topic labels, native blocking relationships and prerequisite mentions. Pending human testing never blocks dependent implementation; apply the [dependency readiness rules](issue-tracker.md#dependency-readiness).

Follow [the implementation handoff](issue-tracker.md#implementation-handoff-and-user-acceptance) for evidence, acceptance criteria and ownership.
