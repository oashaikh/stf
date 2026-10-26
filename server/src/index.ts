import Fastify from 'fastify';
import { startScheduledJobs } from './scheduled-jobs/index';

// Hosts scheduled jobs only. It serves no user-facing routes; those live in api/ behind the shared auth helper.
const app = Fastify({ logger: true });

startScheduledJobs(app);

const port = Number(process.env.CONTROL_PLANE_PORT ?? 8787);
await app.listen({ port, host: process.env.CONTROL_PLANE_HOST ?? '127.0.0.1' });
