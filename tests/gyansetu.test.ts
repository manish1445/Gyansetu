import { describe, it, expect, beforeEach } from "vitest";
import { GyanSetuDb } from "../src/server/db.js";
import {
  DEFAULT_GROQ_MODEL,
  DEFAULT_GROQ_VISION_MODEL,
  GyanSetuAgent,
  MAX_TOOL_CALLS,
  extractJsonFromText,
  type GroqClientLike,
} from "../src/server/agent.js";
import { createApp, parseCookies, SESSION_COOKIE_NAME } from "../src/server/app.js";
import type { QuizQuestion } from "../src/server/types.js";

function makeStubQuestions(topic: string): QuizQuestion[] {
  return [
    {
      id: "q-1",
      question: `Q1 about ${topic}?`,
      options: ["A", "B", "C", "D"],
      correctIndex: 0,
      concept: "Base Concept",
      explanation: "A is correct.",
    },
    {
      id: "q-2",
      question: `Q2 about ${topic}?`,
      options: ["A", "B", "C", "D"],
      correctIndex: 1,
      concept: "Edge Case",
      explanation: "B is correct.",
    },
    {
      id: "q-3",
      question: `Q3 about ${topic}?`,
      options: ["A", "B", "C", "D"],
      correctIndex: 2,
      concept: "Application",
      explanation: "C is correct.",
    },
  ];
}

function createScriptedMockGroq(
  turns: Array<{
    toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    text?: string;
  }>,
  capturedModels: string[] = []
): GroqClientLike {
  let idx = 0;
  return {
    chat: {
      completions: {
        async create(body) {
          capturedModels.push(body.model);
          const current = turns[idx] ?? turns[turns.length - 1];
          idx += 1;

          if (current.toolCalls && current.toolCalls.length > 0) {
            return {
              choices: [
                {
                  index: 0,
                  finish_reason: "tool_calls",
                  logprobs: null,
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: current.toolCalls.map((tc) => ({
                      id: tc.id,
                      type: "function" as const,
                      function: {
                        name: tc.name,
                        arguments: JSON.stringify(tc.args),
                      },
                    })),
                  },
                },
              ],
            };
          }

          return {
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                logprobs: null,
                message: {
                  role: "assistant",
                  content: current.text ?? "",
                },
              },
            ],
          };
        },
      },
    },
  };
}

describe("GyanSetuDb", () => {
  let db: GyanSetuDb;

  beforeEach(() => {
    db = new GyanSetuDb(":memory:");
  });

  it("seeds 3 Indian college students across English, Kannada, and Hindi", () => {
    const students = db.listStudents();
    expect(students.length).toBe(3);
    expect(students.map((s) => s.language)).toEqual(["English", "Kannada", "Hindi"]);
  });

  it("tracks doubts, mastery updates, failed analogies, and class weaknesses", () => {
    const logged = db.logDoubt({
      studentId: "stu-aarav",
      topic: "Pointers in C",
      question: "What does dereferencing a pointer mean?",
      prerequisiteGap: "Memory addresses",
    });
    expect(logged.topicMastery).toBe(0.35);

    const failedUpdate = db.updateProgress({
      studentId: "stu-aarav",
      topic: "Pointers in C",
      score: 1,
      total: 3,
      missedConcepts: ["Memory addresses"],
      failedAnalogy: "House street number analogy",
    });
    expect(failedUpdate.passed).toBe(false);
    expect(failedUpdate.newMastery).toBeLessThan(0.35);

    const profile = db.getStudentProfile("stu-aarav");
    expect(profile?.failedAnalogiesByTopic["Pointers in C"]).toContain("House street number analogy");

    const flag1 = db.flagClassWeakness({
      classId: "CSE-SEM4-A",
      topic: "Pointers in C",
      prerequisiteGap: "Memory addresses",
      reason: "Scored 1/3 on diagnostic quiz.",
    });
    const flag2 = db.flagClassWeakness({
      classId: "CSE-SEM4-A",
      topic: "Pointers in C",
      prerequisiteGap: "Memory addresses",
      reason: "Another student scored 0/3.",
    });
    expect(flag1.flagCount).toBe(1);
    expect(flag2.flagCount).toBe(2);
  });
});

