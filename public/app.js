const state = {
  session: null,
  students: [],
  activeStudentId: null,
  profile: null,
  activeQuiz: null,
  lastExplanationSnippet: "",
  imageBase64: null,
  imageMimeType: null,
  teacherWeaknesses: [],
  teacherClassFilter: "",
};

const els = {
  apiStatusBadge: document.getElementById("api-status-badge"),
  sessionRoleBadge: document.getElementById("session-role-badge"),
  logoutBtn: document.getElementById("logout-btn"),
  globalAlert: document.getElementById("global-alert"),

  loginScreen: document.getElementById("login-screen"),
  tabStudent: document.getElementById("tab-student"),
  tabTeacher: document.getElementById("tab-teacher"),
  panelStudent: document.getElementById("panel-student"),
  panelTeacher: document.getElementById("panel-teacher"),
  loginError: document.getElementById("login-error"),
  studentLoginForm: document.getElementById("student-login-form"),
  loginStudentSelect: document.getElementById("login-student-select"),
  loginPin: document.getElementById("login-pin"),
  studentLoginBtn: document.getElementById("student-login-btn"),
  teacherLoginForm: document.getElementById("teacher-login-form"),
  loginPasscode: document.getElementById("login-passcode"),
  teacherLoginBtn: document.getElementById("teacher-login-btn"),

  appShell: document.getElementById("app-shell"),
  studentSelectField: document.getElementById("student-select-field"),
  studentSelect: document.getElementById("student-select"),
  studentMeta: document.getElementById("student-meta"),
  masteryList: document.getElementById("mastery-list"),
  recentDoubtsList: document.getElementById("recent-doubts-list"),
  languageRadios: document.querySelectorAll('input[name="language"]'),

  doubtForm: document.getElementById("doubt-form"),
  doubtQuestion: document.getElementById("doubt-question"),
  doubtError: document.getElementById("doubt-error"),
  doubtImage: document.getElementById("doubt-image"),
  imagePreviewWrap: document.getElementById("image-preview-wrap"),
  imagePreview: document.getElementById("image-preview"),
  clearImageBtn: document.getElementById("clear-image-btn"),
  submitDoubtBtn: document.getElementById("submit-doubt-btn"),

  tutorOutputSection: document.getElementById("tutor-output-section"),
  tutorTopicLine: document.getElementById("tutor-topic-line"),
  tutorLevelBadge: document.getElementById("tutor-level-badge"),
  tutorGapText: document.getElementById("tutor-gap-text"),
  tutorReasonText: document.getElementById("tutor-reason-text"),
  tutorPrimaryExplanation: document.getElementById("tutor-primary-explanation"),
  expSimple: document.getElementById("exp-simple"),
  expStandard: document.getElementById("exp-standard"),
  expAdvanced: document.getElementById("exp-advanced"),
  doubtToolTrace: document.getElementById("doubt-tool-trace"),
  doubtRawJson: document.getElementById("doubt-raw-json"),

  quizSection: document.getElementById("quiz-section"),
  quizMetaLine: document.getElementById("quiz-meta-line"),
  quizDifficultyBadge: document.getElementById("quiz-difficulty-badge"),
  quizForm: document.getElementById("quiz-form"),
  quizQuestionsContainer: document.getElementById("quiz-questions-container"),
  quizError: document.getElementById("quiz-error"),
  submitQuizBtn: document.getElementById("submit-quiz-btn"),

  quizFeedbackSection: document.getElementById("quiz-feedback-section"),
  quizScoreBadge: document.getElementById("quiz-score-badge"),
  feedbackMessage: document.getElementById("feedback-message"),
  reteachBox: document.getElementById("reteach-box"),
  feedbackReteach: document.getElementById("feedback-reteach"),
  quizBreakdownList: document.getElementById("quiz-breakdown-list"),
  quizToolTrace: document.getElementById("quiz-tool-trace"),
  quizRawJson: document.getElementById("quiz-raw-json"),

  openNewStudentBtn: document.getElementById("open-new-student-btn"),
  newStudentDialog: document.getElementById("new-student-dialog"),
  newStudentForm: document.getElementById("new-student-form"),
  newStudentError: document.getElementById("new-student-error"),

  openWeaknessBtn: document.getElementById("open-weakness-btn"),
  weaknessDialog: document.getElementById("weakness-dialog"),
  weaknessList: document.getElementById("weakness-list"),

  teacherDashboard: document.getElementById("teacher-dashboard"),
  teacherClassFilter: document.getElementById("teacher-class-filter"),
  teacherRefreshBtn: document.getElementById("teacher-refresh-btn"),
  statTotalFlags: document.getElementById("stat-total-flags"),
  statTopicsFlagged: document.getElementById("stat-topics-flagged"),
  statClassesCount: document.getElementById("stat-classes-count"),
  teacherAlert: document.getElementById("teacher-alert"),
  teacherEmptyState: document.getElementById("teacher-empty-state"),
  teacherWeaknessList: document.getElementById("teacher-weakness-list"),
};

