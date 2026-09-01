import { Queue, Worker, Job } from 'bullmq';
import { analyzeArgumentGraph, AIAnalysisResult, getCachedAiResult, setCachedAiResult } from './aiService.js';
import { getTopicFlatNodes, getTopic } from './graphService.js';
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
        // Fix P-2: Use flat nodes instead of full recursive subgraph
        const nodes = await getTopicFlatNodes(topicId);
        if (!nodes || nodes.length === 0) throw new Error(`No active nodes found for topic: ${topicId}`);

        // Fetch just the topic title (lightweight)
        const topicMeta = await getTopic(topicId, userId);
        const topicTitle = topicMeta?.title || topicId;

        const result = await analyzeArgumentGraph(topicTitle, nodes);

        // Store result in Redis cache (1 hour TTL)
        await setCached(`ai-job-result:${job.id}`, result, 3600);

        // Emit SSE event to all connected clients on this topic
        emitTopicMutation(topicId, 'ai_analysis_completed', {
          jobId: job.id,
          result,
        });

        return result;
      },
      {
        connection,
        concurrency: 5,
        limiter: {
          max: 10,
          duration: 60_000,
        },
      }
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
    const job = await aiQueue.add(
      'analyze-topic',
      { topicId, userId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      }
    );
    return {
      jobId: job.id || `job-${Date.now()}`,
      status: 'queued',
    };
  }

  // Fallback: Synchronous execution if Queue is unavailable (or during test mode)
  // Fix F-6: Check in-memory cache before re-analyzing (prevents Gemini re-invocation without Redis)
  const cached = getCachedAiResult(topicId);
  if (cached) {
    const jobId = `cached-${topicId}`;
    return { jobId, status: 'completed', result: cached };
  }

  // Fix P-2: Use flat nodes instead of full recursive subgraph
  const nodes = await getTopicFlatNodes(topicId);
  if (!nodes || nodes.length === 0) throw new Error(`No active nodes found for topic: ${topicId}`);
  const topicMeta = await getTopic(topicId, userId);
  const topicTitle = topicMeta?.title || topicId;

  const result = await analyzeArgumentGraph(topicTitle, nodes);
  const jobId = `sync-${Date.now()}`;
  await setCached(`ai-job-result:${jobId}`, result, 3600);
  setCachedAiResult(topicId, result); // Fix F-6: populate in-memory fallback cache
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
