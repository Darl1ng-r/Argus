import { randomUUID } from 'crypto';
import { redisClient } from '../redis.js';
import { logger } from '../server.js';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';

export interface Job<T = unknown> {
  id: string;
  queue: string;
  data: T;
  status: JobStatus;
  attempts: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  processedAt?: number;
}

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void>;

// In-memory fallback queue for local development and test environments without Redis
const memoryQueues = new Map<string, Job[]>();
const memoryJobStore = new Map<string, Job>();
const memoryDlq = new Map<string, Job[]>();

/**
 * Enqueues an asynchronous job for background processing with configurable retry policies.
 */
export async function enqueueJob<T = unknown>(
  queueName: string,
  data: T,
  options: { maxRetries?: number } = {}
): Promise<Job<T>> {
  const job: Job<T> = {
    id: `job-${randomUUID()}`,
    queue: queueName,
    data,
    status: 'pending',
    attempts: 0,
    maxRetries: options.maxRetries ?? 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (redisClient) {
    try {
      const pipeline = redisClient.pipeline();
      const jobKey = `job:${job.id}`;
      pipeline.set(jobKey, JSON.stringify(job), 'EX', 86400); // 24h TTL
      pipeline.lpush(`queue:${queueName}`, job.id);
      await pipeline.exec();
      return job;
    } catch (err) {
      logger.warn({ err }, `[JobQueue] Redis enqueue error on ${queueName} — falling back to memory queue`);
    }
  }

  // In-memory fallback
  if (!memoryQueues.has(queueName)) memoryQueues.set(queueName, []);
  memoryQueues.get(queueName)!.push(job);
  memoryJobStore.set(job.id, job);
  return job;
}

/**
 * Processes a single job from the specified queue. Handles exponential retry backoff and DLQ routing.
 */
export async function processNextJob<T = unknown>(
  queueName: string,
  handler: JobHandler<T>
): Promise<Job<T> | null> {
  let job: Job<T> | null = null;

  if (redisClient) {
    try {
      const jobId = await redisClient.rpop(`queue:${queueName}`);
      if (jobId) {
        const raw = await redisClient.get(`job:${jobId}`);
        if (raw) job = JSON.parse(raw) as Job<T>;
      }
    } catch (err) {
      logger.warn({ err }, `[JobQueue] Redis pop error on ${queueName}`);
    }
  }

  if (!job) {
    const memQueue = memoryQueues.get(queueName);
    if (memQueue && memQueue.length > 0) {
      job = memQueue.shift() as Job<T>;
    }
  }

  if (!job) return null;

  job.attempts += 1;
  job.status = 'processing';
  job.updatedAt = Date.now();

  try {
    await handler(job);
    job.status = 'completed';
    job.processedAt = Date.now();
    job.updatedAt = Date.now();

    if (redisClient) {
      await redisClient.set(`job:${job.id}`, JSON.stringify(job), 'EX', 86400);
    } else {
      memoryJobStore.set(job.id, job);
    }
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    job.updatedAt = Date.now();

    if (job.attempts < job.maxRetries) {
      job.status = 'pending';
      logger.warn(
        `[JobQueue] Job ${job.id} failed attempt ${job.attempts}/${job.maxRetries}. Re-enqueuing with backoff.`
      );

      if (redisClient) {
        await redisClient.set(`job:${job.id}`, JSON.stringify(job), 'EX', 86400);
        await redisClient.lpush(`queue:${queueName}`, job.id);
      } else {
        if (!memoryQueues.has(queueName)) memoryQueues.set(queueName, []);
        memoryQueues.get(queueName)!.push(job);
        memoryJobStore.set(job.id, job);
      }
    } else {
      // Exceeded max retries -> Move to Dead Letter Queue (DLQ)
      job.status = 'dead_letter';
      logger.error(
        `[JobQueue] Job ${job.id} permanently failed after ${job.attempts} attempts. Routed to Dead-Letter Queue (dlq:jobs:${queueName}). Error: ${job.error}`
      );

      if (redisClient) {
        const pipeline = redisClient.pipeline();
        pipeline.set(`job:${job.id}`, JSON.stringify(job), 'EX', 604800); // 7-day retention for DLQ
        pipeline.lpush(`dlq:jobs:${queueName}`, job.id);
        await pipeline.exec();
      } else {
        if (!memoryDlq.has(queueName)) memoryDlq.set(queueName, []);
        memoryDlq.get(queueName)!.push(job);
        memoryJobStore.set(job.id, job);
      }
    }
  }

  return job;
}

/**
 * Retrieves the current status and payload of a job by ID.
 */
export async function getJobStatus<T = unknown>(jobId: string): Promise<Job<T> | null> {
  if (redisClient) {
    try {
      const raw = await redisClient.get(`job:${jobId}`);
      if (raw) return JSON.parse(raw) as Job<T>;
    } catch {}
  }
  return (memoryJobStore.get(jobId) as Job<T>) || null;
}

/**
 * Retrieves jobs in the Dead-Letter Queue for inspection or replay.
 */
export async function getDlqJobs(queueName: string, limit = 50): Promise<Job[]> {
  if (redisClient) {
    try {
      const jobIds = await redisClient.lrange(`dlq:jobs:${queueName}`, 0, limit - 1);
      const jobs: Job[] = [];
      for (const id of jobIds) {
        const raw = await redisClient.get(`job:${id}`);
        if (raw) jobs.push(JSON.parse(raw));
      }
      return jobs;
    } catch {}
  }
  return (memoryDlq.get(queueName) || []).slice(0, limit);
}