function showAlert(message, tone = "info") {
  if (!message) {
    els.globalAlert.hidden = true;
    els.globalAlert.textContent = "";
    return;
  }
  els.globalAlert.textContent = message;
  els.globalAlert.dataset.tone = tone;
  els.globalAlert.hidden = false;
}

function showLoginError(message) {
  if (!message) {
    els.loginError.hidden = true;
    els.loginError.textContent = "";
    return;
  }
  els.loginError.textContent = message;
  els.loginError.hidden = false;
}

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.session && url !== "/api/login" && url !== "/api/me") {
      await showLoginScreen("Your session expired. Please sign in again.");
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function checkHealth() {
  try {
    const health = await apiJson("/api/health");
    if (health.groqConfigured) {
      els.apiStatusBadge.textContent = `Groq Ready (${health.model})`;
      els.apiStatusBadge.dataset.state = "ready";
    } else {
      els.apiStatusBadge.textContent = "GROQ_API_KEY Missing";
      els.apiStatusBadge.dataset.state = "missing";
      showAlert(
        "GROQ_API_KEY is not set on the server. Add your key to .env and restart the server to run GyanSetu.",
        "error"
      );
    }
  } catch (err) {
    els.apiStatusBadge.textContent = "Server Offline";
    els.apiStatusBadge.dataset.state = "missing";
    showAlert(err.message, "error");
  }
}

async function loadLoginOptions() {
  try {
    const data = await apiJson("/api/login-options");
    els.loginStudentSelect.replaceChildren();
    if (!data.students || data.students.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No students available";
      els.loginStudentSelect.appendChild(opt);
      return;
    }
    for (const stu of data.students) {
      const opt = document.createElement("option");
      opt.value = stu.id;
      opt.textContent = stu.name;
      els.loginStudentSelect.appendChild(opt);
    }
  } catch (err) {
    showLoginError(err.message);
  }
}

function setLoginTab(role) {
  const isStudent = role === "student";
  els.tabStudent.setAttribute("aria-selected", String(isStudent));
  els.tabTeacher.setAttribute("aria-selected", String(!isStudent));
  els.panelStudent.hidden = !isStudent;
  els.panelTeacher.hidden = isStudent;
  showLoginError("");
}

function resetWorkspaceViews() {
  state.activeQuiz = null;
  state.lastExplanationSnippet = "";
  els.tutorOutputSection.hidden = true;
  els.quizSection.hidden = true;
  els.quizFeedbackSection.hidden = true;
  els.doubtForm.reset();
  els.clearImageBtn.click();
}

async function showLoginScreen(errorMessage = "") {
  state.session = null;
  state.students = [];
  state.activeStudentId = null;
  state.profile = null;
  state.teacherWeaknesses = [];
  state.teacherClassFilter = "";
  resetWorkspaceViews();

  els.appShell.hidden = true;
  els.teacherDashboard.hidden = true;
  els.logoutBtn.hidden = true;
  els.sessionRoleBadge.hidden = true;
  els.openWeaknessBtn.hidden = true;
  els.openNewStudentBtn.hidden = true;

  els.loginScreen.hidden = false;
  els.loginPin.value = "";
  els.loginPasscode.value = "";
  showLoginError(errorMessage);
  await loadLoginOptions();
}

function showTeacherAlert(message, tone = "info") {
  if (!message) {
    els.teacherAlert.hidden = true;
    els.teacherAlert.textContent = "";
    return;
  }
  els.teacherAlert.textContent = message;
  els.teacherAlert.dataset.tone = tone;
  els.teacherAlert.hidden = false;
}

function getFlagSeverity(flagCount) {
  if (flagCount >= 3) return "red";
  if (flagCount === 2) return "amber";
  return "normal";
}

function renderTeacherDashboard() {
  const all = [...state.teacherWeaknesses].sort((a, b) => b.flagCount - a.flagCount);

  // Rebuild class filter options while preserving current selection if available
  const classes = Array.from(new Set(all.map((w) => w.classId))).sort();
  const prevFilter = state.teacherClassFilter;
  els.teacherClassFilter.replaceChildren();
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "All classes";
  els.teacherClassFilter.appendChild(allOpt);
  for (const cls of classes) {
    const opt = document.createElement("option");
    opt.value = cls;
    opt.textContent = cls;
    els.teacherClassFilter.appendChild(opt);
  }
  state.teacherClassFilter = classes.includes(prevFilter) ? prevFilter : "";
  els.teacherClassFilter.value = state.teacherClassFilter;

  const visible = state.teacherClassFilter
    ? all.filter((w) => w.classId === state.teacherClassFilter)
    : all;

  const totalFlags = visible.reduce((sum, w) => sum + w.flagCount, 0);
  const topicsFlagged = new Set(visible.map((w) => w.topic.toLowerCase())).size;
  const classCount = new Set(visible.map((w) => w.classId)).size;

  els.statTotalFlags.textContent = String(totalFlags);
  els.statTopicsFlagged.textContent = String(topicsFlagged);
  els.statClassesCount.textContent = String(classCount);

  els.teacherWeaknessList.replaceChildren();
  if (visible.length === 0) {
    els.teacherEmptyState.hidden = false;
    return;
  }
  els.teacherEmptyState.hidden = true;

  for (const w of visible) {
    const severity = getFlagSeverity(w.flagCount);
    const li = document.createElement("li");
    li.className = "teacher-weakness-card";
    li.dataset.severity = severity;

    const head = document.createElement("div");
    head.className = "weakness-card-head";

    const titleGroup = document.createElement("div");
    titleGroup.className = "weakness-title-group";
    const topicHeading = document.createElement("h4");
    topicHeading.textContent = w.topic;
    const classChip = document.createElement("span");
    classChip.className = "class-chip";
    classChip.textContent = w.classId;
    titleGroup.append(topicHeading, classChip);

    const badge = document.createElement("span");
    badge.className = "flag-badge";
    badge.dataset.severity = severity;
    badge.textContent = `${w.flagCount} flag${w.flagCount === 1 ? "" : "s"}`;

    head.append(titleGroup, badge);

    const grid = document.createElement("div");
    grid.className = "weakness-details-grid";

    const gapP = document.createElement("p");
    const gapLabel = document.createElement("strong");
    gapLabel.textContent = "Prerequisite gap: ";
    gapP.append(gapLabel, w.prerequisiteGap || "None specified");

    const missedP = document.createElement("p");
    const missedLabel = document.createElement("strong");
    missedLabel.textContent = "Missed concepts: ";
    const missedText =
      Array.isArray(w.missedConcepts) && w.missedConcepts.length > 0
        ? w.missedConcepts.join(", ")
        : w.reason || "None recorded";
    missedP.append(missedLabel, missedText);

    grid.append(gapP, missedP);
    li.append(head, grid);
    els.teacherWeaknessList.appendChild(li);
  }
}

async function loadTeacherDashboard() {
  showTeacherAlert("");
  els.teacherRefreshBtn.disabled = true;
  els.teacherRefreshBtn.textContent = "Refreshing…";
  try {
    const data = await apiJson("/api/class-weaknesses");
    state.teacherWeaknesses = data.weaknesses || [];
    renderTeacherDashboard();
  } catch (err) {
    showTeacherAlert(err.message, "error");
  } finally {
    els.teacherRefreshBtn.disabled = false;
    els.teacherRefreshBtn.textContent = "Refresh";
  }
}

async function enterApp(session) {
  state.session = session;
  const isTeacher = session.role === "teacher";

  els.loginScreen.hidden = true;
  els.logoutBtn.hidden = false;
  els.sessionRoleBadge.hidden = false;

  if (isTeacher) {
    els.appShell.hidden = true;
    els.openWeaknessBtn.hidden = true;
    els.openNewStudentBtn.hidden = true;
    els.teacherDashboard.hidden = false;
    els.sessionRoleBadge.textContent = "Teacher";

    await loadTeacherDashboard();
  } else {
    els.teacherDashboard.hidden = true;
    els.appShell.hidden = false;
    els.studentSelectField.remove();
    els.openNewStudentBtn.remove();
    els.openWeaknessBtn.hidden = true;
    els.sessionRoleBadge.textContent = "Student View";

    state.activeStudentId = session.studentId;
    await loadProfile("me");
    if (state.profile?.student?.name) {
      els.sessionRoleBadge.textContent = `Student: ${state.profile.student.name}`;
    }
  }
}

async function loadStudents(selectId) {
  const data = await apiJson("/api/students");
  state.students = data.students;
  els.studentSelect.replaceChildren();

  for (const stu of state.students) {
    const opt = document.createElement("option");
    opt.value = stu.id;
    opt.textContent = `${stu.name} (${stu.branch}, Sem ${stu.semester} · ${stu.language})`;
    els.studentSelect.appendChild(opt);
  }

  const targetId = selectId || state.activeStudentId || state.students[0]?.id;
  if (targetId) {
    state.activeStudentId = targetId;
    els.studentSelect.value = targetId;
    await loadProfile(targetId);
  }
}

async function loadProfile(studentId) {
  const target = state.session?.role === "student" ? "me" : encodeURIComponent(studentId);
  const data = await apiJson(`/api/students/${target}/profile`);
  state.profile = data.profile;
  renderProfile(data.profile);
}

function renderProfile(profile) {
  const { student, averageMastery, topicMastery, recentDoubts } = profile;

  for (const radio of els.languageRadios) {
    radio.checked = radio.value === student.language;
  }

  els.studentMeta.replaceChildren();
  const pairs = [
    ["Name", student.name],
    ["College", student.college],
    ["Branch", `${student.branch} (Sem ${student.semester})`],
    ["Class ID", student.classId],
    ["Avg Mastery", `${Math.round(averageMastery * 100)}% (${averageMastery.toFixed(2)})`],
  ];
  for (const [k, v] of pairs) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    els.studentMeta.append(dt, dd);
  }

  els.masteryList.replaceChildren();
  if (topicMastery.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "No topic attempts recorded yet. Ask a doubt to begin!";
    els.masteryList.appendChild(li);
  } else {
    for (const tm of topicMastery) {
      const li = document.createElement("li");
      li.className = "mastery-item";

      const top = document.createElement("div");
      top.className = "mastery-top";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = tm.topic;
      const scoreSpan = document.createElement("span");
      scoreSpan.textContent = `${tm.mastery.toFixed(2)} (${tm.attempts} tries)`;
      top.append(nameSpan, scoreSpan);

      const prog = document.createElement("progress");
      prog.max = 100;
      prog.value = Math.round(tm.mastery * 100);
      prog.setAttribute("aria-label", `${tm.topic} mastery`);

      li.append(top, prog);

      if (tm.failedAnalogies.length > 0) {
        const failed = document.createElement("div");
        failed.className = "failed-note";
        failed.textContent = `Avoid repeating: ${tm.failedAnalogies.join("; ")}`;
        li.appendChild(failed);
      }
      els.masteryList.appendChild(li);
    }
  }

  els.recentDoubtsList.replaceChildren();
  if (recentDoubts.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "No doubts logged yet.";
    els.recentDoubtsList.appendChild(li);
  } else {
    for (const d of recentDoubts.slice(0, 5)) {
      const li = document.createElement("li");
      li.className = "doubt-item";
      const strong = document.createElement("strong");
      strong.textContent = d.topic;
      const p = document.createElement("span");
      p.textContent = d.question.slice(0, 90) + (d.question.length > 90 ? "…" : "");
      li.append(strong, p);
      els.recentDoubtsList.appendChild(li);
    }
  }
}

