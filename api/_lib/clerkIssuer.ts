import { createClerkClient, verifyToken } from '@clerk/backend';

import type { AuthIssuer } from './auth';

// The only file that imports @clerk/backend. A self-hoster swaps the issuer by
// providing another AuthIssuer; route handlers never see Clerk types.
function secretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error('CLERK_SECRET_KEY is not set');
  return key;
}

export const clerkIssuer: AuthIssuer = {
  async verifyToken(token) {
    const configuredParties = (process.env.CLERK_AUTHORIZED_PARTIES ?? '')
      .split(',')
      .map((party) => party.trim())
      .filter(Boolean);
    // Without azp pinning, a token minted for another origin on the same Clerk instance would pass.
    if (configuredParties.length === 0 && process.env.NODE_ENV === 'production') {
      throw new Error('CLERK_AUTHORIZED_PARTIES is not set');
    }
    const authorizedParties = configuredParties.length > 0 ? configuredParties : undefined;
    const key = secretKey();
    try {
      const claims = await verifyToken(token, { secretKey: key, authorizedParties });
      return claims.sub || null;
    } catch {
      return null;
    }
  },

  async getEmail(issuerUserId) {
    const user = await createClerkClient({ secretKey: secretKey() }).users.getUser(issuerUserId);
    const primary = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId);
    const email = (primary ?? user.emailAddresses[0])?.emailAddress;
    if (!email) throw new Error('Issuer user has no email address');
    return email;
  },
};
