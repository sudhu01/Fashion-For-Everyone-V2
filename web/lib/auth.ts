import { auth, currentUser } from "@clerk/nextjs/server";
import type { User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { UnauthorizedError } from "@/lib/errors";

export interface AuthContext {
  userId: string;        // internal DB User.id (UUID)
  clerkId: string;       // Clerk's user id
  dbUser: User;
}

// Centralized auth helper for API routes.
//
// 1. Pulls the Clerk session via auth() — throws UnauthorizedError if absent.
// 2. Looks up the matching User row by clerkId; if missing (e.g. webhook
//    hasn't fired yet for a brand-new user) we lazily provision a row from
//    Clerk's currentUser() so the first request never 500s.
//
// Returns both the Clerk id and the DB user so callers can scope queries by
// the internal UUID without re-querying.
export async function requireAuth(): Promise<AuthContext> {
  // Clerk 6.x returns a Promise from auth() in App Router server contexts;
  // await is safe whether it's a Promise or a sync object.
  const session = await auth();
  const clerkId = session?.userId;
  if (!clerkId) {
    throw new UnauthorizedError();
  }

  const existing = await prisma.user.findUnique({ where: { clerkId } });
  if (existing) {
    return { userId: existing.id, clerkId, dbUser: existing };
  }

  // Lazy provisioning — webhook is the source of truth, but it can be
  // delayed/retried. We mirror just enough fields for the app to function.
  const cu = await currentUser();
  const email =
    cu?.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId)?.emailAddress ??
    cu?.emailAddresses[0]?.emailAddress ??
    null;

  // If a row already exists with this email (e.g. the user deleted their
  // Clerk account and re-signed up, or linked a new OAuth provider with the
  // same email), rebind it to the new clerkId rather than colliding on the
  // email unique constraint.
  if (email) {
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      const rebound = await prisma.user.update({
        where: { id: byEmail.id },
        data: {
          clerkId,
          username: cu?.username ?? byEmail.username ?? undefined,
          firstName: cu?.firstName ?? byEmail.firstName ?? undefined,
          lastName: cu?.lastName ?? byEmail.lastName ?? undefined,
          imageUrl: cu?.imageUrl ?? byEmail.imageUrl ?? undefined,
        },
      });
      return { userId: rebound.id, clerkId, dbUser: rebound };
    }
  }

  const created = await prisma.user.upsert({
    where: { clerkId },
    create: {
      clerkId,
      email: email ?? undefined,
      username: cu?.username ?? undefined,
      firstName: cu?.firstName ?? undefined,
      lastName: cu?.lastName ?? undefined,
      imageUrl: cu?.imageUrl ?? undefined,
    },
    update: {},
  });

  return { userId: created.id, clerkId, dbUser: created };
}