function renderToolTrace(listEl, toolTrace) {
  listEl.replaceChildren();
  for (const item of toolTrace) {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = item.name;
    const detail = document.createElement("span");
    detail.textContent = `(${JSON.stringify(item.args)})`;
    li.append(title, " ", detail);
    listEl.appendChild(li);
  }
}

function renderDoubtResult(data) {
  const { tutorResponse, quiz, toolTrace, profile } = data;
  if (profile) {
    state.profile = profile;
    renderProfile(profile);
  }

  els.tutorTopicLine.textContent = `Topic: ${tutorResponse.topic}`;
  els.tutorLevelBadge.textContent = tutorResponse.level;
  els.tutorLevelBadge.dataset.level = tutorResponse.level;

  els.tutorGapText.textContent = tutorResponse.gap || "No prerequisite gap detected";
  els.tutorReasonText.textContent = tutorResponse.reason;

  const chosenText = tutorResponse.explanations[tutorResponse.level] || "";
  els.tutorPrimaryExplanation.textContent = chosenText;
  state.lastExplanationSnippet = chosenText.slice(0, 180);

  els.expSimple.textContent = tutorResponse.explanations.simple;
  els.expStandard.textContent = tutorResponse.explanations.standard;
  els.expAdvanced.textContent = tutorResponse.explanations.advanced;

  renderToolTrace(els.doubtToolTrace, toolTrace);
  els.doubtRawJson.textContent = JSON.stringify(tutorResponse, null, 2);

  els.tutorOutputSection.hidden = false;
  els.quizFeedbackSection.hidden = true;

  if (quiz) {
    renderQuiz(quiz);
  } else {
    els.quizSection.hidden = true;
  }
}