describe("GyanSetuAgent (Groq)", () => {
  it("enforces get_student_profile first and runs full Doubt Mode flow", async () => {
    const db = new GyanSetuDb(":memory:");
    const capturedModels: string[] = [];
    const mockGroq = createScriptedMockGroq(
      [
        {
          toolCalls: [
            {
              id: "c1",
              name: "log_doubt",
              args: { student_id: "stu-aarav", topic: "Recursion & Call Stack", question: "Base case?" },
            },
          ],
        },
        {
          toolCalls: [
            { id: "c2", name: "get_student_profile", args: { student_id: "stu-aarav" } },
          ],
        },
        {
          toolCalls: [
            {
              id: "c3",
              name: "log_doubt",
              args: {
                student_id: "stu-aarav",
                topic: "Recursion & Call Stack",
                question: "Why does recursion overflow without a base case?",
                prerequisite_gap: "Function call stack frames",
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              id: "c4",
              name: "generate_quiz",
              args: {
                student_id: "stu-aarav",
                topic: "Recursion & Call Stack",
                difficulty: "easy",
                language: "English",
              },
            },
          ],
        },
        {
          text: JSON.stringify({
            topic: "Recursion & Call Stack",
            level: "simple",
            gap: "Function call stack frames",
            reason: "Your mastery in Recursion & Call Stack is 0.28, which is below 0.40.",
            explanations: {
              simple:
                "Think of climbing down stairs where the ground floor tells you to stop. Without that stop step, you keep stepping forever.",
              standard:
                "Each recursive call pushes a stack frame until a base case returns and unwinds the stack.",
              advanced:
                "Unbounded recursion exhausts finite thread stack memory because tail-call optimization is absent in standard C/JVM frames.",
            },
          }),
        },
      ],
      capturedModels
    );

    const agent = new GyanSetuAgent(
      mockGroq,
      db,
      DEFAULT_GROQ_MODEL,
      DEFAULT_GROQ_VISION_MODEL,
      async ({ topic }) => makeStubQuestions(topic)
    );

    const result = await agent.handleDoubt({
      studentId: "stu-aarav",
      question: "Why does recursion overflow without a base case?",
    });

    expect(capturedModels[0]).toBe(DEFAULT_GROQ_MODEL);
    expect(result.toolTrace[0].name).toBe("log_doubt");
    expect(result.toolTrace[0].result.error).toContain("get_student_profile");
    expect(result.tutorResponse.level).toBe("simple");
    expect(result.quiz?.difficulty).toBe("easy");
    expect(result.quiz?.questions).toHaveLength(3);
  });

  it("uses Groq vision model when an image is attached", async () => {
    const db = new GyanSetuDb(":memory:");
    const capturedModels: string[] = [];
    const mockGroq = createScriptedMockGroq(
      [
        {
          toolCalls: [{ id: "v1", name: "get_student_profile", args: { student_id: "stu-aarav" } }],
        },
        {
          text: JSON.stringify({
            topic: "Circuit Analysis",
            level: "simple",
            gap: "Ohm's Law",
            reason: "Default mastery is below 0.40.",
            explanations: {
              simple: "Voltage pushes current like water pressure through a narrow pipe.",
              standard: "V = IR relates voltage across a resistor to current and resistance.",
              advanced: "Linear resistive elements obey V = IR under lumped-element assumptions.",
            },
          }),
        },
      ],
      capturedModels
    );

    const agent = new GyanSetuAgent(
      mockGroq,
      db,
      DEFAULT_GROQ_MODEL,
      DEFAULT_GROQ_VISION_MODEL,
      async ({ topic }) => makeStubQuestions(topic)
    );

    await agent.handleDoubt({
      studentId: "stu-aarav",
      question: "Explain this circuit.",
      imageBase64: "AAAA",
      imageMimeType: "image/png",
    });

    expect(capturedModels[0]).toBe(DEFAULT_GROQ_VISION_MODEL);
  });

  it("handles Quiz Result Mode retry (<2/3) with class weakness flag and easy retry quiz", async () => {
    const db = new GyanSetuDb(":memory:");
    const mockGroq = createScriptedMockGroq([
      {
        toolCalls: [{ id: "q1", name: "get_student_profile", args: { student_id: "stu-ananya" } }],
      },
      {
        toolCalls: [
          {
            id: "q2",
            name: "update_progress",
            args: {
              student_id: "stu-ananya",
              topic: "Kirchhoff's Laws",
              quiz_id: "qz-1",
              score: 1,
              total: 3,
              missed_concepts: ["KVL loop sign convention"],
              failed_analogy: "Water pipe pressure",
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "q3",
            name: "flag_class_weakness",
            args: {
              student_id: "stu-ananya",
              topic: "Kirchhoff's Laws",
              prerequisite_gap: "Potential difference sign convention",
              reason: "Scored 1/3 on Kirchhoff's Laws quiz.",
            },
          },
          {
            id: "q4",
            name: "generate_quiz",
            args: {
              student_id: "stu-ananya",
              topic: "Kirchhoff's Laws",
              difficulty: "easy",
              language: "Kannada",
            },
          },
        ],
      },
      {
        text: JSON.stringify({
          next: "retry",
          message: "ಒಳ್ಳೆಯ ಪ್ರಯತ್ನ! ಇನ್ನೊಂದು ಸುಲಭ ಉದಾಹರಣೆಯೊಂದಿಗೆ ನೋಡೋಣ.",
          reteach: "ಒಂದು ವೃತ್ತಾಕಾರದ ಮೆಟ್ಟಿಲಿನಲ್ಲಿ ಹತ್ತಿ ಮತ್ತೆ ಅದೇ ಸ್ಥಳಕ್ಕೆ ಬಂದಾಗ ಎತ್ತರದ ಬದಲಾವಣೆ ಸೊನ್ನೆಯಾಗಿರುತ್ತದೆ.",
        }),
      },
    ]);

    const agent = new GyanSetuAgent(
      mockGroq,
      db,
      DEFAULT_GROQ_MODEL,
      DEFAULT_GROQ_VISION_MODEL,
      async ({ topic }) => makeStubQuestions(topic)
    );

    const res = await agent.handleQuizResult({
      studentId: "stu-ananya",
      quizId: "qz-1",
      topic: "Kirchhoff's Laws",
      score: 1,
      total: 3,
      missedConcepts: ["KVL loop sign convention"],
      failedAnalogy: "Water pipe pressure",
    });

    expect(res.toolTrace.length).toBeLessThanOrEqual(MAX_TOOL_CALLS);
    expect(res.tutorResponse.next).toBe("retry");
    expect(res.retryQuiz?.difficulty).toBe("easy");
    expect(db.listClassWeaknesses()[0].topic).toBe("Kirchhoff's Laws");
  });

  it("enforces maximum 6 tool calls per request", async () => {
    const db = new GyanSetuDb(":memory:");
    const mockGroq = createScriptedMockGroq([
      {
        toolCalls: [
          { id: "1", name: "get_student_profile", args: { student_id: "stu-aarav" } },
          { id: "2", name: "log_doubt", args: { student_id: "stu-aarav", topic: "T1", question: "Q" } },
          { id: "3", name: "log_doubt", args: { student_id: "stu-aarav", topic: "T2", question: "Q" } },
          { id: "4", name: "log_doubt", args: { student_id: "stu-aarav", topic: "T3", question: "Q" } },
          { id: "5", name: "log_doubt", args: { student_id: "stu-aarav", topic: "T4", question: "Q" } },
          { id: "6", name: "log_doubt", args: { student_id: "stu-aarav", topic: "T5", question: "Q" } },
          { id: "7", name: "log_doubt", args: { student_id: "stu-aarav", topic: "T6", question: "Q" } },
        ],
      },
      {
        text: JSON.stringify({
          topic: "T1",
          level: "simple",
          gap: null,
          reason: "Mastery is below 0.4.",
          explanations: { simple: "S", standard: "M", advanced: "A" },
        }),
      },
    ]);

    const agent = new GyanSetuAgent(mockGroq, db);
    const res = await agent.handleDoubt({ studentId: "stu-aarav", question: "Q" });
    expect(res.toolTrace[6].result.error).toContain("Tool call limit reached");
  });

  it("extracts JSON cleanly even if wrapped in markdown fences", () => {
    const parsed = extractJsonFromText("```json\n{\"next\":\"advance\",\"message\":\"Great!\"}\n```");
    expect(parsed).toEqual({ next: "advance", message: "Great!" });
  });

  it("recovers when Groq throws tool_use_failed for pseudo-tool 'json' and switches to json_object after required tools", async () => {
    const db = new GyanSetuDb(":memory:");
    let callNum = 0;
    let sawJsonObjectMode = false;

    const mockGroq: GroqClientLike = {
      chat: {
        completions: {
          async create(body) {
            callNum += 1;
            if (callNum === 1) {
              return {
                choices: [
                  {
                    index: 0,
                    finish_reason: "tool_calls",
                    logprobs: null,
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "t1",
                          type: "function",
                          function: { name: "get_student_profile", arguments: '{"student_id":"stu-aarav"}' },
                        },
                        {
                          id: "t2",
                          type: "function",
                          function: {
                            name: "log_doubt",
                            arguments: '{"student_id":"stu-aarav","topic":"Doubly Linked List","question":"How does a doubly linked list work?"}',
                          },
                        },
                      ],
                    },
                  },
                ],
              };
            }
            // Simulate Groq throwing tool_use_failed before generate_quiz was called
            if (callNum === 2) {
              const err = Object.assign(
                new Error(
                  '400 {"error":{"message":"Tool call validation failed: attempted to call tool \'json\' which was not in request.tools","type":"invalid_request_error","code":"tool_use_failed","failed_generation":"{\\"name\\": \\"json\\", \\"arguments\\": {\\"topic\\": \\"Doubly Linked List\\"}}"}}'
                ),
                {
                  status: 400,
                  error: {
                    code: "tool_use_failed",
                    failed_generation: '{"name": "json", "arguments": {"topic": "Doubly Linked List"}}',
                  },
                }
              );
              throw err;
            }
            // After corrective reminder, model calls generate_quiz
            if (callNum === 3) {
              return {
                choices: [
                  {
                    index: 0,
                    finish_reason: "tool_calls",
                    logprobs: null,
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "t3",
                          type: "function",
                          function: {
                            name: "generate_quiz",
                            arguments: '{"student_id":"stu-aarav","topic":"Doubly Linked List","difficulty":"easy","language":"English"}',
                          },
                        },
                      ],
                    },
                  },
                ],
              };
            }
            // Final turn: tools must be omitted and response_format must be json_object
            sawJsonObjectMode = body.tools === undefined && body.response_format?.type === "json_object";
            return {
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  logprobs: null,
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      topic: "Doubly Linked List",
                      level: "simple",
                      gap: "Node pointers in singly linked lists",
                      reason: "Mastery is 0.35, below 0.40.",
                      explanations: {
                        simple: "Imagine train coaches linked front and back so you can walk either way.",
                        standard: "Each node stores data, next, and prev pointers for O(1) bidirectional links.",
                        advanced: "Sentinel head/tail nodes eliminate null checks during O(1) LRU eviction.",
                      },
                    }),
                  },
                },
              ],
            };
          },
        },
      },
    };

    const agent = new GyanSetuAgent(
      mockGroq,
      db,
      DEFAULT_GROQ_MODEL,
      DEFAULT_GROQ_VISION_MODEL,
      async ({ topic }) => makeStubQuestions(topic)
    );

    const res = await agent.handleDoubt({
      studentId: "stu-aarav",
      question: "How does a doubly linked list work?",
    });

    expect(sawJsonObjectMode).toBe(true);
    expect(res.tutorResponse.topic).toBe("Doubly Linked List");
    expect(res.quiz?.questions).toHaveLength(3);
  });
});

