# Prisma

Postgres schema for Fashion For Everyone.

## First-time setup

```bash
# 1. Set DATABASE_URL (and optionally DIRECT_URL) in .env — see ../.env.example
# 2. Generate the client and apply the initial migration:
pnpm dlx prisma migrate dev --name init
# 3. Inspect with:
pnpm dlx prisma studio
```

If you only want to (re)generate the client (e.g. after pulling fresh code):

```bash
pnpm dlx prisma generate
```

## Production deploys

```bash
pnpm dlx prisma migrate deploy
```

## Postgres extensions

The schema uses `citext` (case-insensitive email/username uniqueness) and
`pgcrypto` (available on most managed Postgres). They are declared in
`schema.prisma` under `datasource.extensions` and Prisma will create them on
`migrate dev` when the connecting role has CREATE EXTENSION privilege. On
Supabase / Neon / RDS this works out of the box; on locked-down hosts you may
need to pre-create them as a superuser:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```
