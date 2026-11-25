import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  ClassWeaknessRecord,
  DoubtRecord,
  ExplanationLevel,
  PublicQuiz,
  QuizDifficulty,
  QuizQuestion,
  QuizRecord,
  StudentProfile,
  StudentRecord,
  SupportedLanguage,
  TopicMasteryRecord,
} from "./types.js";

export class GyanSetuDb {
  public readonly db: DatabaseSync;

  constructor(dbPath: string = process.env.DB_PATH || "./data/gyansetu.db") {
    if (dbPath !== ":memory:") {
      const resolved = path.resolve(dbPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      this.db = new DatabaseSync(resolved);
    } else {
      this.db = new DatabaseSync(":memory:");
    }

    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initSchema();
    this.seedDefaults();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        college TEXT NOT NULL,
        branch TEXT NOT NULL,
        semester INTEGER NOT NULL,
        language TEXT NOT NULL CHECK(language IN ('English', 'Kannada', 'Hindi')),
        class_id TEXT NOT NULL,
        pin TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topic_mastery (
        student_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        mastery REAL NOT NULL CHECK(mastery >= 0.0 AND mastery <= 1.0),
        attempts INTEGER NOT NULL DEFAULT 0,
        failed_analogies_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (student_id, topic),
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS doubts (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        question TEXT NOT NULL,
        has_image INTEGER NOT NULL DEFAULT 0,
        prerequisite_gap TEXT,
        chosen_level TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS quizzes (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        difficulty TEXT NOT NULL CHECK(difficulty IN ('easy', 'medium', 'hard')),
        language TEXT NOT NULL CHECK(language IN ('English', 'Kannada', 'Hindi')),
        questions_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS quiz_attempts (
        id TEXT PRIMARY KEY,
        quiz_id TEXT,
        student_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        missed_concepts_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS class_weaknesses (
        id TEXT PRIMARY KEY,
        class_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        prerequisite_gap TEXT,
        reason TEXT NOT NULL,
        flag_count INTEGER NOT NULL DEFAULT 1,
        last_flagged_at TEXT NOT NULL,
        UNIQUE(class_id, topic)
      );
    `);

    // Migrate pre-existing databases that lack the students.pin column
    const cols = this.db.prepare("PRAGMA table_info(students)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "pin")) {
      this.db.exec("ALTER TABLE students ADD COLUMN pin TEXT NOT NULL DEFAULT '';");
    }
  }

  private seedDefaults(): void {
    const defaultPins: Array<[string, string]> = [
      ["stu-aarav", "1111"],
      ["stu-ananya", "2222"],
      ["stu-rohan", "3333"],
    ];

    const row = this.db.prepare("SELECT COUNT(*) AS cnt FROM students").get() as { cnt: number };
    if (row.cnt > 0) {
      // Backfill PIN hashes for seeded students if migrated from an older DB without pin
      const updatePin = this.db.prepare("UPDATE students SET pin = ? WHERE id = ? AND (pin IS NULL OR pin = '')");
      for (const [id, pin] of defaultPins) {
        updatePin.run(hashPin(pin), id);
      }
      return;
    }

    const now = new Date().toISOString();

    const insertStudent = this.db.prepare(`
      INSERT INTO students (id, name, college, branch, semester, language, class_id, pin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStudent.run(
      "stu-aarav",
      "Aarav Sharma",
      "NIT Surathkal",
      "B.Tech CSE",
      4,
      "English",
      "CSE-SEM4-A",
      hashPin("1111"),
      now
    );
    insertStudent.run(
      "stu-ananya",
      "Ananya Rao",
      "RV College of Engineering, Bengaluru",
      "B.E. ECE",
      3,
      "Kannada",
      "ECE-SEM3-B",
      hashPin("2222"),
      now
    );
    insertStudent.run(
      "stu-rohan",
      "Rohan Verma",
      "MNNIT Allahabad",
      "B.Tech Mechanical",
      5,
      "Hindi",
      "ME-SEM5-A",
      hashPin("3333"),
      now
    );

    const insertMastery = this.db.prepare(`
      INSERT INTO topic_mastery (student_id, topic, mastery, attempts, failed_analogies_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    // Aarav: low mastery in Recursion (triggers simple), medium in DBMS Normalization (standard), high in Arrays (advanced)
    insertMastery.run("stu-aarav", "Recursion & Call Stack", 0.28, 2, JSON.stringify(["Russian nesting dolls"]), now);
    insertMastery.run("stu-aarav", "DBMS Normalization", 0.55, 3, JSON.stringify([]), now);
    insertMastery.run("stu-aarav", "Dynamic Programming", 0.78, 4, JSON.stringify([]), now);

    // Ananya: Kannada learner, low mastery in Kirchhoff's Laws, medium in Op-Amps
    insertMastery.run("stu-ananya", "Kirchhoff's Laws", 0.32, 1, JSON.stringify(["Water pipe pressure"]), now);
    insertMastery.run("stu-ananya", "Operational Amplifiers", 0.58, 2, JSON.stringify([]), now);

    // Rohan: Hindi learner, low mastery in Thermodynamics Entropy, high in Fluid Mechanics
    insertMastery.run("stu-rohan", "Entropy & Second Law", 0.35, 2, JSON.stringify([]), now);
    insertMastery.run("stu-rohan", "Bernoulli's Principle", 0.81, 5, JSON.stringify([]), now);
  }

  public listStudents(): StudentRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, college, branch, semester, language, class_id, created_at
         FROM students ORDER BY created_at ASC`
      )
      .all() as Array<{
      id: string;
      name: string;
      college: string;
      branch: string;
      semester: number;
      language: SupportedLanguage;
      class_id: string;
      created_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      college: r.college,
      branch: r.branch,
      semester: r.semester,
      language: r.language,
      classId: r.class_id,
      createdAt: r.created_at,
    }));
  }

  public getStudent(studentId: string): StudentRecord | null {
    const r = this.db
      .prepare(
        `SELECT id, name, college, branch, semester, language, class_id, created_at
         FROM students WHERE id = ?`
      )
      .get(studentId) as
      | {
          id: string;
          name: string;
          college: string;
          branch: string;
          semester: number;
          language: SupportedLanguage;
          class_id: string;
          created_at: string;
        }
      | undefined;

    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      college: r.college,
      branch: r.branch,
      semester: r.semester,
      language: r.language,
      classId: r.class_id,
      createdAt: r.created_at,
    };
  }

  public listLoginOptions(): Array<{ id: string; name: string }> {
    return this.db
      .prepare("SELECT id, name FROM students ORDER BY created_at ASC")
      .all() as Array<{ id: string; name: string }>;
  }

  public verifyStudentPin(studentId: string, pin: string): boolean {
    const row = this.db
      .prepare("SELECT pin FROM students WHERE id = ?")
      .get(studentId) as { pin: string } | undefined;
    if (!row || !row.pin) return false;
    return verifyPinHash(pin, row.pin);
  }

  public createStudent(input: {
    name: string;
    college: string;
    branch: string;
    semester: number;
    language: SupportedLanguage;
    classId?: string;
    pin?: string;
  }): StudentRecord {
    const id = `stu-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const classId =
      input.classId?.trim() ||
      `${input.branch.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "GEN"}-SEM${input.semester}`;
    const pinHash = hashPin(input.pin?.trim() || "0000");

    this.db
      .prepare(
        `INSERT INTO students (id, name, college, branch, semester, language, class_id, pin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name.trim(),
        input.college.trim(),
        input.branch.trim(),
        input.semester,
        input.language,
        classId,
        pinHash,
        now
      );

    return this.getStudent(id)!;
  }

  public updateStudentLanguage(studentId: string, language: SupportedLanguage): StudentRecord | null {
    const res = this.db
      .prepare("UPDATE students SET language = ? WHERE id = ?")
      .run(language, studentId);
    if (res.changes === 0) return null;
    return this.getStudent(studentId);
  }

  public getStudentProfile(studentId: string): StudentProfile | null {
    const student = this.getStudent(studentId);
    if (!student) return null;

    const masteryRows = this.db
      .prepare(
        `SELECT topic, mastery, attempts, failed_analogies_json, updated_at
         FROM topic_mastery WHERE student_id = ? ORDER BY updated_at DESC`
      )
      .all(studentId) as Array<{
      topic: string;
      mastery: number;
      attempts: number;
      failed_analogies_json: string;
      updated_at: string;
    }>;

    const topicMastery: TopicMasteryRecord[] = masteryRows.map((m) => ({
      topic: m.topic,
      mastery: Number(m.mastery.toFixed(2)),
      attempts: m.attempts,
      failedAnalogies: safeParseJsonArray(m.failed_analogies_json),
      updatedAt: m.updated_at,
    }));

    const averageMastery =
      topicMastery.length > 0
        ? Number((topicMastery.reduce((acc, item) => acc + item.mastery, 0) / topicMastery.length).toFixed(2))
        : 0.35;

    const doubtRows = this.db
      .prepare(
        `SELECT id, student_id, topic, question, has_image, prerequisite_gap, chosen_level, created_at
         FROM doubts WHERE student_id = ? ORDER BY created_at DESC LIMIT 10`
      )
      .all(studentId) as Array<{
      id: string;
      student_id: string;
      topic: string;
      question: string;
      has_image: number;
      prerequisite_gap: string | null;
      chosen_level: ExplanationLevel | null;
      created_at: string;
    }>;

    const recentDoubts: DoubtRecord[] = doubtRows.map((d) => ({
      id: d.id,
      studentId: d.student_id,
      topic: d.topic,
      question: d.question,
      hasImage: d.has_image === 1,
      prerequisiteGap: d.prerequisite_gap,
      chosenLevel: d.chosen_level,
      createdAt: d.created_at,
    }));

    const failedAnalogiesByTopic: Record<string, string[]> = {};
    for (const tm of topicMastery) {
      if (tm.failedAnalogies.length > 0) {
        failedAnalogiesByTopic[tm.topic] = tm.failedAnalogies;
      }
    }

    return {
      student,
      averageMastery,
      topicMastery,
      recentDoubts,
      failedAnalogiesByTopic,
    };
  }

  public logDoubt(input: {
    studentId: string;
    topic: string;
    question: string;
    hasImage?: boolean;
    prerequisiteGap?: string | null;
  }): { doubtId: string; topicMastery: number; failedAnalogies: string[] } {
    const id = `dbt-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const topic = input.topic.trim();

    this.db
      .prepare(
        `INSERT INTO doubts (id, student_id, topic, question, has_image, prerequisite_gap, chosen_level, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.studentId,
        topic,
        input.question.trim(),
        input.hasImage ? 1 : 0,
        input.prerequisiteGap ?? null,
        null,
        now
      );

    // Check existing topic mastery (fuzzy case-insensitive match first, else default 0.35)
    const existing = this.findTopicMastery(input.studentId, topic);
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO topic_mastery (student_id, topic, mastery, attempts, failed_analogies_json, updated_at)
           VALUES (?, ?, ?, 0, '[]', ?)`
        )
        .run(input.studentId, topic, 0.35, now);
      return { doubtId: id, topicMastery: 0.35, failedAnalogies: [] };
    }

    return {
      doubtId: id,
      topicMastery: Number(existing.mastery.toFixed(2)),
      failedAnalogies: existing.failedAnalogies,
    };
  }

  public updateDoubtMetadata(doubtId: string, chosenLevel: ExplanationLevel, prerequisiteGap: string | null): void {
    this.db
      .prepare("UPDATE doubts SET chosen_level = ?, prerequisite_gap = COALESCE(?, prerequisite_gap) WHERE id = ?")
      .run(chosenLevel, prerequisiteGap, doubtId);
  }

  public saveQuiz(input: {
    studentId: string;
    topic: string;
    difficulty: QuizDifficulty;
    language: SupportedLanguage;
    questions: QuizQuestion[];
  }): QuizRecord {
    const id = `qz-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO quizzes (id, student_id, topic, difficulty, language, questions_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.studentId, input.topic.trim(), input.difficulty, input.language, JSON.stringify(input.questions), now);

    return {
      id,
      studentId: input.studentId,
      topic: input.topic.trim(),
      difficulty: input.difficulty,
      language: input.language,
      questions: input.questions,
      createdAt: now,
    };
  }

  public getQuiz(quizId: string): QuizRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, student_id, topic, difficulty, language, questions_json, created_at
         FROM quizzes WHERE id = ?`
      )
      .get(quizId) as
      | {
          id: string;
          student_id: string;
          topic: string;
          difficulty: QuizDifficulty;
          language: SupportedLanguage;
          questions_json: string;
          created_at: string;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      studentId: row.student_id,
      topic: row.topic,
      difficulty: row.difficulty,
      language: row.language,
      questions: JSON.parse(row.questions_json) as QuizQuestion[],
      createdAt: row.created_at,
    };
  }

  public toPublicQuiz(quiz: QuizRecord): PublicQuiz {
    return {
      id: quiz.id,
      topic: quiz.topic,
      difficulty: quiz.difficulty,
      language: quiz.language,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options,
        concept: q.concept,
      })),
    };
  }

  public updateProgress(input: {
    studentId: string;
    topic: string;
    quizId?: string;
    score: number;
    total: number;
    missedConcepts?: string[];
    failedAnalogy?: string;
  }): { previousMastery: number; newMastery: number; attempts: number; passed: boolean } {
    const now = new Date().toISOString();
    const topic = input.topic.trim();
    const existing = this.findTopicMastery(input.studentId, topic);
    const previousMastery = existing ? existing.mastery : 0.35;
    const prevAttempts = existing ? existing.attempts : 0;
    const failedAnalogies = existing ? [...existing.failedAnalogies] : [];

    const ratio = input.total > 0 ? input.score / input.total : 0;
    const passed = ratio >= 2 / 3;

    // Weighted mastery update: passing boosts mastery significantly, failing lowers slightly
    const delta = passed ? 0.18 * ratio : -0.1 * (1 - ratio);
    const newMastery = Number(Math.max(0.05, Math.min(0.99, previousMastery + delta)).toFixed(2));

    if (!passed && input.failedAnalogy?.trim()) {
      const cleaned = input.failedAnalogy.trim();
      if (!failedAnalogies.includes(cleaned)) {
        failedAnalogies.push(cleaned);
      }
    }

    const targetTopic = existing ? existing.topic : topic;

    this.db
      .prepare(
        `INSERT INTO topic_mastery (student_id, topic, mastery, attempts, failed_analogies_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(student_id, topic) DO UPDATE SET
           mastery = excluded.mastery,
           attempts = excluded.attempts,
           failed_analogies_json = excluded.failed_analogies_json,
           updated_at = excluded.updated_at`
      )
      .run(
        input.studentId,
        targetTopic,
        newMastery,
        prevAttempts + 1,
        JSON.stringify(failedAnalogies),
        now
      );

    this.db
      .prepare(
        `INSERT INTO quiz_attempts (id, quiz_id, student_id, topic, score, total, missed_concepts_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `att-${crypto.randomUUID().slice(0, 8)}`,
        input.quizId ?? null,
        input.studentId,
        targetTopic,
        input.score,
        input.total,
        JSON.stringify(input.missedConcepts ?? []),
        now
      );

    return {
      previousMastery: Number(previousMastery.toFixed(2)),
      newMastery,
      attempts: prevAttempts + 1,
      passed,
    };
  }

  public flagClassWeakness(input: {
    classId: string;
    topic: string;
    prerequisiteGap?: string | null;
    reason: string;
  }): ClassWeaknessRecord {
    const now = new Date().toISOString();
    const topic = input.topic.trim();
    const classId = input.classId.trim();

    const existing = this.db
      .prepare(
        `SELECT id, class_id, topic, prerequisite_gap, reason, flag_count, last_flagged_at
         FROM class_weaknesses WHERE class_id = ? AND LOWER(topic) = LOWER(?)`
      )
      .get(classId, topic) as
      | {
          id: string;
          class_id: string;
          topic: string;
          prerequisite_gap: string | null;
          reason: string;
          flag_count: number;
          last_flagged_at: string;
        }
      | undefined;

    if (existing) {
      const nextCount = existing.flag_count + 1;
      this.db
        .prepare(
          `UPDATE class_weaknesses
           SET flag_count = ?, prerequisite_gap = COALESCE(?, prerequisite_gap), reason = ?, last_flagged_at = ?
           WHERE id = ?`
        )
        .run(nextCount, input.prerequisiteGap ?? null, input.reason.trim(), now, existing.id);

      return {
        id: existing.id,
        classId: existing.class_id,
        topic: existing.topic,
        prerequisiteGap: input.prerequisiteGap ?? existing.prerequisite_gap,
        reason: input.reason.trim(),
        flagCount: nextCount,
        lastFlaggedAt: now,
      };
    }

    const id = `wk-${crypto.randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO class_weaknesses (id, class_id, topic, prerequisite_gap, reason, flag_count, last_flagged_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
      .run(id, classId, topic, input.prerequisiteGap ?? null, input.reason.trim(), now);

    return {
      id,
      classId,
      topic,
      prerequisiteGap: input.prerequisiteGap ?? null,
      reason: input.reason.trim(),
      flagCount: 1,
      lastFlaggedAt: now,
    };
  }

  public listClassWeaknesses(): ClassWeaknessRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, class_id, topic, prerequisite_gap, reason, flag_count, last_flagged_at
         FROM class_weaknesses ORDER BY flag_count DESC, last_flagged_at DESC`
      )
      .all() as Array<{
      id: string;
      class_id: string;
      topic: string;
      prerequisite_gap: string | null;
      reason: string;
      flag_count: number;
      last_flagged_at: string;
    }>;

    const missedStmt = this.db.prepare(
      `SELECT qa.missed_concepts_json
       FROM quiz_attempts qa
       JOIN students s ON s.id = qa.student_id
       WHERE s.class_id = ? AND LOWER(qa.topic) = LOWER(?)
       ORDER BY qa.created_at DESC`
    );

    return rows.map((r) => {
      const attemptRows = missedStmt.all(r.class_id, r.topic) as Array<{
        missed_concepts_json: string;
      }>;
      const seen = new Set<string>();
      for (const att of attemptRows) {
        for (const concept of safeParseJsonArray(att.missed_concepts_json)) {
          const clean = concept.trim();
          if (clean) seen.add(clean);
        }
      }

      return {
        id: r.id,
        classId: r.class_id,
        topic: r.topic,
        prerequisiteGap: r.prerequisite_gap,
        reason: r.reason,
        flagCount: r.flag_count,
        lastFlaggedAt: r.last_flagged_at,
        missedConcepts: Array.from(seen),
      };
    });
  }

  private findTopicMastery(studentId: string, topic: string): TopicMasteryRecord | null {
    const row = this.db
      .prepare(
        `SELECT topic, mastery, attempts, failed_analogies_json, updated_at
         FROM topic_mastery WHERE student_id = ? AND LOWER(topic) = LOWER(?)`
      )
      .get(studentId, topic) as
      | {
          topic: string;
          mastery: number;
          attempts: number;
          failed_analogies_json: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return null;
    return {
      topic: row.topic,
      mastery: row.mastery,
      attempts: row.attempts,
      failedAnalogies: safeParseJsonArray(row.failed_analogies_json),
      updatedAt: row.updated_at,
    };
  }
}

function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(pin, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPinHash(pin: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = crypto.scryptSync(pin, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