function renderQuiz(quiz) {
  state.activeQuiz = quiz;
  els.quizMetaLine.textContent = `Topic: ${quiz.topic} · Language: ${quiz.language}`;
  els.quizDifficultyBadge.textContent = quiz.difficulty;
  els.quizDifficultyBadge.dataset.level = quiz.difficulty;
  els.quizError.hidden = true;
  els.quizError.textContent = "";

  els.quizQuestionsContainer.replaceChildren();
  quiz.questions.forEach((q, qIndex) => {
    const fs = document.createElement("fieldset");
    fs.className = "quiz-question-fieldset";

    const legend = document.createElement("legend");
    legend.textContent = `Q${qIndex + 1}. ${q.question}`;
    fs.appendChild(legend);

    const group = document.createElement("div");
    group.className = "radio-group";

    q.options.forEach((optText, optIndex) => {
      const row = document.createElement("div");
      row.className = "radio-row";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `q-${qIndex}`;
      radio.id = `q-${qIndex}-opt-${optIndex}`;
      radio.value = String(optIndex);
      radio.required = true;

      const label = document.createElement("label");
      label.htmlFor = radio.id;
      label.textContent = optText;

      row.append(radio, label);
      group.appendChild(row);
    });

    fs.appendChild(group);
    els.quizQuestionsContainer.appendChild(fs);
  });

  els.quizSection.hidden = false;
  els.quizSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderQuizFeedback(data) {
  const { graded, tutorResponse, retryQuiz, toolTrace, profile } = data;
  if (profile) {
    state.profile = profile;
    renderProfile(profile);
  }

  els.quizScoreBadge.textContent = `${graded.score}/${graded.total} · ${tutorResponse.next}`;
  els.quizScoreBadge.dataset.level = tutorResponse.next;
  els.feedbackMessage.textContent = tutorResponse.message;

  if (tutorResponse.next === "retry") {
    els.feedbackReteach.textContent = tutorResponse.reteach;
    els.reteachBox.hidden = false;
    state.lastExplanationSnippet = tutorResponse.reteach.slice(0, 180);
  } else {
    els.reteachBox.hidden = true;
    els.feedbackReteach.textContent = "";
  }

  els.quizBreakdownList.replaceChildren();
  graded.breakdown.forEach((item, idx) => {
    const li = document.createElement("li");
    li.className = "breakdown-item";
    li.dataset.correct = String(item.isCorrect);

    const heading = document.createElement("strong");
    heading.textContent = `${item.isCorrect ? "✓ Correct" : "✗ Missed"} · Q${idx + 1} (${item.concept})`;
    const exp = document.createElement("p");
    exp.textContent = item.explanation;
    li.append(heading, exp);
    els.quizBreakdownList.appendChild(li);
  });

  renderToolTrace(els.quizToolTrace, toolTrace);
  els.quizRawJson.textContent = JSON.stringify(tutorResponse, null, 2);
  els.quizFeedbackSection.hidden = false;

  if (retryQuiz) {
    renderQuiz(retryQuiz);
  } else if (tutorResponse.next === "advance") {
    els.quizSection.hidden = true;
  }

  els.quizFeedbackSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function validateDoubtInput() {
  const hasText = els.doubtQuestion.value.trim().length > 0;
  const hasImg = Boolean(state.imageBase64);
  if (!hasText && !hasImg) {
    els.doubtQuestion.setAttribute("aria-invalid", "true");
    els.doubtError.textContent = "Please enter your doubt or attach an image of the problem.";
    els.doubtError.hidden = false;
    return false;
  }
  els.doubtQuestion.removeAttribute("aria-invalid");
  els.doubtError.textContent = "";
  els.doubtError.hidden = true;
  return true;
}

// Clear errors on input (non-intrusive timing)
els.doubtQuestion.addEventListener("input", () => {
  if (els.doubtQuestion.value.trim().length > 0 || state.imageBase64) {
    els.doubtQuestion.removeAttribute("aria-invalid");
    els.doubtError.hidden = true;
  }
});

// Validate on blur only if the user interacted with it
els.doubtQuestion.addEventListener("blur", () => {
  if (els.doubtQuestion.dataset.touched === "true") {
    validateDoubtInput();
  }
});
els.doubtQuestion.addEventListener("change", () => {
  els.doubtQuestion.dataset.touched = "true";
});

// IME-safe Ctrl/Cmd+Enter submit
els.doubtQuestion.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    els.doubtForm.requestSubmit();
  }
});

