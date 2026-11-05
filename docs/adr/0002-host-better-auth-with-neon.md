---
status: accepted
---

# Host Better Auth with Neon

Run the maintained Better Auth library inside the Next.js deployment using Neon PostgreSQL, accepting responsibility for auth configuration, updates, migrations, email delivery, and production rate limits. Use current-scope RBAC and add only plugins required by approved features, including MFA before privileged production access; enterprise SSO/SCIM remains deferred. This selects auth/plugin ownership over a managed identity service while keeping application hosting and PostgreSQL managed.
