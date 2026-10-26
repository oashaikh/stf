import { eq } from 'drizzle-orm';

import type { ApiError } from '../../src/model/types.js';
import { users } from '../../server/src/db/schema.js';
import { clerkIssuer } from './clerkIssuer.js';
import { db } from './db.js';

// Issuer-agnostic boundary: every API route authenticates through requireAuth/withAuth.
export interface AuthIssuer {
  /** Returns the issuer's user id for a valid token, or null if invalid or expired. */
  verifyToken(token: string): Promise<string | null>;
  getEmail(issuerUserId: string): Promise<string>;
}

export interface UserStore {
  findId(issuerUserId: string): Promise<string | undefined>;
  createIfAbsent(issuerUserId: string, email: string): Promise<string>;
}

export interface AuthDeps {
  issuer: AuthIssuer;
  users: UserStore;
}

export interface AuthIdentity {
  userId: string;
  issuerUserId: string;
}

export class UnauthorizedError extends Error {}

const databaseUsers: UserStore = {
  async findId(issuerUserId) {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.clerkUserId, issuerUserId)).limit(1);
    return row?.id;
  },

  async createIfAbsent(issuerUserId, email) {
    // The unique clerk_user_id makes concurrent first requests converge on one row.
    await db.insert(users).values({ clerkUserId: issuerUserId, email }).onConflictDoNothing({ target: users.clerkUserId });
    const id = await this.findId(issuerUserId);
    if (!id) throw new Error('User row missing after insert');
    return id;
  },
};

const defaultDeps: AuthDeps = { issuer: clerkIssuer, users: databaseUsers };

export async function requireAuth(request: Request, deps: AuthDeps = defaultDeps): Promise<AuthIdentity> {
  const token = /^Bearer (.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) throw new UnauthorizedError();

  const issuerUserId = await deps.issuer.verifyToken(token);
  if (!issuerUserId) throw new UnauthorizedError();

  const existingId = await deps.users.findId(issuerUserId);
  const userId = existingId ?? (await deps.users.createIfAbsent(issuerUserId, await deps.issuer.getEmail(issuerUserId)));
  return { userId, issuerUserId };
}

function errorResponse(status: number, body: ApiError): Response {
  return Response.json(body, { status });
}

export function withAuth(
  handler: (request: Request, auth: AuthIdentity) => Promise<Response>,
  deps?: AuthDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request, await requireAuth(request, deps));
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return errorResponse(401, { ok: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
      }
      // Log the class only: error messages can carry secrets or request details.
      console.error('API error', error instanceof Error ? error.name : 'unknown');
      return errorResponse(500, { ok: false, error: 'Internal server error', code: 'INTERNAL' });
    }
  };
}
