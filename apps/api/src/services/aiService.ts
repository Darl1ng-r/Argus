import { GoogleGenAI } from '@google/genai';
import { Topic, ClaimNode } from './graphService.js';

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

/**
 * Uses Gemini API to analyze an Argument Graph:
 * - Generates a neutral summary of the debate.
 * - Detects logical fallacies (ad hominem, strawman, circular reasoning, etc.).
 * - Suggests unrepresented counter-arguments to steelman the debate.
 */
export async function analyzeArgumentGraph(topic: Topic): Promise<AIAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Return structured mock analysis if GEMINI_API_KEY is not set
    return {
      summary: `This debate "${topic.title}" focuses on evaluating the core claim and its supporting vs. refuting arguments across ${topic.nodes.length} connected claims.`,
      steelmanPerspective: `The strongest reasoning is concentrated in steelman-verified claims with high support-to-contest ratios.`,
      logicalFallacies: [
        {
          nodeId: topic.rootNodeId,
          claimContent: topic.nodes.find((n) => n.id === topic.rootNodeId)?.content || topic.title,
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
  const graphFormatted = topic.nodes
    .map(
      (n) =>
        `[ID: ${n.id}] Edge: ${n.edgeType.toUpperCase()} | Support: ${n.support} | Contest: ${n.contest} | Content: "${n.content}"`
    )
    .join('\n');

  const prompt = `You are Argus AI, an expert logician and argument graph analyst.
Analyze the following debate topic titled "${topic.title}":

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