els.doubtImage.addEventListener("change", () => {
  const file = els.doubtImage.files?.[0];
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    showAlert("Image exceeds 4 MB limit. Please choose a smaller image.", "error");
    els.doubtImage.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || "");
    const commaIdx = result.indexOf(",");
    if (commaIdx !== -1) {
      state.imageBase64 = result.slice(commaIdx + 1);
      state.imageMimeType = file.type;
      els.imagePreview.src = result;
      els.imagePreviewWrap.hidden = false;
      validateDoubtInput();
    }
  };
  reader.readAsDataURL(file);
});

els.clearImageBtn.addEventListener("click", () => {
  state.imageBase64 = null;
  state.imageMimeType = null;
  els.doubtImage.value = "";
  els.imagePreview.removeAttribute("src");
  els.imagePreviewWrap.hidden = true;
});

els.doubtForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showAlert("");
  if (!validateDoubtInput()) {
    els.doubtQuestion.focus();
    return;
  }
  const isTeacher = state.session?.role === "teacher";
  if (isTeacher && !state.activeStudentId) return;

  els.submitDoubtBtn.disabled = true;
  els.submitDoubtBtn.textContent = "Thinking & Checking Profile…";

  try {
    const data = await apiJson("/api/doubt", {
      method: "POST",
      body: JSON.stringify({
        ...(isTeacher ? { studentId: state.activeStudentId } : {}),
        question: els.doubtQuestion.value.trim(),
        ...(state.imageBase64
          ? { imageBase64: state.imageBase64, imageMimeType: state.imageMimeType }
          : {}),
      }),
    });
    renderDoubtResult(data);
  } catch (err) {
    showAlert(err.message, "error");
  } finally {
    els.submitDoubtBtn.disabled = false;
    els.submitDoubtBtn.textContent = "Ask GyanSetu";
  }
});

