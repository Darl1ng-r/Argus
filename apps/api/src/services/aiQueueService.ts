import { Queue, Worker, Job } from 'bullmq';
import { analyzeArgumentGraph, AIAnalysisResult } from './aiService.js';
import { getTopic } from './graphService.js';
import { getCached, setCached } from '../redis.js';
import { emitTopicMutation } from './topicEvents.js';

export interface AIJobData {
  topicId: string;
  userId?: string;
}

export interface AIJobStatusResponse {
  jobId: string;
  status: 'queued' | 'active' | 'completed' | 'failed';
  result?: AIAnalysisResult | null;
  error?: string | null;
}

const REDIS_URL = process.env.REDIS_URL;

function parseRedisUrl(urlStr?: string) {
  if (!urlStr) return { host: 'localhost', port: 6379 };
  try {
    const u = new URL(urlStr);
    return {
      host: u.hostname || 'localhost',
      port: u.port ? parseInt(u.port, 10) : 6379,
      password: u.password || undefined,
    };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}

const connection = parseRedisUrl(REDIS_URL);

let aiQueue: Queue<AIJobData> | null = null;
let aiWorker: Worker<AIJobData> | null = null;

if (REDIS_URL && process.env.NODE_ENV !== 'test') {
  try {
    aiQueue = new Queue<AIJobData>('ai-analysis-queue', { connection });

    aiWorker = new Worker<AIJobData>(
      'ai-analysis-queue',
      async (job: Job<AIJobData>) => {
        const { topicId, userId } = job.data;
        const topic = await getTopic(topicId, userId);
        if (!topic) throw new Error(`Topic not found: ${topicId}`);

        const result = await analyzeArgumentGraph(topic);

        // Store result in Redis cache (1 hour TTL)
        await setCached(`ai-job-result:${job.id}`, result, 3600);

        // Emit SSE event to all connected clients on this topic
        emitTopicMutation(topicId, 'ai_analysis_completed', {
          jobId: job.id,
          result,
        });

        return result;
      },
      { connection }
    );

    aiWorker.on('failed', (job, err) => {
      console.error(`[BullMQ] AI Analysis Job ${job?.id} failed:`, err.message);
    });
  } catch (err) {
    console.error('[BullMQ] Failed to initialize BullMQ worker:', err);
  }
}

/**
 * Enqueues an AI analysis job for a topic.
 * Falls back to synchronous execution if Redis/BullMQ is unavailable.
 */
export async function enqueueAIAnalysis(
  topicId: string,
  userId?: string
): Promise<{ jobId: string; status: 'queued' | 'completed'; result?: AIAnalysisResult }> {
  if (aiQueue && process.env.NODE_ENV !== 'test') {
    const job = await aiQueue.add('analyze-topic', { topicId, userId });
    return {
      jobId: job.id || `job-${Date.now()}`,
      status: 'queued',
    };
  }

  // Fallback: Synchronous execution if Queue is unavailable (or during test mode)
  const topic = await getTopic(topicId, userId);
  if (!topic) throw new Error(`Topic not found: ${topicId}`);
  const result = await analyzeArgumentGraph(topic);
  const jobId = `sync-${Date.now()}`;
  await setCached(`ai-job-result:${jobId}`, result, 3600);
  return { jobId, status: 'completed', result };
}

/**
 * Fetches status and result of an AI analysis job.
 */
export async function getAIJobStatus(jobId: string): Promise<AIJobStatusResponse> {
  const cachedResult = await getCached<AIAnalysisResult>(`ai-job-result:${jobId}`);
  if (cachedResult) {
    return {
      jobId,
      status: 'completed',
      result: cachedResult,
    };
  }

  if (aiQueue) {
    const job = await aiQueue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      return {
        jobId,
        status: state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : 'queued',
        result: state === 'completed' ? job.returnvalue : null,
        error: job.failedReason || null,
      };
    }
  }

  return {
    jobId,
    status: 'failed',
    error: 'Job not found or expired',
  };
}
