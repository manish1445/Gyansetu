import type { ChatCompletionTool } from "groq-sdk/resources/chat/completions.js";
import { z } from "zod";
import type { GyanSetuDb } from "./db.js";
import type {
  QuizDifficulty,
  QuizQuestion,
  QuizRecord,
  SupportedLanguage,
} from "./types.js";

export const GYANSETU_GROQ_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_student_profile",
      description:
        "Retrieve the student's profile, chosen language (English, Kannada, or Hindi), per-topic mastery scores (0.0 to 1.0), recent doubts, and failed analogies to avoid repeating.",
      parameters: {
        type: "object",
        properties: {
          student_id: {
            type: "string",
            description: "The unique ID of the student.",
          },
        },
        required: ["student_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_doubt",
      description:
        "Log a student's academic doubt after identifying the topic and any suspected prerequisite gap. Returns the doubt ID and current mastery for that topic.",
      parameters: {
        type: "object",
        properties: {
          student_id: {
            type: "string",
            description: "The unique ID of the student.",
          },
          topic: {
            type: "string",
            description: "Concise academic topic identified from the student's text or image.",
          },
          question: {
            type: "string",
            description: "Summary of the student's doubt.",
          },
          has_image: {
            type: "boolean",
            description: "Whether the student attached an image.",
          },
          prerequisite_gap: {
            type: "string",
            description: "The one foundational concept the student is likely missing, or empty if none.",
          },
        },
        required: ["student_id", "topic", "question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_quiz",
      description:
        "Generate a 3-question diagnostic multiple-choice quiz calibrated to difficulty (easy, medium, hard) in the student's chosen language.",
      parameters: {
        type: "object",
        properties: {
          student_id: {
            type: "string",
            description: "The unique ID of the student.",
          },
          topic: {
            type: "string",
            description: "Topic for the quiz.",
          },
          difficulty: {
            type: "string",
            enum: ["easy", "medium", "hard"],
            description: "Quiz difficulty matching mastery: easy (<0.4), medium (<0.7), hard (>=0.7).",
          },
          language: {
            type: "string",
            enum: ["English", "Kannada", "Hindi"],
            description: "Student's chosen language.",
          },
          prerequisite_gap: {
            type: "string",
            description: "Optional prerequisite concept to verify in the quiz.",
          },
        },
        required: ["student_id", "topic", "difficulty", "language"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_progress",
      description:
        "Update the student's mastery score after a quiz attempt and record any failed analogies if the score is below 2/3.",
      parameters: {
        type: "object",
        properties: {
          student_id: {
            type: "string",
            description: "The unique ID of the student.",
          },
          topic: {
            type: "string",
            description: "Topic of the quiz.",
          },
          quiz_id: {
            type: "string",
            description: "ID of the quiz attempted.",
          },
          score: {
            type: "integer",
            description: "Number of questions answered correctly (0 to 3).",
          },
          total: {
            type: "integer",
            description: "Total number of questions in the quiz (usually 3).",
          },
          missed_concepts: {
            type: "array",
            items: { type: "string" },
            description: "Concepts missed by the student.",
          },
          failed_analogy: {
            type: "string",
            description: "If score < 2/3, the analogy or explanation approach that failed so it is not repeated.",
          },
        },
        required: ["student_id", "topic", "score", "total"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_class_weakness",
      description:
        "Flag a topic or prerequisite gap as a class-wide weakness when a student scores below 2/3 on a quiz.",
      parameters: {
        type: "object",
        properties: {
          student_id: {
            type: "string",
            description: "The student's ID (used to look up their class).",
          },
          class_id: {
            type: "string",
            description: "Optional class identifier.",
          },
          topic: {
            type: "string",
            description: "The topic where weakness was observed.",
          },
          prerequisite_gap: {
            type: "string",
            description: "Underlying prerequisite gap contributing to the struggle.",
          },
          reason: {
            type: "string",
            description: "Short reason explaining why this topic was flagged.",
          },
        },
        required: ["student_id", "topic", "reason"],
      },
    },
  },
];

export const GeneratedQuizSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
        correctIndex: z.number().int().min(0).max(3),
        concept: z.string().min(1),
        explanation: z.string().min(1),
      })
    )
    .length(3),
});

export type QuizQuestionGenerator = (params: {
  topic: string;
  difficulty: QuizDifficulty;
  language: SupportedLanguage;
  prerequisiteGap?: string | null;
  avoidConcepts?: string[];
}) => Promise<QuizQuestion[]>;

export interface ToolExecutionContext {
  latestDoubtId: string | null;
  latestQuiz: QuizRecord | null;
}

export class GyanSetuToolExecutor {
  constructor(
    private readonly db: GyanSetuDb,
    private readonly quizGenerator: QuizQuestionGenerator
  ) {}

