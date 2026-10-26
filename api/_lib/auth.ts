import { verifyToken } from '@clerk/backend';

export interface AuthResult {
  success: boolean;
  userId?: string;
  error?: string;
}

export async function verifyClerkToken(token: string): Promise<AuthResult> {
  if (!token) {
    return { success: false, error: 'Missing authentication token' };
  }

  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    return { success: false, error: 'Server misconfiguration: CLERK_SECRET_KEY not set' };
  }

  try {
    const decoded = await verifyToken(token, { secretKey: secret });
    const userId = decoded.sub;

    if (!userId) {
      return { success: false, error: 'Invalid token: missing user ID' };
    }

    return { success: true, userId };
  } catch {
    return { success: false, error: 'Invalid or expired token' };
  }
}
