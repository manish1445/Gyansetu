import { z } from "zod";

export type SupportedLanguage = "English" | "Kannada" | "Hindi";
export type ExplanationLevel = "simple" | "standard" | "advanced";
export type QuizDifficulty = "easy" | "medium" | "hard";

export interface StudentRecord {
  id: string;
  name: string;
  college: string;
  branch: string;
  semester: number;
  language: SupportedLanguage;
  classId: string;
  createdAt: string;
}

export interface TopicMasteryRecord {
  topic: string;
  mastery: number; // 0.0 to 1.0
  attempts: number;
  failedAnalogies: string[];
  updatedAt: string;
}

export interface DoubtRecord {
  id: string;
  studentId: string;
  topic: string;
  question: string;
  hasImage: boolean;
  prerequisiteGap: string | null;
  chosenLevel: ExplanationLevel | null;
  createdAt: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  concept: string;
  explanation: string;
}

export interface QuizRecord {
  id: string;
  studentId: string;
  topic: string;
  difficulty: QuizDifficulty;
  language: SupportedLanguage;
  questions: QuizQuestion[];
  createdAt: string;
}

export interface PublicQuizQuestion {
  id: string;
  question: string;
  options: [string, string, string, string];
  concept: string;
}

export interface PublicQuiz {
  id: string;
  topic: string;
  difficulty: QuizDifficulty;
  language: SupportedLanguage;
  questions: PublicQuizQuestion[];
}

export interface ClassWeaknessRecord {
  id: string;
  classId: string;
  topic: string;
  prerequisiteGap: string | null;
  reason: string;
  flagCount: number;
  lastFlaggedAt: string;
  missedConcepts?: string[];
}

export interface StudentProfile {
  student: StudentRecord;
  averageMastery: number;
  topicMastery: TopicMasteryRecord[];
  recentDoubts: DoubtRecord[];
  failedAnalogiesByTopic: Record<string, string[]>;
}

export interface ToolTraceItem {
  step: number;
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export const DoubtModeResponseSchema = z.object({
  topic: z.string().min(1),
  level: z.enum(["simple", "standard", "advanced"]),
  gap: z.string().nullable(),
  reason: z.string().min(1),
  explanations: z.object({
    simple: z.string().min(1),
    standard: z.string().min(1),
    advanced: z.string().min(1),
  }),
});

export type DoubtModeResponse = z.infer<typeof DoubtModeResponseSchema>;

export const QuizRetryResponseSchema = z.object({
  next: z.literal("retry"),
  message: z.string().min(1),
  reteach: z.string().min(1),
});

export const QuizAdvanceResponseSchema = z.object({
  next: z.literal("advance"),
  message: z.string().min(1),
});

export const QuizResultModeResponseSchema = z.union([
  QuizRetryResponseSchema,
  QuizAdvanceResponseSchema,
]);

export type QuizResultModeResponse = z.infer<typeof QuizResultModeResponseSchema>;
