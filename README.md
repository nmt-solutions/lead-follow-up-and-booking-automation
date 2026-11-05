<img src="assets/icon.svg" width="64" height="64" alt="">

# Lead Follow-up and Booking Automation

A managed automation business for turning inbound inquiries into qualified consultations.

See [the detailed business idea](docs/idea.md) for the customer profile, workflows, MVP, pricing hypotheses, and launch plan.

Created in [T3 Code](https://t3.codes).

## Application

The first flow supports email sign-in, private Business creation and profile editing.
See [local setup and deployment](docs/application-setup.md) for environment variables,
database roles, migrations, tests and the remaining production activation requirements.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
