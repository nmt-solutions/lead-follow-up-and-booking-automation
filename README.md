<img src="assets/icon.svg" width="64" height="64" alt="">

# LeadRelay

Discover prospects, manage sales conversations, and automate approved follow-ups
through to bookings and quotation requests.

See [the detailed business idea](docs/idea.md) for the customer profile, workflows, MVP, pricing hypotheses, and launch plan.

Created in [T3 Code](https://t3.codes).

## Application

The first flow supports email sign-in, private Business creation and profile editing.
See [local setup and deployment](docs/application-setup.md) for environment variables,
database roles, production migrations, tests and the remaining production activation requirements.
See [sending identities and reply readiness](docs/sending-identities.md) for sender setup, adapter evidence and the current mail integration limits.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
