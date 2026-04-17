import { PrismaClient } from "@prisma/client";

// Singleton Prisma client. Next.js dev mode hot-reloads modules, which would
// otherwise spawn a new client (and connection pool) on every change and
// quickly exhaust Postgres's max_connections. The standard fix is to stash
// the instance on globalThis in non-production environments.

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