els.quizForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.activeQuiz) return;
  const isTeacher = state.session?.role === "teacher";
  if (isTeacher && !state.activeStudentId) return;

  const answers = [];
  for (let i = 0; i < state.activeQuiz.questions.length; i++) {
    const selected = els.quizForm.querySelector(`input[name="q-${i}"]:checked`);
    if (!selected) {
      els.quizError.textContent = `Please select an answer for Question ${i + 1}.`;
      els.quizError.hidden = false;
      const firstOption = els.quizForm.querySelector(`input[name="q-${i}"]`);
      firstOption?.focus();
      return;
    }
    answers.push(Number(selected.value));
  }

  els.quizError.hidden = true;
  els.submitQuizBtn.disabled = true;
  els.submitQuizBtn.textContent = "Evaluating Quiz…";

  try {
    const data = await apiJson("/api/quiz-result", {
      method: "POST",
      body: JSON.stringify({
        ...(isTeacher ? { studentId: state.activeStudentId } : {}),
        quizId: state.activeQuiz.id,
        answers,
        failedAnalogy: state.lastExplanationSnippet,
      }),
    });
    renderQuizFeedback(data);
  } catch (err) {
    showAlert(err.message, "error");
  } finally {
    els.submitQuizBtn.disabled = false;
    els.submitQuizBtn.textContent = "Submit Quiz Answers";
  }
});