  public async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext
  ): Promise<Record<string, unknown>> {
    switch (name) {
      case "get_student_profile": {
        const studentId = String(args.student_id ?? "");
        const profile = this.db.getStudentProfile(studentId);
        if (!profile) {
          return { error: `Student '${studentId}' not found.` };
        }
        return {
          student_id: profile.student.id,
          name: profile.student.name,
          college: profile.student.college,
          branch: profile.student.branch,
          semester: profile.student.semester,
          language: profile.student.language,
          class_id: profile.student.classId,
          average_mastery: profile.averageMastery,
          topic_mastery: profile.topicMastery.map((tm) => ({
            topic: tm.topic,
            mastery: tm.mastery,
            attempts: tm.attempts,
            failed_analogies: tm.failedAnalogies,
          })),
          recent_doubts: profile.recentDoubts.slice(0, 5).map((d) => ({
            topic: d.topic,
            question: d.question,
            prerequisite_gap: d.prerequisiteGap,
            chosen_level: d.chosenLevel,
          })),
          failed_analogies_by_topic: profile.failedAnalogiesByTopic,
        };
      }

      case "log_doubt": {
        const studentId = String(args.student_id ?? "");
        const topic = String(args.topic ?? "General Concept");
        const question = String(args.question ?? "");
        const hasImage = Boolean(args.has_image);
        const prerequisiteGap =
          typeof args.prerequisite_gap === "string" && args.prerequisite_gap.trim().length > 0
            ? args.prerequisite_gap.trim()
            : null;

        const logged = this.db.logDoubt({
          studentId,
          topic,
          question,
          hasImage,
          prerequisiteGap,
        });
        ctx.latestDoubtId = logged.doubtId;
        return {
          doubt_id: logged.doubtId,
          topic,
          topic_mastery: logged.topicMastery,
          failed_analogies: logged.failedAnalogies,
        };
      }

      case "generate_quiz": {
        const studentId = String(args.student_id ?? "");
        const topic = String(args.topic ?? "General Concept");
        const difficulty = normalizeDifficulty(args.difficulty);
        const student = this.db.getStudent(studentId);
        const language = normalizeLanguage(args.language ?? student?.language);
        const prerequisiteGap =
          typeof args.prerequisite_gap === "string" && args.prerequisite_gap.trim().length > 0
            ? args.prerequisite_gap.trim()
            : null;

        const questions = await this.quizGenerator({
          topic,
          difficulty,
          language,
          prerequisiteGap,
        });

        const saved = this.db.saveQuiz({
          studentId,
          topic,
          difficulty,
          language,
          questions,
        });
        ctx.latestQuiz = saved;

        return {
          quiz_id: saved.id,
          topic: saved.topic,
          difficulty: saved.difficulty,
          language: saved.language,
          question_count: saved.questions.length,
          questions: saved.questions.map((q) => ({
            id: q.id,
            question: q.question,
            concept: q.concept,
          })),
        };
      }

      case "update_progress": {
        const studentId = String(args.student_id ?? "");
        const topic = String(args.topic ?? "General Concept");
        const quizId = typeof args.quiz_id === "string" ? args.quiz_id : undefined;
        const score = Number(args.score ?? 0);
        const total = Number(args.total ?? 3);
        const missedConcepts = Array.isArray(args.missed_concepts)
          ? args.missed_concepts.map(String)
          : [];
        const failedAnalogy =
          typeof args.failed_analogy === "string" ? args.failed_analogy : undefined;

        const updated = this.db.updateProgress({
          studentId,
          topic,
          quizId,
          score,
          total,
          missedConcepts,
          failedAnalogy,
        });

        return {
          student_id: studentId,
          topic,
          previous_mastery: updated.previousMastery,
          new_mastery: updated.newMastery,
          attempts: updated.attempts,
          passed: updated.passed,
        };
      }

      case "flag_class_weakness": {
        const studentId = String(args.student_id ?? "");
        const student = this.db.getStudent(studentId);
        const classId =
          typeof args.class_id === "string" && args.class_id.trim().length > 0
            ? args.class_id.trim()
            : student?.classId || "GENERAL-CLASS";
        const topic = String(args.topic ?? "General Concept");
        const prerequisiteGap =
          typeof args.prerequisite_gap === "string" && args.prerequisite_gap.trim().length > 0
            ? args.prerequisite_gap.trim()
            : null;
        const reason = String(args.reason ?? "Student scored below 2/3 on diagnostic quiz.");

        const flagged = this.db.flagClassWeakness({
          classId,
          topic,
          prerequisiteGap,
          reason,
        });

        return {
          weakness_id: flagged.id,
          class_id: flagged.classId,
          topic: flagged.topic,
          flag_count: flagged.flagCount,
          prerequisite_gap: flagged.prerequisiteGap,
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }
}

function normalizeDifficulty(val: unknown): QuizDifficulty {
  if (val === "easy" || val === "medium" || val === "hard") return val;
  return "easy";
}

function normalizeLanguage(val: unknown): SupportedLanguage {
  if (val === "English" || val === "Kannada" || val === "Hindi") return val;
  return "English";
}
