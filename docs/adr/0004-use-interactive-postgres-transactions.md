# Use one interactive PostgreSQL access and migration stack

Use Drizzle ORM and Drizzle Kit with node-postgres for the Next.js application and Trigger workers, preserving interactive transaction support on the selected Node runtimes. Runtime traffic uses Neon's pooled endpoint, while migrations use a direct connection; Business context and protected queries belong in the same transaction under an appropriate database role. This favors one reviewed SQL/migration path over mixing HTTP-batch and interactive transaction assumptions across authentication and tenant data access.
