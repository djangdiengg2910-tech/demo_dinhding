import { GoogleGenAI } from '@google/genai';
import {
  GeminiGeneratedResponseSchema,
  GeminiVerifyResponseSchema,
  GeminiQuizGeneratedResponseSchema
} from '../schemas/gameSchemas.js';

// Initialize the Gemini SDK client
const getClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }
  return new GoogleGenAI({ apiKey });
};

// Global in-memory cache for game generation
const generationCache = new Map();

// Sample prompt template for generating Quiz Mode question packs from Gemini.
export const QUIZ_GENERATION_PROMPT_TEMPLATE = `Return ONLY valid JSON.

You are generating a quiz dataset for the "Quiz Mode" game.
Topic: {topic}
Target difficulty: {difficulty}
Generate exactly {questionCount} quiz questions.

Each question must follow this schema:
{
  "topic": "{topic}",
  "answer": "keyword or short phrase",
  "hints": ["clue 1", "clue 2", "clue 3"],
  "difficulty": "{difficulty}"
}

Rules:
- The answer must be a single keyword or short phrase.
- The hints must be related to the answer and should become progressively more revealing.
- Do not include the answer directly in the hints.
- Keep answers concise and recognizable.
- Return pure JSON with no markdown, comments, or extra text.
`;

export function buildQuizGenerationPrompt(topic, questionCount = 5, difficulty = 'Medium') {
  return QUIZ_GENERATION_PROMPT_TEMPLATE.replace('{topic}', topic)
    .replace('{difficulty}', difficulty)
    .replace('{questionCount}', String(questionCount));
}

// Rate limiting state
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // 2 seconds minimum between API calls

async function enforceRateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    const delay = MIN_REQUEST_INTERVAL - elapsed;
    console.log(`Rate limiting: Delaying API request by ${delay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  lastRequestTime = Date.now();
}

// Clean markdown wrappers if Gemini fails to follow responseMimeType
function cleanJsonText(text) {
  let clean = text.trim();
  if (clean.startsWith('```json')) {
    clean = clean.substring(7);
  } else if (clean.startsWith('```')) {
    clean = clean.substring(3);
  }
  if (clean.endsWith('```')) {
    clean = clean.slice(0, -3);
  }
  return clean.trim();
}

/**
 * Calls Gemini to generate a target entity and list of hints.
 * Respects cache, rate limit, retries, and enforces Structured Outputs.
 */
export async function generateGameData(category, hintsCount, difficulty = 'Medium') {
  const cacheKey = `${category.toLowerCase()}_${difficulty.toLowerCase()}_${hintsCount}`;
  
  // Return cached result if present
  if (generationCache.has(cacheKey)) {
    console.log(`Cache Hit for key: ${cacheKey}`);
    const cachedData = generationCache.get(cacheKey);
    // Return a structured clone to prevent side-effects on original array references
    return JSON.parse(JSON.stringify(cachedData));
  }

  const maxRetries = 3;
  let lastError = null;

  // Prompt logic reflecting difficulty guidelines
  let difficultyGuideline = 'moderately popular and recognizable';
  if (difficulty === 'Easy') {
    difficultyGuideline = 'extremely famous, universally known, and iconic';
  } else if (difficulty === 'Hard') {
    difficultyGuideline = 'obscure, rare, specialized, and lesser-known';
  }

  const prompt = `Return ONLY valid JSON.

Rules:
* Choose one secret entity from category: ${category}.
* The entity must be of ${difficulty} difficulty (i.e. ${difficultyGuideline}).
* Generate exactly ${hintsCount} hints.
* Hints must progress from vague to specific (Hint 1 is very hard, final hint makes it obvious).
* Do not mention the answer directly in any hint.
* Do not include markdown codeblocks or explanations outside the JSON structure.`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await enforceRateLimit();

      const ai = getClient();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              answer: { type: 'STRING' },
              hints: {
                type: 'ARRAY',
                items: { type: 'STRING' }
              }
            },
            required: ['answer', 'hints']
          }
        }
      });

      if (!response.text) {
        throw new Error('Gemini returned an empty response text');
      }

      const cleanText = cleanJsonText(response.text);
      const rawJson = JSON.parse(cleanText);
      const validatedData = GeminiGeneratedResponseSchema.parse(rawJson);

      if (validatedData.hints.length !== hintsCount) {
        throw new Error(`Expected exactly ${hintsCount} hints, got ${validatedData.hints.length}`);
      }

      // Save to cache before returning
      generationCache.set(cacheKey, validatedData);
      return validatedData;

    } catch (error) {
      console.warn(`Attempt ${attempt} to generate game data failed:`, error.message);
      lastError = error;
    }
  }

  throw new Error(`Gemini generateGameData failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
}

/**
 * Calls Gemini to check if guess matches the correct answer semantically.
 */
export async function verifyGuess(answer, guess) {
  const maxRetries = 3;
  let lastError = null;

  const prompt = `You are an expert game referee. Validate if the player's guess is semantically correct compared to the correct answer.
Correct Answer: ${answer}
Player's Guess: ${guess}

Rules:
- Accept synonyms, abbreviations, common misspellings, or correct descriptions (e.g. "Einstein" for "Albert Einstein").
- Reject incorrect answers or unrelated entities.
- Return ONLY valid JSON with the schema:
{
  "correct": boolean,
  "explanation": "string"
}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await enforceRateLimit();

      const ai = getClient();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              correct: { type: 'BOOLEAN' },
              explanation: { type: 'STRING' }
            },
            required: ['correct', 'explanation']
          }
        }
      });

      if (!response.text) {
        throw new Error('Gemini returned an empty response text');
      }

      const cleanText = cleanJsonText(response.text);
      const rawJson = JSON.parse(cleanText);
      return GeminiVerifyResponseSchema.parse(rawJson);

    } catch (error) {
      console.warn(`Attempt ${attempt} to verify guess failed:`, error.message);
      lastError = error;
    }
  }

  // Local fallback comparator in case Gemini fails repeatedly
  const match = answer.toLowerCase().trim() === guess.toLowerCase().trim();
  return {
    correct: match,
    explanation: match ? 'Direct string match fallback.' : 'Incorrect (Direct string match fallback).'
  };
}
