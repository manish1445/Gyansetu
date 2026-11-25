import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { GyanSetuDb } from "./db.js";
import {
  DEFAULT_GROQ_MODEL,
  DEFAULT_GROQ_VISION_MODEL,
  GyanSetuAgent,
  createGroqClient,
} from "./agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SESSION_COOKIE_NAME = "gs_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type UserRole = "student" | "teacher";

export interface SessionRecord {
  role: UserRole;
  studentId: string | null;
  expiresAt: number;
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const rawKey = part.slice(0, eqIdx).trim();
    const rawVal = part.slice(eqIdx + 1).trim();
    if (!rawKey) continue;
    try {
      result[decodeURIComponent(rawKey)] = decodeURIComponent(rawVal);
    } catch {
      result[rawKey] = rawVal;
    }
  }
  return result;
}

function timingSafeTextEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

const LoginSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("student"),
    studentId: z.string().trim().min(1),
    pin: z.string().trim().min(1),
  }),
  z.object({
    role: z.literal("teacher"),
    passcode: z.string().min(1),
  }),
]);

const CreateStudentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  college: z.string().trim().min(2).max(120),
  branch: z.string().trim().min(2).max(80),
  semester: z.coerce.number().int().min(1).max(10),
  language: z.enum(["English", "Kannada", "Hindi"]),
  classId: z.string().trim().max(40).optional(),
  pin: z.string().trim().min(4).max(12).optional(),
});

const UpdateLanguageSchema = z.object({
  language: z.enum(["English", "Kannada", "Hindi"]),
});

const DoubtRequestSchema = z.object({
  studentId: z.string().trim().min(1).optional(),
  question: z.string().max(4000).default(""),
  imageBase64: z.string().optional(),
  imageMimeType: z
    .enum(["image/png", "image/jpeg", "image/webp", "image/gif"])
    .optional(),
});

const QuizResultRequestSchema = z.object({
  studentId: z.string().trim().min(1).optional(),
  quizId: z.string().trim().min(1),
  answers: z.array(z.number().int().min(0).max(3)).length(3),
  failedAnalogy: z.string().max(500).optional(),
});

export interface AppOptions {
  db?: GyanSetuDb;
  agentFactory?: () => GyanSetuAgent | null;
  publicDir?: string;
}