els.studentSelect.addEventListener("change", async () => {
  state.activeStudentId = els.studentSelect.value;
  await loadProfile(state.activeStudentId);
});

for (const radio of els.languageRadios) {
  radio.addEventListener("change", async () => {
    if (!radio.checked) return;
    const isTeacher = state.session?.role === "teacher";
    if (isTeacher && !state.activeStudentId) return;
    const target = isTeacher ? encodeURIComponent(state.activeStudentId) : "me";

    try {
      const data = await apiJson(
        `/api/students/${target}/language`,
        {
          method: "PATCH",
          body: JSON.stringify({ language: radio.value }),
        }
      );
      renderProfile(data.profile);
      if (isTeacher) {
        await loadStudents(state.activeStudentId);
      }
      showAlert(`Language updated to ${radio.value}.`, "success");
    } catch (err) {
      showAlert(err.message, "error");
    }
  });
}

els.openNewStudentBtn.addEventListener("click", () => {
  els.newStudentError.hidden = true;
  els.newStudentDialog.showModal();
});

els.newStudentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!els.newStudentForm.checkValidity()) {
    const firstInvalid = els.newStudentForm.querySelector(":invalid");
    els.newStudentError.textContent = "Please complete all required student fields validly.";
    els.newStudentError.hidden = false;
    firstInvalid?.focus();
    return;
  }

  const fd = new FormData(els.newStudentForm);
  try {
    const data = await apiJson("/api/students", {
      method: "POST",
      body: JSON.stringify({
        name: fd.get("name"),
        college: fd.get("college"),
        branch: fd.get("branch"),
        semester: Number(fd.get("semester")),
        language: fd.get("language"),
        pin: fd.get("pin"),
      }),
    });
    els.newStudentForm.reset();
    els.newStudentDialog.close();
    await loadStudents(data.student.id);
    showAlert(`Created profile for ${data.student.name}.`, "success");
  } catch (err) {
    els.newStudentError.textContent = err.message;
    els.newStudentError.hidden = false;
  }
});

