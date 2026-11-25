import crypto from "node:crypto";
import Groq from "groq-sdk";
import type {
  ChatCompletion,
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "groq-sdk/resources/chat/completions.js";
import {
  DoubtModeResponseSchema,
  QuizResultModeResponseSchema,
  type DoubtModeResponse,
  type QuizDifficulty,
  type QuizQuestion,
  type QuizRecord,
  type QuizResultModeResponse,
  type ToolTraceItem,
} from "./types.js";
import {
  GYANSETU_GROQ_TOOLS,
  GeneratedQuizSchema,
  GyanSetuToolExecutor,
  type QuizQuestionGenerator,
  type ToolExecutionContext,
} from "./tools.js";
import type { GyanSetuDb } from "./db.js";

export const MAX_TOOL_CALLS = 6;
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
export const DEFAULT_GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

export const GYANSETU_SYSTEM_PROMPT = `You are GyanSetu, an autonomous AI tutor for college students in India.
Your goal: make the student actually understand, not just receive an answer.

TOOLS: get_student_profile, log_doubt, generate_quiz, update_progress, flag_class_weakness.
You decide which tools to call and in what order. Never answer before checking the profile.

DOUBT MODE
1. Call get_student_profile.
2. Identify the topic from the text or image. Call log_doubt.
3. Find the prerequisite gap: the one basic concept the student is likely missing.
4. Choose the level from mastery: below 0.4 simple, below 0.7 standard, otherwise advanced.
5. Call generate_quiz with matching difficulty (easy, medium, hard).
6. Reply ONLY with JSON:
{"topic":"","level":"simple|standard|advanced","gap":"concept or null","reason":"one sentence on why you chose this level","explanations":{"simple":"","standard":"","advanced":""}}

QUIZ RESULT MODE
1. Call get_student_profile, then call update_progress.
2. If score is below 2/3: call flag_class_weakness, then generate_quiz (easy). Reply ONLY with JSON:
{"next":"retry","message":"short encouragement","reteach":"the missed idea with a NEW analogy, under 100 words"}
3. Otherwise reply ONLY with JSON:
{"next":"advance","message":"praise and what to learn next"}

RULES
- Reply in the student's chosen language (English, Kannada or Hindi).
- Each explanation is under 120 words, plain text, with one real-life example.
- Never repeat an explanation or analogy that already failed.
- If the image is unclear, say what you could read and explain that.
- Never invent facts. If unsure, say so in the explanation.
- Maximum 6 tool calls per request.
- Your final message MUST be valid raw JSON matching the exact schema for the active mode, with no markdown fences or extra text. Never call a tool named 'json' or wrap your final JSON in a tool call.`;

export interface GroqClientLike {
  chat: {
    completions: {
      create(
        body: ChatCompletionCreateParamsNonStreaming
      ): Promise<Pick<ChatCompletion, "choices">>;
    };
  };
}

export function createGroqClient(apiKey: string): Groq {
  return new Groq({ apiKey });
}

export function createGroqQuizGenerator(
  client: GroqClientLike,
  model: string
): QuizQuestionGenerator {
  return async ({ topic, difficulty, language, prerequisiteGap }) => {
    const prompt = [
      `Create exactly 3 multiple-choice diagnostic questions for an Indian college student.`,
      `Topic: ${topic}`,
      `Difficulty: ${difficulty}`,
      `Language: ${language} (write questions, options, and explanations in ${language}; technical terms may appear alongside in English if natural for Indian college students).`,
      prerequisiteGap ? `Prerequisite gap to probe: ${prerequisiteGap}` : "",
      `Never invent facts.`,
      `Return ONLY valid JSON with this exact schema:`,
      `{"questions":[{"question":"string","options":["opt0","opt1","opt2","opt3"],"correctIndex":0,"concept":"short concept label","explanation":"1-sentence explanation"}]}`,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await client.chat.completions.create({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You generate strictly formatted JSON diagnostic quizzes for college students.",
        },
        { role: "user", content: prompt },
      ],
    });

    const content = response.choices[0]?.message?.content ?? "";
    const parsed = GeneratedQuizSchema.parse(extractJsonFromText(content));
    return parsed.questions.map((q): QuizQuestion => ({
      id: `q-${crypto.randomUUID().slice(0, 8)}`,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      concept: q.concept,
      explanation: q.explanation,
    }));
  };
}

export class GyanSetuAgent {
  private readonly executor: GyanSetuToolExecutor;