describe("Authentication & Express API", () => {
  it("parses cookie headers accurately", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("foo=bar; gs_session=abc123%3Dxyz; theme=warm")).toEqual({
      foo: "bar",
      gs_session: "abc123=xyz",
      theme: "warm",
    });
  });

  it("verifies seeded scrypt PINs and returns only id and name for login options", () => {
    const db = new GyanSetuDb(":memory:");
    expect(db.verifyStudentPin("stu-aarav", "1111")).toBe(true);
    expect(db.verifyStudentPin("stu-aarav", "9999")).toBe(false);
    expect(db.verifyStudentPin("stu-ananya", "2222")).toBe(true);
    expect(db.verifyStudentPin("stu-rohan", "3333")).toBe(true);

    const options = db.listLoginOptions();
    expect(options).toEqual([
      { id: "stu-aarav", name: "Aarav Sharma" },
      { id: "stu-ananya", name: "Ananya Rao" },
      { id: "stu-rohan", name: "Rohan Verma" },
    ]);
  });

  it("handles student/teacher login, /api/me, /api/logout, role access, and 503 on missing GROQ_API_KEY", async () => {
    const db = new GyanSetuDb(":memory:");
    const { app } = createApp({ db, agentFactory: () => null });

    const server = app.listen(0);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Unauthenticated checks
      const meUnauth = await fetch(`${baseUrl}/api/me`);
      expect(meUnauth.status).toBe(401);

      const studentsUnauth = await fetch(`${baseUrl}/api/students`);
      expect(studentsUnauth.status).toBe(401);

      const loginOptsRes = await fetch(`${baseUrl}/api/login-options`);
      expect(loginOptsRes.status).toBe(200);
      const loginOpts = (await loginOptsRes.json()) as { students: Array<Record<string, unknown>> };
      expect(loginOpts.students).toHaveLength(3);
      expect(Object.keys(loginOpts.students[0]).sort()).toEqual(["id", "name"]);

      // Wrong student PIN -> 401
      const badPinRes = await fetch(`${baseUrl}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "student", studentId: "stu-aarav", pin: "0000" }),
      });
      expect(badPinRes.status).toBe(401);

      // Wrong teacher passcode -> 401
      const badPassRes = await fetch(`${baseUrl}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "teacher", passcode: "wrongpass" }),
      });
      expect(badPassRes.status).toBe(401);

      // Valid student login -> sets gs_session cookie
      const stuLoginRes = await fetch(`${baseUrl}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "student", studentId: "stu-aarav", pin: "1111" }),
      });
      expect(stuLoginRes.status).toBe(200);
      const setCookie = stuLoginRes.headers.get("set-cookie") || "";
      expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      const stuCookie = setCookie.split(";")[0];

      const meStu = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: stuCookie } });
      expect(meStu.status).toBe(200);
      expect(await meStu.json()).toEqual({ role: "student", studentId: "stu-aarav" });

      // Student cannot view another student's profile or class weaknesses
      const otherProfileRes = await fetch(`${baseUrl}/api/students/stu-ananya/profile`, {
        headers: { Cookie: stuCookie },
      });
      expect(otherProfileRes.status).toBe(403);

      const weaknessStuRes = await fetch(`${baseUrl}/api/class-weaknesses`, {
        headers: { Cookie: stuCookie },
      });
      expect(weaknessStuRes.status).toBe(403);

      // Authenticated student doubt still returns 503 when GROQ_API_KEY is missing
      const doubtRes = await fetch(`${baseUrl}/api/doubt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: stuCookie },
        body: JSON.stringify({ studentId: "stu-aarav", question: "What is recursion?" }),
      });
      expect(doubtRes.status).toBe(503);
      const errData = (await doubtRes.json()) as { error: string };
      expect(errData.error).toContain("GROQ_API_KEY");

      // Logout clears session
      const logoutRes = await fetch(`${baseUrl}/api/logout`, {
        method: "POST",
        headers: { Cookie: stuCookie },
      });
      expect(logoutRes.status).toBe(200);

      const meAfterLogout = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: stuCookie } });
      expect(meAfterLogout.status).toBe(401);

      // Teacher login (default passcode "teacher123")
      const teacherLoginRes = await fetch(`${baseUrl}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "teacher", passcode: "teacher123" }),
      });
      expect(teacherLoginRes.status).toBe(200);
      const teacherCookie = (teacherLoginRes.headers.get("set-cookie") || "").split(";")[0];

      const meTeacher = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: teacherCookie } });
      expect(meTeacher.status).toBe(200);
      expect(await meTeacher.json()).toEqual({ role: "teacher", studentId: null });

      const allStudentsRes = await fetch(`${baseUrl}/api/students`, {
        headers: { Cookie: teacherCookie },
      });
      expect(allStudentsRes.status).toBe(200);
      const allStudentsData = (await allStudentsRes.json()) as { students: Array<{ id: string }> };
      expect(allStudentsData.students).toHaveLength(3);

      const weaknessTeacherRes = await fetch(`${baseUrl}/api/class-weaknesses`, {
        headers: { Cookie: teacherCookie },
      });
      expect(weaknessTeacherRes.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("uses session studentId for student mode /api/students/me/*, /api/doubt, and /api/quiz-result without client studentId", async () => {
    const db = new GyanSetuDb(":memory:");
    const mockGroq = createScriptedMockGroq([
      // Doubt mode turn 1: tools
      {
        toolCalls: [
          { id: "d1", name: "get_student_profile", args: { student_id: "stu-aarav" } },
          {
            id: "d2",
            name: "log_doubt",
            args: { student_id: "stu-aarav", topic: "Recursion & Call Stack", question: "Base case?" },
          },
          {
            id: "d3",
            name: "generate_quiz",
            args: {
              student_id: "stu-aarav",
              topic: "Recursion & Call Stack",
              difficulty: "easy",
              language: "Hindi",
            },
          },
        ],
      },
      // Doubt mode turn 2: JSON
      {
        text: JSON.stringify({
          topic: "Recursion & Call Stack",
          level: "simple",
          gap: "Call stack frames",
          reason: "Mastery is 0.28, below 0.40.",
          explanations: {
            simple: "Simple explanation with real-life example.",
            standard: "Standard explanation with real-life example.",
            advanced: "Advanced explanation with real-life example.",
          },
        }),
      },
      // Quiz result mode turn 1: tools
      {
        toolCalls: [
          { id: "q1", name: "get_student_profile", args: { student_id: "stu-aarav" } },
          {
            id: "q2",
            name: "update_progress",
            args: {
              student_id: "stu-aarav",
              topic: "Recursion & Call Stack",
              score: 3,
              total: 3,
            },
          },
        ],
      },
      // Quiz result mode turn 2: JSON
      {
        text: JSON.stringify({
          next: "advance",
          message: "Great job! Move on to tree traversal next.",
        }),
      },
    ]);

    const agent = new GyanSetuAgent(
      mockGroq,
      db,
      DEFAULT_GROQ_MODEL,
      DEFAULT_GROQ_VISION_MODEL,
      async ({ topic }) => makeStubQuestions(topic)
    );
    const { app } = createApp({ db, agentFactory: () => agent });

    const server = app.listen(0);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const loginRes = await fetch(`${baseUrl}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "student", studentId: "stu-aarav", pin: "1111" }),
      });
      expect(loginRes.status).toBe(200);
      const stuCookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];

      // GET /api/students/me/profile without client studentId
      const meProfileRes = await fetch(`${baseUrl}/api/students/me/profile`, {
        headers: { Cookie: stuCookie },
      });
      expect(meProfileRes.status).toBe(200);
      const meProfile = (await meProfileRes.json()) as { profile: { student: { id: string; name: string } } };
      expect(meProfile.profile.student.id).toBe("stu-aarav");

      // PATCH /api/students/me/language without client studentId
      const langRes = await fetch(`${baseUrl}/api/students/me/language`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: stuCookie },
        body: JSON.stringify({ language: "Hindi" }),
      });
      expect(langRes.status).toBe(200);
      expect(db.getStudent("stu-aarav")?.language).toBe("Hindi");

      // Student cannot update another student's language
      const otherLangRes = await fetch(`${baseUrl}/api/students/stu-ananya/language`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: stuCookie },
        body: JSON.stringify({ language: "English" }),
      });
      expect(otherLangRes.status).toBe(403);

      // POST /api/doubt without studentId in body
      const doubtRes = await fetch(`${baseUrl}/api/doubt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: stuCookie },
        body: JSON.stringify({ question: "Why do we need a base case?" }),
      });
      expect(doubtRes.status).toBe(200);
      const doubtData = (await doubtRes.json()) as { quiz: { id: string }; tutorResponse: { topic: string } };
      expect(doubtData.tutorResponse.topic).toBe("Recursion & Call Stack");
      expect(doubtData.quiz.id).toBeTruthy();

      // POST /api/quiz-result without studentId in body
      const quizRes = await fetch(`${baseUrl}/api/quiz-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: stuCookie },
        body: JSON.stringify({
          quizId: doubtData.quiz.id,
          answers: [0, 1, 2],
        }),
      });
      expect(quizRes.status).toBe(200);
      const quizData = (await quizRes.json()) as { graded: { score: number }; tutorResponse: { next: string } };
      expect(quizData.graded.score).toBe(3);
      expect(quizData.tutorResponse.next).toBe("advance");
    } finally {
      server.close();
    }
  });

  it("blocks teachers from /api/doubt and /api/quiz-result and returns missedConcepts on /api/class-weaknesses", async () => {
    const db = new GyanSetuDb(":memory:");
    db.updateProgress({
      studentId: "stu-aarav",
      topic: "Pointers in C",
      score: 1,
      total: 3,
      missedConcepts: ["Pointer arithmetic", "Null dereference"],
    });
    db.flagClassWeakness({
      classId: "CSE-SEM4-A",
      topic: "Pointers in C",
      prerequisiteGap: "Memory addresses",
      reason: "Scored 1/3 on diagnostic quiz.",
    });
    db.flagClassWeakness({
      classId: "ECE-SEM3-B",
      topic: "Kirchhoff's Laws",
      prerequisiteGap: "Loop sign convention",
      reason: "Scored 1/3 twice.",
    });
    db.flagClassWeakness({
      classId: "ECE-SEM3-B",
      topic: "Kirchhoff's Laws",
      prerequisiteGap: "Loop sign convention",
      reason: "Second flag.",
    });

    const { app } = createApp({ db, agentFactory: () => null });
    const server = app.listen(0);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const loginRes = await fetch(`${baseUrl}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "teacher", passcode: "teacher123" }),
      });
      expect(loginRes.status).toBe(200);
      const teacherCookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];

      // Teachers cannot ask doubts
      const doubtRes = await fetch(`${baseUrl}/api/doubt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: teacherCookie },
        body: JSON.stringify({ studentId: "stu-aarav", question: "Explain pointers" }),
      });
      expect(doubtRes.status).toBe(403);

      // Teachers cannot submit quizzes
      const quizRes = await fetch(`${baseUrl}/api/quiz-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: teacherCookie },
        body: JSON.stringify({ studentId: "stu-aarav", quizId: "qz-1", answers: [0, 1, 2] }),
      });
      expect(quizRes.status).toBe(403);

      // Class weaknesses sorted by flagCount desc and include missedConcepts
      const wkRes = await fetch(`${baseUrl}/api/class-weaknesses`, {
        headers: { Cookie: teacherCookie },
      });
      expect(wkRes.status).toBe(200);
      const wkData = (await wkRes.json()) as {
        weaknesses: Array<{ topic: string; flagCount: number; missedConcepts?: string[] }>;
      };
      expect(wkData.weaknesses).toHaveLength(2);
      expect(wkData.weaknesses[0].topic).toBe("Kirchhoff's Laws");
      expect(wkData.weaknesses[0].flagCount).toBe(2);
      expect(wkData.weaknesses[1].topic).toBe("Pointers in C");
      expect(wkData.weaknesses[1].missedConcepts).toEqual([
        "Pointer arithmetic",
        "Null dereference",
      ]);
    } finally {
      server.close();
    }
  });
});
