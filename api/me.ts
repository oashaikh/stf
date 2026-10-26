import { withAuth } from './_lib/auth';

// Sample protected route: proves the gate. Real routes follow the same shape.
export default {
  fetch: withAuth(async (_request, auth) => Response.json({ ok: true, data: { userId: auth.userId } })),
};