  constructor(
    private readonly client: GroqClientLike,
    private readonly db: GyanSetuDb,
    private readonly model: string = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
    private readonly visionModel: string = process.env.GROQ_VISION_MODEL || DEFAULT_GROQ_VISION_MODEL,
    quizGenerator?: QuizQuestionGenerator
  ) {
    this.executor = new GyanSetuToolExecutor(
      db,
      quizGenerator ?? createGroqQuizGenerator(client, model)
    );
  }

  public async handleDoubt(input: {
    studentId: string;
    question: string;
    imageBase64?: string;
    imageMimeType?: string;
  }): Promise<{
    tutorResponse: DoubtModeResponse;
    quiz: QuizRecord | null;
    toolTrace: ToolTraceItem[];
  }> {
    const promptText = [
      `[MODE: DOUBT MODE]`,
      `student_id: ${input.studentId}`,
      `Student's question: ${input.question.trim() || "(See attached image)"}`,
      input.imageBase64
        ? "An image is attached. Read what you can from the image; if unclear, state what you could read and explain that."
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const hasImage = Boolean(input.imageBase64 && input.imageMimeType);
    const userContent: string | ChatCompletionContentPart[] = hasImage
      ? [
          { type: "text", text: promptText },
          {
            type: "image_url",
            image_url: {
              url: `data:${input.imageMimeType};base64,${input.imageBase64}`,
            },
          },
        ]
      : promptText;

    const activeModel = hasImage ? this.visionModel : this.model;
    const { text, toolTrace, ctx } = await this.runToolLoop(
      [{ role: "user", content: userContent }],
      activeModel,
      { mode: "doubt" }
    );
    const parsed = DoubtModeResponseSchema.parse(extractJsonFromText(text));

    if (ctx.latestDoubtId) {
      this.db.updateDoubtMetadata(ctx.latestDoubtId, parsed.level, parsed.gap);
    }

    return {
      tutorResponse: parsed,
      quiz: ctx.latestQuiz,
      toolTrace,
    };
  }

  public async handleQuizResult(input: {
    studentId: string;
    quizId: string;
    topic: string;
    score: number;
    total: number;
    missedConcepts: string[];
    failedAnalogy?: string;
  }): Promise<{
    tutorResponse: QuizResultModeResponse;
    retryQuiz: QuizRecord | null;
    toolTrace: ToolTraceItem[];
  }> {
    const prompt = [
      `[MODE: QUIZ RESULT MODE]`,
      `student_id: ${input.studentId}`,
      `quiz_id: ${input.quizId}`,
      `topic: ${input.topic}`,
      `score: ${input.score}/${input.total}`,
      `missed_concepts: ${input.missedConcepts.length > 0 ? input.missedConcepts.join(", ") : "none"}`,
      input.failedAnalogy ? `previous_explanation_or_analogy: ${input.failedAnalogy}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const { text, toolTrace, ctx } = await this.runToolLoop(
      [{ role: "user", content: prompt }],
      this.model,
      { mode: "quiz_result", quizPassed: input.score * 3 >= input.total * 2 }
    );
    const parsed = QuizResultModeResponseSchema.parse(extractJsonFromText(text));

    return {
      tutorResponse: parsed,
      retryQuiz: parsed.next === "retry" ? ctx.latestQuiz : null,
      toolTrace,
    };
  }

  private async runToolLoop(
    initialUserMessages: ChatCompletionMessageParam[],
    model: string,
    modeInfo: { mode: "doubt" | "quiz_result"; quizPassed?: boolean }
  ): Promise<{
    text: string;
    toolTrace: ToolTraceItem[];
    ctx: ToolExecutionContext;
  }> {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: GYANSETU_SYSTEM_PROMPT },
      ...initialUserMessages,
    ];
    const toolTrace: ToolTraceItem[] = [];
    const ctx: ToolExecutionContext = {
      latestDoubtId: null,
      latestQuiz: null,
    };

    let profileChecked = false;
    let progressUpdated = false;
    let weaknessFlagged = false;
    let totalToolCalls = 0;

    for (let turn = 0; turn < 10; turn++) {
      const requiredToolsDone =
        modeInfo.mode === "doubt"
          ? profileChecked && ctx.latestDoubtId !== null && ctx.latestQuiz !== null
          : modeInfo.quizPassed
            ? profileChecked && progressUpdated
            : profileChecked && progressUpdated && weaknessFlagged && ctx.latestQuiz !== null;

      const allowTools = !requiredToolsDone && totalToolCalls < MAX_TOOL_CALLS;

      let response: Pick<ChatCompletion, "choices">;
      try {
        response = await this.client.chat.completions.create({
          model,
          messages,
          temperature: 0.2,
          ...(allowTools
            ? { tools: GYANSETU_GROQ_TOOLS, tool_choice: "auto" }
            : { response_format: { type: "json_object" } }),
        });
      } catch (err) {
        const recovered = extractFailedJsonToolCall(err);
        if (recovered && requiredToolsDone) {
          return { text: recovered, toolTrace, ctx };
        }
        if (isToolUseFailedError(err)) {
          messages.push({
            role: "user",
            content: requiredToolsDone
              ? "Do NOT call a tool named 'json'. Output ONLY the raw JSON object directly as your text reply."
              : "Do NOT call a tool named 'json'. Only call one of the 5 declared tools: get_student_profile, log_doubt, generate_quiz, update_progress, flag_class_weakness.",
          });
          continue;
        }
        throw err;
      }

      const choice = response.choices[0];
      const message = choice?.message;
      const toolCalls = message?.tool_calls ?? [];

      if (toolCalls.length === 0) {
        const finalText = message?.content?.trim() ?? "";
        if (!finalText) {
          throw new Error("Groq returned an empty response.");
        }
        return { text: finalText, toolTrace, ctx };
      }

      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const parsedArgs = parseToolArguments(tc.function.arguments);
        const result = await this.dispatchCall(tc, parsedArgs, ctx, {
          totalToolCalls,
          profileChecked,
        });

        if (tc.function.name === "get_student_profile" && !("error" in result)) {
          profileChecked = true;
        } else if (tc.function.name === "update_progress" && !("error" in result)) {
          progressUpdated = true;
        } else if (tc.function.name === "flag_class_weakness" && !("error" in result)) {
          weaknessFlagged = true;
        }
        totalToolCalls += 1;

        toolTrace.push({
          step: toolTrace.length + 1,
          name: tc.function.name,
          args: parsedArgs,
          result,
        });

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }

    throw new Error("GyanSetu exceeded maximum reasoning turns without producing a final JSON response.");
  }

  private async dispatchCall(
    tc: ChatCompletionMessageToolCall,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
    state: { totalToolCalls: number; profileChecked: boolean }
  ): Promise<Record<string, unknown>> {
    const name = tc.function.name;

    if (state.totalToolCalls >= MAX_TOOL_CALLS) {
      return {
        error: `Tool call limit reached (max ${MAX_TOOL_CALLS} tool calls per request). Produce your final JSON response now.`,
      };
    }

    if (!state.profileChecked && name !== "get_student_profile") {
      return {
        error: "Rule violation: Never answer or call other tools before calling get_student_profile.",
      };
    }

    return this.executor.execute(name, args, ctx);
  }
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function extractJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    }
    throw new Error(`Model did not return valid JSON. Received: ${trimmed.slice(0, 200)}`);
  }
}

export function difficultyForMastery(mastery: number): QuizDifficulty {
  if (mastery < 0.4) return "easy";
  if (mastery < 0.7) return "medium";
  return "hard";
}

function getGroqErrorPayload(err: unknown): { code?: string; failed_generation?: string } | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as {
    error?: { code?: string; failed_generation?: string; error?: { code?: string; failed_generation?: string } };
    message?: string;
  };
  if (anyErr.error?.error) return anyErr.error.error;
  if (anyErr.error) return anyErr.error;
  if (typeof anyErr.message === "string") {
    const jsonStart = anyErr.message.indexOf("{");
    if (jsonStart !== -1) {
      try {
        const parsed = JSON.parse(anyErr.message.slice(jsonStart)) as {
          error?: { code?: string; failed_generation?: string };
          code?: string;
          failed_generation?: string;
        };
        return parsed.error ?? parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function isToolUseFailedError(err: unknown): boolean {
  const payload = getGroqErrorPayload(err);
  if (payload?.code === "tool_use_failed") return true;
  if (err instanceof Error && err.message.includes("tool_use_failed")) return true;
  return false;
}

export function extractFailedJsonToolCall(err: unknown): string | null {
  const payload = getGroqErrorPayload(err);
  const failed = payload?.failed_generation;
  if (!failed || typeof failed !== "string") return null;

  try {
    const parsed = extractJsonFromText(failed) as {
      name?: string;
      arguments?: unknown;
    };
    if (parsed && parsed.name === "json" && parsed.arguments !== undefined) {
      return typeof parsed.arguments === "string"
        ? parsed.arguments
        : JSON.stringify(parsed.arguments);
    }
  } catch {
    // Also handle <function=json>{...}</function> format if emitted by Llama
    const fnMatch = failed.match(/<function=json>([\s\S]*?)<\/function>/i);
    if (fnMatch) {
      return fnMatch[1].trim();
    }
  }
  return null;
}

