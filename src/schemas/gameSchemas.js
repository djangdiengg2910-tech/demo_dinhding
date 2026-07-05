import { z } from 'zod';

// Validates parameters passed to POST /api/game/start
export const GameStartInputSchema = z.object({
  category: z.string().min(1).max(50),
  hintsCount: z.union([z.literal(5), z.literal(10), z.literal(20)])
});

// Validates parameters passed to POST /api/game/hint and POST /api/game/guess
export const GameIdInputSchema = z.object({
  gameId: z.string().uuid()
});

export const GameGuessInputSchema = z.object({
  gameId: z.string().uuid(),
  guess: z.string().min(1).max(100)
});

// Validates the response from Gemini generating the entity and hints
export const GeminiGeneratedResponseSchema = z.object({
  answer: z.string().min(1),
  hints: z.array(z.string().min(1))
});

// Validates a single quiz question item for the new Quiz Mode
export const QuizQuestionSchema = z.object({
  topic: z.string().min(1).max(80),
  answer: z.string().min(1).max(80),
  hints: z.array(z.string().min(1).max(200)).min(3).max(10),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional().default('Medium')
});

// Validates a topic bundle returned by Gemini for Quiz Mode
export const QuizTopicSetSchema = z.object({
  topic: z.string().min(1).max(80),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional().default('Medium'),
  questions: z.array(QuizQuestionSchema).min(1).max(20)
});

// Validates the response from Gemini generating a quiz set for one topic
export const GeminiQuizGeneratedResponseSchema = QuizTopicSetSchema;

// Validates the response from Gemini verifying a guess
export const GeminiVerifyResponseSchema = z.object({
  correct: z.boolean(),
  explanation: z.string().min(1)
});