els.openWeaknessBtn.addEventListener("click", async () => {
  try {
    const data = await apiJson("/api/class-weaknesses");
    els.weaknessList.replaceChildren();
    if (data.weaknesses.length === 0) {
      const li = document.createElement("li");
      li.className = "hint";
      li.textContent = "No class weaknesses flagged yet.";
      els.weaknessList.appendChild(li);
    } else {
      for (const w of data.weaknesses) {
        const li = document.createElement("li");
        li.className = "weakness-item";
        const title = document.createElement("strong");
        title.textContent = `${w.topic} · ${w.classId} (${w.flagCount} flag${w.flagCount > 1 ? "s" : ""})`;
        const gap = document.createElement("div");
        gap.className = "hint";
        gap.textContent = `Gap: ${w.prerequisiteGap || "Unspecified"}`;
        const reason = document.createElement("p");
        reason.textContent = w.reason;
        li.append(title, gap, reason);
        els.weaknessList.appendChild(li);
      }
    }
    els.weaknessDialog.showModal();
  } catch (err) {
    showAlert(err.message, "error");
  }
});

els.teacherClassFilter.addEventListener("change", () => {
  state.teacherClassFilter = els.teacherClassFilter.value;
  renderTeacherDashboard();
});

els.teacherRefreshBtn.addEventListener("click", async () => {
  await loadTeacherDashboard();
});

els.tabStudent.addEventListener("click", () => setLoginTab("student"));
els.tabTeacher.addEventListener("click", () => setLoginTab("teacher"));

els.loginPin.addEventListener("input", () => showLoginError(""));
els.loginPasscode.addEventListener("input", () => showLoginError(""));

els.studentLoginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showLoginError("");

  const studentId = els.loginStudentSelect.value;
  const pin = els.loginPin.value.trim();
  if (!studentId) {
    showLoginError("Please select your name.");
    els.loginStudentSelect.focus();
    return;
  }
  if (!pin) {
    showLoginError("Please enter your PIN.");
    els.loginPin.focus();
    return;
  }

  els.studentLoginBtn.disabled = true;
  els.studentLoginBtn.textContent = "Signing in…";
  try {
    const session = await apiJson("/api/login", {
      method: "POST",
      body: JSON.stringify({ role: "student", studentId, pin }),
    });
    await enterApp(session);
  } catch (err) {
    showLoginError(err.message);
    els.loginPin.focus();
  } finally {
    els.studentLoginBtn.disabled = false;
    els.studentLoginBtn.textContent = "Sign in as Student";
  }
});

els.teacherLoginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showLoginError("");

  const passcode = els.loginPasscode.value;
  if (!passcode.trim()) {
    showLoginError("Please enter the teacher passcode.");
    els.loginPasscode.focus();
    return;
  }

  els.teacherLoginBtn.disabled = true;
  els.teacherLoginBtn.textContent = "Signing in…";
  try {
    const session = await apiJson("/api/login", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", passcode }),
    });
    await enterApp(session);
  } catch (err) {
    showLoginError(err.message);
    els.loginPasscode.focus();
  } finally {
    els.teacherLoginBtn.disabled = false;
    els.teacherLoginBtn.textContent = "Sign in as Teacher";
  }
});

els.logoutBtn.addEventListener("click", async () => {
  try {
    await apiJson("/api/logout", { method: "POST" });
  } catch {
    // Still return to login screen locally
  }
  await showLoginScreen();
});

// Initialize workspace: check health and current session
(async function init() {
  await checkHealth();
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (res.ok) {
      const session = await res.json();
      await enterApp(session);
    } else {
      await showLoginScreen();
    }
  } catch {
    await showLoginScreen();
  }
})();
