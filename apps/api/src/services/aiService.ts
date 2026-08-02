import { GoogleGenAI } from '@google/genai';
import { ClaimNode } from './graphService.js';

export interface LogicalFallacy {
  nodeId: string;
  claimContent: string;
  fallacyName: string;
  explanation: string;
}

export interface AIAnalysisResult {
  summary: string;
  steelmanPerspective: string;
  logicalFallacies: LogicalFallacy[];
  suggestedCounterClaims: string[];
}

// Fix F-6: In-memory cache fallback for AI results when Redis is unavailable.
// Stores { result, expiresAt } keyed by topicId. TTL matches Redis (1 hour).
const AI_RESULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const inMemoryAiCache = new Map<string, { result: AIAnalysisResult; expiresAt: number }>();

export function getCachedAiResult(topicId: string): AIAnalysisResult | null {
  const entry = inMemoryAiCache.get(topicId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    inMemoryAiCache.delete(topicId);
    return null;
  }
  return entry.result;
}

export function setCachedAiResult(topicId: string, result: AIAnalysisResult): void {
  inMemoryAiCache.set(topicId, { result, expiresAt: Date.now() + AI_RESULT_TTL_MS });
}

/**
 * Fix P-2: Accepts flat ClaimNode[] directly instead of a full Topic object.
 * This allows callers to use getTopicFlatNodes() instead of the expensive getTopicSubgraph().
 *
 * Uses Gemini API to analyze an Argument Graph:
 * - Generates a neutral summary of the debate.
 * - Detects logical fallacies (ad hominem, strawman, circular reasoning, etc.).
 * - Suggests unrepresented counter-arguments to steelman the debate.
 */
export async function analyzeArgumentGraph(
  topicTitle: string,
  nodes: ClaimNode[]
): Promise<AIAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Return structured mock analysis if GEMINI_API_KEY is not set
    return {
      summary: `This debate "${topicTitle}" focuses on evaluating the core claim and its supporting vs. refuting arguments across ${nodes.length} connected claims.`,
      steelmanPerspective: `The strongest reasoning is concentrated in steelman-verified claims with high support-to-contest ratios.`,
      logicalFallacies: [
        {
          nodeId: nodes.find((n) => n.edgeType === 'root')?.id || nodes[0]?.id || 'unknown',
          claimContent: nodes.find((n) => n.edgeType === 'root')?.content || topicTitle,
          fallacyName: 'Broad Generalization',
          explanation: 'The root claim presents an absolute premise that warrants further empirical evidence breakdown.',
        },
      ],
      suggestedCounterClaims: [
        'Consider evaluating long-term economic and infrastructural tradeoffs.',
        'Address edge-case counterexamples where the root premise may fail.',
      ],
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  // Flatten graph claims into readable text prompt
  const graphFormatted = nodes
    .map(
      (n) =>
        `[ID: ${n.id}] Edge: ${n.edgeType.toUpperCase()} | Support: ${n.support} | Contest: ${n.contest} | Content: "${n.content}"`
    )
    .join('\n');

  const prompt = `You are Argus AI, an expert logician and argument graph analyst.
Analyze the following debate topic titled "${topicTitle}":

CLAIMS GRAPH:
${graphFormatted}

Respond with a JSON object strictly matching this schema:
{
  "summary": "2-3 sentence neutral overview of the debate arguments",
  "steelmanPerspective": "Analysis of the strongest, most coherent argument paths",
  "logicalFallacies": [
    {
      "nodeId": "exact_claim_id",
      "claimContent": "exact claim text",
      "fallacyName": "e.g. Strawman / Ad Hominem / False Dilemma / Hasty Generalization",
      "explanation": "concise 1-sentence reason"
    }
  ],
  "suggestedCounterClaims": [
    "Suggested missing perspective or counter-argument 1",
    "Suggested missing perspective or counter-argument 2"
  ]
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text;
    if (!text) throw new Error('Empty response from Gemini API');
    return JSON.parse(text) as AIAnalysisResult;
  } catch (err) {
    console.error('[Gemini AI] Analysis failed:', err);
    throw err;
  }
}