export function createApp(options: AppOptions = {}) {
  const db = options.db ?? new GyanSetuDb();
  const app = express();
  const sessions = new Map<string, SessionRecord>();

  app.use(express.json({ limit: "8mb" }));

  const publicDir = options.publicDir ?? path.resolve(__dirname, "../../public");
  app.use(express.static(publicDir));

  const getSession = (req: Request): { token: string; session: SessionRecord } | null => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    return { token, session };
  };

  const requireAuth = (req: Request, res: Response): SessionRecord | null => {
    const found = getSession(req);
    if (!found) {
      res.status(401).json({ error: "Authentication required. Please log in." });
      return null;
    }
    return found.session;
  };

  const resolveTargetStudentId = (
    session: SessionRecord,
    requestedId: string | undefined,
    res: Response
  ): string | null => {
    if (session.role === "student") {
      if (!session.studentId) {
        res.status(401).json({ error: "Invalid student session." });
        return null;
      }
      if (requestedId && requestedId !== "me" && requestedId !== session.studentId) {
        res.status(403).json({ error: "You can only access your own student workspace." });
        return null;
      }
      return session.studentId;
    }
    if (!requestedId || requestedId === "me") {
      res.status(400).json({ error: "studentId is required for teacher requests." });
      return null;
    }
    return requestedId;
  };

  const getAgent = (): GyanSetuAgent | null => {
    if (options.agentFactory) {
      return options.agentFactory();
    }
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey || apiKey === "your_groq_api_key_here") {
      return null;
    }
    const client = createGroqClient(apiKey);
    return new GyanSetuAgent(client, db);
  };

  app.get("/api/health", (_req: Request, res: Response) => {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    const groqConfigured = Boolean(apiKey && apiKey !== "your_groq_api_key_here");
    res.json({
      ok: true,
      groqConfigured,
      model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
      visionModel: process.env.GROQ_VISION_MODEL || DEFAULT_GROQ_VISION_MODEL,
    });
  });

  app.get("/api/login-options", (_req: Request, res: Response) => {
    res.json({ students: db.listLoginOptions() });
  });

  app.post("/api/login", (req: Request, res: Response) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please enter your login credentials." });
      return;
    }

    let role: UserRole;
    let studentId: string | null = null;

    if (parsed.data.role === "student") {
      const student = db.getStudent(parsed.data.studentId);
      if (!student || !db.verifyStudentPin(parsed.data.studentId, parsed.data.pin)) {
        res.status(401).json({ error: "Invalid student selection or PIN. Please try again." });
        return;
      }
      role = "student";
      studentId = student.id;
    } else {
      const expectedPasscode = process.env.TEACHER_PASSCODE || "teacher123";
      if (!timingSafeTextEqual(parsed.data.passcode, expectedPasscode)) {
        res.status(401).json({ error: "Incorrect teacher passcode. Please try again." });
        return;
      }
      role = "teacher";
      studentId = null;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set(token, { role, studentId, expiresAt });

    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS,
    });

    res.json({ role, studentId });
  });

  app.post("/api/logout", (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      sessions.delete(token);
    }
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    res.json({ ok: true });
  });

  app.get("/api/me", (req: Request, res: Response) => {
    const found = getSession(req);
    if (!found) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }
    res.json({
      role: found.session.role,
      studentId: found.session.studentId,
    });
  });

  app.get("/api/students", (req: Request, res: Response) => {
    const session = requireAuth(req, res);
    if (!session) return;

    if (session.role === "student" && session.studentId) {
      const student = db.getStudent(session.studentId);
      res.json({ students: student ? [student] : [] });
      return;
    }
    res.json({ students: db.listStudents() });
  });

  app.post("/api/students", (req: Request, res: Response) => {
    const session = requireAuth(req, res);
    if (!session) return;
    if (session.role !== "teacher") {
      res.status(403).json({ error: "Only teachers can create new student profiles." });
      return;
    }

    const parsed = CreateStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid student details.", details: parsed.error.flatten() });
      return;
    }
    const student = db.createStudent(parsed.data);
    res.status(201).json({ student, profile: db.getStudentProfile(student.id) });
  });

  app.patch("/api/students/:id/language", (req: Request, res: Response) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const studentId = resolveTargetStudentId(session, String(req.params.id), res);
    if (!studentId) return;

    const parsed = UpdateLanguageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Unsupported language." });
      return;
    }
    const updated = db.updateStudentLanguage(studentId, parsed.data.language);
    if (!updated) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json({ student: updated, profile: db.getStudentProfile(updated.id) });
  });

  app.get("/api/students/:id/profile", (req: Request, res: Response) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const studentId = resolveTargetStudentId(session, String(req.params.id), res);
    if (!studentId) return;

    const profile = db.getStudentProfile(studentId);
    if (!profile) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json({ profile });
  });

  app.get("/api/class-weaknesses", (req: Request, res: Response) => {
    const session = requireAuth(req, res);
    if (!session) return;
    if (session.role !== "teacher") {
      res.status(403).json({ error: "Only teachers can view class weaknesses." });
      return;
    }
    res.json({ weaknesses: db.listClassWeaknesses() });
  });

  app.post("/api/doubt", async (req: Request, res: Response) => {
    const session = requireAuth(req, res);
    if (!session) return;
    if (session.role !== "student") {
      res.status(403).json({ error: "Teachers cannot ask doubts or take quizzes." });
      return;
    }

    const parsed = DoubtRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid doubt payload.", details: parsed.error.flatten() });
      return;
    }

    const { studentId: requestedStudentId, question, imageBase64, imageMimeType } = parsed.data;
    const studentId = resolveTargetStudentId(session, requestedStudentId, res);
    if (!studentId) return;

    if (!question.trim() && !imageBase64) {
      res.status(400).json({ error: "Please enter a question or attach an image." });
      return;
    }

    const student = db.getStudent(studentId);
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }

    const agent = getAgent();
    if (!agent) {
      res.status(503).json({
        error: "GROQ_API_KEY is not configured. Add it to .env and restart the server.",
      });
      return;
    }

    try {
      const result = await agent.handleDoubt({
        studentId,
        question,
        imageBase64,
        imageMimeType,
      });
      res.json({
        tutorResponse: result.tutorResponse,
        quiz: result.quiz ? db.toPublicQuiz(result.quiz) : null,
        toolTrace: result.toolTrace,
        profile: db.getStudentProfile(studentId),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to process doubt.";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/quiz-result", async (req: Request, res: Response) => {
    const session = requireAuth(req, res);
    if (!session) return;
    if (session.role !== "student") {
      res.status(403).json({ error: "Teachers cannot ask doubts or take quizzes." });
      return;
    }

    const parsed = QuizResultRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid quiz submission.", details: parsed.error.flatten() });
      return;
    }

    const { studentId: requestedStudentId, quizId, answers, failedAnalogy } = parsed.data;
    const studentId = resolveTargetStudentId(session, requestedStudentId, res);
    if (!studentId) return;

    const student = db.getStudent(studentId);
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }

    const quiz = db.getQuiz(quizId);
    if (!quiz) {
      res.status(404).json({ error: "Quiz not found." });
      return;
    }
    if (session.role === "student" && quiz.studentId !== studentId) {
      res.status(403).json({ error: "You can only submit your own quiz." });
      return;
    }

    const agent = getAgent();
    if (!agent) {
      res.status(503).json({
        error: "GROQ_API_KEY is not configured. Add it to .env and restart the server.",
      });
      return;
    }

    let score = 0;
    const missedConcepts: string[] = [];
    const breakdown = quiz.questions.map((q, idx) => {
      const selectedIndex = answers[idx];
      const isCorrect = selectedIndex === q.correctIndex;
      if (isCorrect) {
        score += 1;
      } else {
        missedConcepts.push(q.concept);
      }
      return {
        questionId: q.id,
        question: q.question,
        selectedIndex,
        correctIndex: q.correctIndex,
        isCorrect,
        concept: q.concept,
        explanation: q.explanation,
      };
    });

    try {
      const result = await agent.handleQuizResult({
        studentId,
        quizId,
        topic: quiz.topic,
        score,
        total: quiz.questions.length,
        missedConcepts,
        failedAnalogy,
      });

      res.json({
        graded: {
          score,
          total: quiz.questions.length,
          passed: score >= 2,
          breakdown,
        },
        tutorResponse: result.tutorResponse,
        retryQuiz: result.retryQuiz ? db.toPublicQuiz(result.retryQuiz) : null,
        toolTrace: result.toolTrace,
        profile: db.getStudentProfile(studentId),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to evaluate quiz result.";
      res.status(500).json({ error: message });
    }
  });

  return { app, db };
}
