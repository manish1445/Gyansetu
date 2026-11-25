# GyanSetu — Autonomous AI Tutor for College Students in India

GyanSetu is a Node.js, TypeScript, Express, and SQLite web application powered by the **Groq API** (`groq-sdk`) that tutors college students in **English**, **Kannada**, or **Hindi** using mastery-calibrated explanations, prerequisite-gap detection, multimodal doubt support (text + problem images), and 3-question diagnostic quizzes.

## Features

- **Autonomous Groq Tool Loop** (`src/server/agent.ts`):
  - Uses `llama-3.3-70b-versatile` for text/tool-calling (`GROQ_MODEL`) and automatically switches to `meta-llama/llama-4-scout-17b-16e-instruct` (`GROQ_VISION_MODEL`) when a problem image is attached.
  - Enforces profile-first checks (`get_student_profile` before any other tool or answer).
  - Enforces a maximum of **6 tool calls per request**.
  - **Doubt Mode**: `get_student_profile` -> `log_doubt` -> `generate_quiz` -> strict JSON response with `simple`, `standard`, and `advanced` explanations.
  - **Quiz Result Mode**: `get_student_profile` -> `update_progress` -> if score `< 2/3`, `flag_class_weakness` + `generate_quiz` (`easy`) + `<100` word reteach with a new analogy; otherwise `advance`.
- **SQLite Persistence** (`src/server/db.ts` via Node 24's `node:sqlite`):
  - Pre-seeded with 3 college student profiles (`English`, `Kannada`, `Hindi`) and topic mastery history.
  - Tracks failed analogies per topic so GyanSetu never repeats an analogy that already failed.
  - Aggregates `flag_class_weakness` entries for instructor review.
- **Accessible Web UI** (`public/`):
  - Student switcher, language selector, mastery progress bars, image upload for textbook/handwritten doubts, interactive 3-question quiz, tool execution trace, and native `<dialog>` modals for creating students and viewing class weaknesses.

## Setup & Running

1. Copy `.env.example` to `.env` and add your Groq API key:
   ```bash
   cp .env.example .env
   ```
   Set `GROQ_API_KEY=...` in `.env`.

2. Install dependencies (if not already installed):
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```
   Or build and run in production mode:
   ```bash
   npm run build
   npm start
   ```

4. Open `http://localhost:3000` in your browser.

## Verification

```bash
npm run typecheck
npm run build
npm test
```
