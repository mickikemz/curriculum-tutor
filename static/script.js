"use strict";

/* =====================================================================
   CURRA — STUDENT LEARNING FRONTEND
   =====================================================================

   Features:
   - Student identification
   - Course/module progress
   - Lesson loading
   - AI chat
   - Speech-to-text
   - Text-to-speech
   - Quiz generation
   - Quiz grading
   - Optional YouTube recommendations

   Backend endpoints:
   GET  /api/progress
   POST /api/teach
   POST /api/ask
   POST /api/quiz/generate
   POST /api/quiz/grade
   GET  /api/youtube

   IMPORTANT:
   YouTube recommendations are OPTIONAL.
   They are NEVER loaded automatically.

   The lesson is always displayed first.
   The recommendation prompt is displayed separately.
   Videos are fetched ONLY after the student clicks YES.

   LAYOUT NOTE:
   The lesson/chat column and the YouTube video panel now live in
   two separate side-by-side panes (see setupSplitLayout below).
   The video panel scrolls independently and can never overlap or
   block scrolling of the lesson column.
   ===================================================================== */


/* =====================================================================
   STUDENT ID
   ===================================================================== */

function getStudentId() {
  try {
    const existing = localStorage.getItem("student_id");

    if (existing) {
      return existing;
    }

    const generated =
      "student_" +
      Math.random()
        .toString(36)
        .slice(2, 10);

    localStorage.setItem(
      "student_id",
      generated
    );

    return generated;
  } catch (error) {
    console.warn(
      "Could not access localStorage:",
      error
    );

    return (
      "student_" +
      Math.random()
        .toString(36)
        .slice(2, 10)
    );
  }
}


const STUDENT_ID =
  getStudentId();


/* =====================================================================
   STORAGE
   ===================================================================== */

const STORAGE_KEYS = {
  voiceEnabled:
    "curra_voice_enabled",

  theme:
    "curra_theme"
};


/* =====================================================================
   SPEECH APIs
   ===================================================================== */

const SpeechRecognitionAPI =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition ||
  null;

const synth =
  "speechSynthesis" in window
    ? window.speechSynthesis
    : null;


/* =====================================================================
   GLOBAL STATE
   ===================================================================== */

let recognition = null;
let isRecording = false;

let voiceOutputEnabled = true;

let currentUtterance = null;

let currentModuleId = null;
let currentQuiz = null;

let lessonLoaded = false;

let aiRequestInProgress = false;

let speechTranscript = "";
let speechShouldSubmit = false;

let youtubeRecommendationAnswered = false;


/*
 * Request tokens prevent older requests from changing
 * the UI after the student switches modules.
 */
let moduleRequestToken = 0;
let youtubeRequestToken = 0;
let chatRequestToken = 0;
let quizRequestToken = 0;


/* =====================================================================
   DOM REFERENCES
   ===================================================================== */

let chatForm = null;
let chatInput = null;
let chatWindow = null;

let micBtn = null;
let micStatus = null;

let voiceToggle = null;
let voiceToggleLabel = null;
let voiceSupportBanner = null;
let stopSpeakBtn = null;

let currentModuleTitle = null;
let quizBtn = null;

let progressPct = null;
let progressFill = null;
let progressSub = null;
let trackListEl = null;

let quizModal = null;
let quizBody = null;
let quizTitle = null;
let quizSubmitBtn = null;
let quizCloseBtn = null;

let youtubeSection = null;
let youtubeList = null;
let youtubeRecommendationSection = null;

/*
 * The right-hand video panel. Created by setupSplitLayout().
 */
let videoPane = null;

/*
 * The dark/light mode toggle switch. Created by setupThemeToggle().
 */
let themeToggle = null;


/* =====================================================================
   STORAGE — VOICE
   ===================================================================== */

function loadVoicePreference() {
  try {
    const saved =
      localStorage.getItem(
        STORAGE_KEYS.voiceEnabled
      );

    if (saved === null) {
      return true;
    }

    return saved === "true";
  } catch (error) {
    console.warn(
      "Could not load voice preference:",
      error
    );

    return true;
  }
}


function saveVoicePreference(enabled) {
  try {
    localStorage.setItem(
      STORAGE_KEYS.voiceEnabled,
      String(Boolean(enabled))
    );
  } catch (error) {
    console.warn(
      "Could not save voice preference:",
      error
    );
  }
}


/* =====================================================================
   STORAGE — THEME
   ===================================================================== */

function loadThemePreference() {
  try {
    const saved =
      localStorage.getItem(
        STORAGE_KEYS.theme
      );

    if (
      saved === "light" ||
      saved === "dark"
    ) {
      return saved;
    }

    return "light";
  } catch (error) {
    console.warn(
      "Could not load theme preference:",
      error
    );

    return "light";
  }
}


function saveThemePreference(theme) {
  try {
    localStorage.setItem(
      STORAGE_KEYS.theme,
      theme
    );
  } catch (error) {
    console.warn(
      "Could not save theme preference:",
      error
    );
  }
}


/*
   Applying the theme is a single attribute change — every color in
   style.css is driven off CSS custom properties, and the light
   theme overrides live under html[data-theme="light"], so this one
   line repaints the entire app.
*/
function applyTheme(theme) {
  document.documentElement.setAttribute(
    "data-theme",
    theme
  );
}


function setupThemeToggle() {
  const topbarActions =
    document.querySelector(
      ".topbar-actions"
    );

  if (!topbarActions) {
    return;
  }

  themeToggle =
    document.createElement(
      "button"
    );

  themeToggle.type =
    "button";

  themeToggle.id =
    "theme-toggle";

  themeToggle.className =
    "theme-toggle";

  themeToggle.setAttribute(
    "aria-label",
    "Switch between dark and light mode"
  );

  themeToggle.innerHTML =
    `<span class="theme-toggle-icon theme-icon-moon">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    </span>
    <span class="theme-toggle-icon theme-icon-sun">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="12" cy="12" r="4"/>
        <line x1="12" y1="1" x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    </span>
    <span class="theme-toggle-thumb"></span>`;

  themeToggle.addEventListener(
    "click",
    () => {
      const current =
        document.documentElement.getAttribute(
          "data-theme"
        ) === "light"
          ? "light"
          : "dark";

      const next =
        current === "light"
          ? "dark"
          : "light";

      applyTheme(next);

      saveThemePreference(
        next
      );
    }
  );

  topbarActions.insertBefore(
    themeToggle,
    topbarActions.firstChild
  );
}


/* =====================================================================
   HELPERS
   ===================================================================== */

function escapeHtml(value) {
  const div =
    document.createElement("div");

  div.textContent =
    String(value ?? "");

  return div.innerHTML;
}


function safeHttpUrl(url) {
  const value =
    String(url || "").trim();

  if (!value) {
    return "";
  }

  try {
    const parsed =
      new URL(
        value,
        window.location.href
      );

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return "";
    }

    return parsed.href;
  } catch {
    return "";
  }
}


function normalizePercentage(value) {
  const numeric =
    Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      numeric <= 1
        ? numeric * 100
        : numeric
    )
  );
}


function isCurrentModule(
  moduleId,
  token = null
) {
  if (
    token !== null &&
    token !== moduleRequestToken
  ) {
    return false;
  }

  return (
    String(currentModuleId) ===
    String(moduleId)
  );
}


/* =====================================================================
   API HELPER
   ===================================================================== */

async function fetchJson(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      {
        ...options,
        headers: {
          Accept:
            "application/json",
          ...(options.body
            ? {
                "Content-Type":
                  "application/json"
              }
            : {}),
          ...(options.headers || {})
        }
      }
    );

  const text =
    await response.text();

  let data = {};

  if (text) {
    try {
      data =
        JSON.parse(text);
    } catch {
      data = {
        raw: text
      };
    }
  }

  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      data.error
        ? data.error
        : `Request failed with status ${response.status}`;

    const error =
      new Error(message);

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}


/* =====================================================================
   VOICE PREFERENCE
   ===================================================================== */

function updateVoiceToggleUI() {
  if (!voiceToggle) {
    return;
  }

  if (
    voiceToggle.tagName === "INPUT" &&
    voiceToggle.type === "checkbox"
  ) {
    voiceToggle.checked =
      voiceOutputEnabled;
  }

  if (voiceToggleLabel) {
    voiceToggleLabel.textContent =
      voiceOutputEnabled
        ? "Voice: On"
        : "Voice: Off";
  }

  voiceToggle.classList.toggle(
    "off",
    !voiceOutputEnabled
  );
}


function setupVoiceToggle() {
  if (!voiceToggle) {
    return;
  }

  voiceToggle.addEventListener(
    "click",
    () => {
      if (
        voiceToggle.tagName === "INPUT" &&
        voiceToggle.type === "checkbox"
      ) {
        voiceOutputEnabled =
          voiceToggle.checked;
      } else {
        voiceOutputEnabled =
          !voiceOutputEnabled;
      }

      saveVoicePreference(
        voiceOutputEnabled
      );

      updateVoiceToggleUI();

      if (!voiceOutputEnabled) {
        stopSpeaking();
      }
    }
  );
}


/* =====================================================================
   SPEECH VOICE
   ===================================================================== */

function getCurraVoice() {
  if (!synth) {
    return null;
  }

  const voices =
    synth.getVoices();

  if (!voices.length) {
    return null;
  }

  const preferred =
    voices.find(
      (voice) =>
        /en-US/i.test(
          voice.lang || ""
        ) &&
        /Samantha|Google US English|Microsoft.*Online|Natural/i.test(
          voice.name || ""
        )
    );

  if (preferred) {
    return preferred;
  }

  const usEnglish =
    voices.find(
      (voice) =>
        /^en-US/i.test(
          voice.lang || ""
        )
    );

  if (usEnglish) {
    return usEnglish;
  }

  const english =
    voices.find(
      (voice) =>
        /^en/i.test(
          voice.lang || ""
        )
    );

  return (
    english ||
    voices[0]
  );
}


function cleanTextForSpeech(text) {
  return String(text || "")
    .replace(
      /```[\s\S]*?```/g,
      " "
    )
    .replace(
      /`([^`]+)`/g,
      "$1"
    )
    .replace(
      /^#{1,6}\s*/gm,
      ""
    )
    .replace(
      /\*\*(.*?)\*\*/g,
      "$1"
    )
    .replace(
      /__(.*?)__/g,
      "$1"
    )
    .replace(
      /\*([^*\n]+)\*/g,
      "$1"
    )
    .replace(
      /_([^_\n]+)_/g,
      "$1"
    )
    .replace(
      /\[([^\]]+)\]\([^)]+\)/g,
      "$1"
    )
    .replace(
      /^\s*[-*+]\s+/gm,
      ""
    )
    .replace(
      /^\s*\d+\.\s+/gm,
      ""
    )
    .replace(
      /\|/g,
      " "
    )
    .replace(
      /\n{3,}/g,
      "\n\n"
    )
    .replace(
      /[ \t]{2,}/g,
      " "
    )
    .trim();
}


function speak(text) {
  if (
    !voiceOutputEnabled ||
    !synth ||
    !text
  ) {
    return;
  }

  const clean =
    cleanTextForSpeech(text);

  if (!clean) {
    return;
  }

  stopSpeaking();

  const utterance =
    new SpeechSynthesisUtterance(
      clean
    );

  const voice =
    getCurraVoice();

  if (voice) {
    utterance.voice =
      voice;
  }

  utterance.lang =
    "en-US";

  /*
   * Slightly slower than default for clearer teaching.
   */
  utterance.rate =
    0.88;

  utterance.pitch =
    1.0;

  /*
   * Browser speech volume maximum.
   */
  utterance.volume =
    1.0;

  currentUtterance =
    utterance;

  if (stopSpeakBtn) {
    stopSpeakBtn.classList.remove(
      "hidden"
    );
  }

  utterance.onend =
    () => {
      if (
        currentUtterance ===
        utterance
      ) {
        currentUtterance =
          null;
      }

      if (stopSpeakBtn) {
        stopSpeakBtn.classList.add(
          "hidden"
        );
      }
    };

  utterance.onerror =
    () => {
      if (
        currentUtterance ===
        utterance
      ) {
        currentUtterance =
          null;
      }

      if (stopSpeakBtn) {
        stopSpeakBtn.classList.add(
          "hidden"
        );
      }
    };

  try {
    synth.speak(
      utterance
    );
  } catch (error) {
    console.warn(
      "Speech synthesis failed:",
      error
    );

    currentUtterance =
      null;

    if (stopSpeakBtn) {
      stopSpeakBtn.classList.add(
        "hidden"
      );
    }
  }
}


function stopSpeaking() {
  if (synth) {
    try {
      synth.cancel();
    } catch (error) {
      console.warn(
        "Could not stop speech:",
        error
      );
    }
  }

  currentUtterance =
    null;

  if (stopSpeakBtn) {
    stopSpeakBtn.classList.add(
      "hidden"
    );
  }
}


/* =====================================================================
   SPEECH SUPPORT UI
   ===================================================================== */

function setupVoiceSupport() {
  if (!SpeechRecognitionAPI) {
    if (micBtn) {
      micBtn.disabled =
        true;

      micBtn.classList.add(
        "hidden"
      );
    }

    if (voiceSupportBanner) {
      voiceSupportBanner.classList.remove(
        "hidden"
      );
    }
  } else {
    if (micBtn) {
      micBtn.classList.remove(
        "hidden"
      );
    }

    if (voiceSupportBanner) {
      voiceSupportBanner.classList.add(
        "hidden"
      );
    }
  }

  if (!synth) {
    if (voiceToggle) {
      voiceToggle.disabled =
        true;
    }

    if (voiceToggleLabel) {
      voiceToggleLabel.textContent =
        "Voice unavailable";
    }
  } else {
    updateVoiceToggleUI();
  }
}


/* =====================================================================
   MIC STATUS
   ===================================================================== */

function showMicStatus(
  message,
  duration = 2500
) {
  if (!micStatus) {
    return;
  }

  micStatus.textContent =
    message;

  micStatus.classList.remove(
    "hidden"
  );

  if (duration > 0) {
    window.setTimeout(
      () => {
        if (
          micStatus &&
          !isRecording
        ) {
          micStatus.classList.add(
            "hidden"
          );
        }
      },
      duration
    );
  }
}


/* =====================================================================
   SPEECH RECOGNITION
   ===================================================================== */

function createRecognition() {
  if (!SpeechRecognitionAPI) {
    return null;
  }

  const rec =
    new SpeechRecognitionAPI();

  rec.lang =
    "en-US";

  rec.interimResults =
    false;

  rec.maxAlternatives =
    1;

  /*
   * One completed utterance = one submission.
   */
  rec.continuous =
    false;

  return rec;
}


function stopRecognition(
  shouldSubmit = false
) {
  speechShouldSubmit =
    shouldSubmit;

  if (recognition) {
    try {
      recognition.stop();
    } catch {
      /* Already stopped. */
    }
  }
}


function setupMicrophone() {
  if (!micBtn) {
    return;
  }

  micBtn.addEventListener(
    "click",
    () => {
      if (!SpeechRecognitionAPI) {
        return;
      }

      if (isRecording) {
        speechShouldSubmit =
          false;

        stopRecognition(
          false
        );

        return;
      }

      if (aiRequestInProgress) {
        return;
      }

      if (!lessonLoaded) {
        showMicStatus(
          "Please wait for Curra to finish loading your lesson.",
          2500
        );

        return;
      }

      recognition =
        createRecognition();

      if (!recognition) {
        return;
      }

      speechTranscript =
        "";

      speechShouldSubmit =
        true;

      isRecording =
        true;

      micBtn.classList.add(
        "recording"
      );

      showMicStatus(
        "🎙️ Listening… speak your complete question",
        0
      );

      stopSpeaking();

      recognition.onresult =
        (event) => {
          let finalText =
            "";

          for (
            let i = event.resultIndex;
            i < event.results.length;
            i++
          ) {
            const result =
              event.results[i];

            if (
              result.isFinal &&
              result[0]
            ) {
              finalText +=
                ` ${result[0].transcript}`;
            }
          }

          finalText =
            finalText.trim();

          if (!finalText) {
            return;
          }

          speechTranscript =
            finalText;

          if (chatInput) {
            chatInput.value =
              finalText;
          }

          if (micStatus) {
            micStatus.textContent =
              "✓ Got it — sending your question…";
          }
        };

      recognition.onerror =
        (event) => {
          console.error(
            "Speech recognition error:",
            event.error
          );

          speechShouldSubmit =
            false;

          isRecording =
            false;

          micBtn.classList.remove(
            "recording"
          );

          let message =
            "⚠️ Couldn't hear you. Please try again or type instead.";

          switch (
            event.error
          ) {
            case "not-allowed":
            case "service-not-allowed":
              message =
                "⚠️ Microphone permission was denied. Please allow microphone access and try again.";
              break;

            case "no-speech":
              message =
                "⚠️ No speech detected. Please try again.";
              break;

            case "audio-capture":
              message =
                "⚠️ No microphone was detected. Please check your microphone.";
              break;

            case "network":
              message =
                "⚠️ Speech recognition needs a network connection. Please try again.";
              break;

            case "aborted":
              message =
                "Microphone stopped.";
              break;

            default:
              break;
          }

          showMicStatus(
            message,
            3000
          );
        };

      recognition.onend =
        () => {
          isRecording =
            false;

          micBtn.classList.remove(
            "recording"
          );

          if (micStatus) {
            micStatus.classList.add(
              "hidden"
            );
          }

          if (!speechShouldSubmit) {
            return;
          }

          speechShouldSubmit =
            false;

          const message =
            speechTranscript.trim();

          if (!message) {
            return;
          }

          if (chatInput) {
            chatInput.value =
              message;
          }

          /*
           * Submit exactly once.
           */
          if (chatForm) {
            if (
              typeof chatForm.requestSubmit ===
              "function"
            ) {
              chatForm.requestSubmit();
            } else {
              chatForm.dispatchEvent(
                new Event(
                  "submit",
                  {
                    bubbles:
                      true,
                    cancelable:
                      true
                  }
                )
              );
            }
          }
        };

      try {
        recognition.start();
      } catch (error) {
        console.error(
          "Could not start speech recognition:",
          error
        );

        speechShouldSubmit =
          false;

        isRecording =
          false;

        micBtn.classList.remove(
          "recording"
        );

        showMicStatus(
          "⚠️ Microphone could not start. Please try again.",
          2500
        );
      }
    }
  );
}


/* =====================================================================
   STOP SPEAK BUTTON
   ===================================================================== */

function setupStopSpeaking() {
  if (!stopSpeakBtn) {
    return;
  }

  stopSpeakBtn.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();

      stopSpeaking();
    }
  );
}


/* =====================================================================
   ENABLE / DISABLE CHAT
   ===================================================================== */

function setChatEnabled(enabled) {
  const canUse =
    Boolean(enabled) &&
    !aiRequestInProgress;

  if (chatInput) {
    chatInput.disabled =
      !canUse;
  }

  if (chatForm) {
    const submitBtn =
      chatForm.querySelector(
        'button[type="submit"]'
      );

    if (submitBtn) {
      submitBtn.disabled =
        !canUse;
    }
  }

  if (micBtn) {
    micBtn.disabled =
      !canUse ||
      !SpeechRecognitionAPI;
  }
}


/* =====================================================================
   ENABLE / DISABLE QUIZ
   ===================================================================== */

function setQuizEnabled(enabled) {
  if (quizBtn) {
    quizBtn.disabled =
      !Boolean(enabled);
  }
}


/* =====================================================================
   CHAT MESSAGE
   ===================================================================== */

function addMessage(
  role,
  content
) {
  if (!chatWindow) {
    return null;
  }

  const div =
    document.createElement(
      "div"
    );

  div.className =
    `msg ${role}`;

  const textEl =
    document.createElement(
      "div"
    );

  textEl.className =
    "message-content";

  if (role === "assistant") {
    textEl.innerHTML =
      formatAssistantResponse(
        content
      );
  } else {
    textEl.textContent =
      String(content || "");
  }

  div.appendChild(
    textEl
  );

  if (
    role === "assistant" &&
    synth
  ) {
    const speakBtn =
      document.createElement(
        "button"
      );

    speakBtn.type =
      "button";

    speakBtn.className =
      "msg-speak-btn";

    speakBtn.textContent =
      "🔊 Read aloud";

    speakBtn.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        speak(content);
      }
    );

    div.appendChild(
      speakBtn
    );
  }

  chatWindow.appendChild(
    div
  );

  chatWindow.scrollTop =
    chatWindow.scrollHeight;

  return div;
}


function addLoading(
  text = "Curra is thinking…"
) {
  return addMessage(
    "system",
    text
  );
}


/* =====================================================================
   MARKDOWN FORMATTER
   ===================================================================== */

function formatAssistantResponse(
  content
) {
  if (!content) {
    return "";
  }

  let text =
    escapeHtml(content);

  const codeBlocks = [];

  /*
   * Extract fenced code blocks before processing markdown.
   */
  text =
    text.replace(
      /```([a-zA-Z0-9_+#.-]+)?[ \t]*\n?([\s\S]*?)```/g,
      (
        match,
        language,
        code
      ) => {
        const index =
          codeBlocks.length;

        codeBlocks.push({
          language:
            language || "",
          code:
            String(code)
              .replace(
                /^\n/,
                ""
              )
              .replace(
                /\n$/,
                ""
              )
        });

        return `___CURRA_CODE_BLOCK_${index}___`;
      }
    );

  /*
   * Headings.
   */
  text =
    text.replace(
      /^######\s+(.+)$/gm,
      "<h6>$1</h6>"
    );

  text =
    text.replace(
      /^#####\s+(.+)$/gm,
      "<h5>$1</h5>"
    );

  text =
    text.replace(
      /^####\s+(.+)$/gm,
      "<h4>$1</h4>"
    );

  text =
    text.replace(
      /^###\s+(.+)$/gm,
      "<h3>$1</h3>"
    );

  text =
    text.replace(
      /^##\s+(.+)$/gm,
      "<h2>$1</h2>"
    );

  text =
    text.replace(
      /^#\s+(.+)$/gm,
      "<h1>$1</h1>"
    );

  /*
   * Bold.
   */
  text =
    text.replace(
      /\*\*(.+?)\*\*/g,
      "<strong>$1</strong>"
    );

  text =
    text.replace(
      /__(.+?)__/g,
      "<strong>$1</strong>"
    );

  /*
   * Italic.
   */
  text =
    text.replace(
      /\*([^*\n]+)\*/g,
      "<em>$1</em>"
    );

  text =
    text.replace(
      /_([^_\n]+)_/g,
      "<em>$1</em>"
    );

  /*
   * Inline code.
   */
  text =
    text.replace(
      /`([^`\n]+)`/g,
      "<code>$1</code>"
    );

  /*
   * Links.
   */
  text =
    text.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (match, label, url) => {
        const safeUrl =
          safeHttpUrl(url);

        if (!safeUrl) {
          return label;
        }

        return (
          `<a href="${escapeHtml(
            safeUrl
          )}" target="_blank" rel="noopener noreferrer">${label}</a>`
        );
      }
    );

  /*
   * Process lines while preserving block elements.
   */
  const lines =
    text.split("\n");

  const output = [];

  let paragraph = [];

  function flushParagraph() {
    if (!paragraph.length) {
      return;
    }

    const paragraphContent =
      paragraph
        .join(" ")
        .trim();

    if (paragraphContent) {
      output.push(
        `<p>${paragraphContent}</p>`
      );
    }

    paragraph = [];
  }

  let index = 0;

  while (index < lines.length) {
    const line =
      lines[index];

    const trimmed =
      line.trim();

    if (!trimmed) {
      flushParagraph();
      index++;
      continue;
    }

    /*
     * Code placeholder.
     */
    if (
      trimmed.startsWith(
        "___CURRA_CODE_BLOCK_"
      )
    ) {
      flushParagraph();

      output.push(
        trimmed
      );

      index++;
      continue;
    }

    /*
     * Headings.
     */
    if (
      /^<h[1-6]>/.test(
        trimmed
      )
    ) {
      flushParagraph();

      output.push(
        trimmed
      );

      index++;
      continue;
    }

    /*
     * Bullet list.
     */
    if (
      /^[-*+]\s+/.test(
        trimmed
      )
    ) {
      flushParagraph();

      const items = [];

      while (
        index < lines.length &&
        /^[-*+]\s+/.test(
          lines[index].trim()
        )
      ) {
        items.push(
          lines[index]
            .trim()
            .replace(
              /^[-*+]\s+/,
              ""
            )
        );

        index++;
      }

      output.push(
        `<ul>${items
          .map(
            (item) =>
              `<li>${item}</li>`
          )
          .join("")}</ul>`
      );

      continue;
    }

    /*
     * Numbered list.
     */
    if (
      /^\d+\.\s+/.test(
        trimmed
      )
    ) {
      flushParagraph();

      const items = [];

      while (
        index < lines.length &&
        /^\d+\.\s+/.test(
          lines[index].trim()
        )
      ) {
        items.push(
          lines[index]
            .trim()
            .replace(
              /^\d+\.\s+/,
              ""
            )
        );

        index++;
      }

      output.push(
        `<ol>${items
          .map(
            (item) =>
              `<li>${item}</li>`
          )
          .join("")}</ol>`
      );

      continue;
    }

    paragraph.push(
      trimmed
    );

    index++;
  }

  flushParagraph();

  text =
    output.join("\n");

  /*
   * Restore code blocks.
   */
  codeBlocks.forEach(
    (block, codeIndex) => {
      const languageLabel =
        block.language
          ? `<div class="code-language">${escapeHtml(
              block.language
            )}</div>`
          : "";

      const codeHtml =
        `<pre>${languageLabel}<code>${escapeHtml(
          block.code
        )}</code></pre>`;

      text =
        text.replace(
          `___CURRA_CODE_BLOCK_${codeIndex}___`,
          codeHtml
        );
    }
  );

  return text;
}


/* =====================================================================
   SPLIT LAYOUT — LESSON PANE + VIDEO PANE
   ===================================================================== */

/*
   Wraps everything originally inside .main (topbar, chat-window,
   chat-form) into a new .lesson-pane, then appends a sibling
   .video-pane. .main is switched to a horizontal flex row via the
   .main-split class.

   This gives the lesson/chat column its own independent scroll
   container, completely separate from the YouTube video panel, so
   loaded video content can never cover or block scrolling of the
   lesson.

   Safe to call multiple times — it's a no-op after the first run.
*/

function setupSplitLayout() {
  if (videoPane) {
    return videoPane;
  }

  const mainEl =
    document.querySelector(
      ".main"
    );

  if (!mainEl) {
    return null;
  }

  const lessonPane =
    document.createElement(
      "div"
    );

  lessonPane.className =
    "lesson-pane";

  /*
   * Move every existing child of .main (topbar, chat-window,
   * chat-form, mic-status, voice-support-banner, etc.) into the
   * new left-hand lesson pane, preserving order.
   */
  while (mainEl.firstChild) {
    lessonPane.appendChild(
      mainEl.firstChild
    );
  }

  videoPane =
    document.createElement(
      "div"
    );

  videoPane.id =
    "video-pane";

  videoPane.className =
    "video-pane hidden";

  mainEl.classList.add(
    "main-split"
  );

  mainEl.appendChild(
    lessonPane
  );

  mainEl.appendChild(
    videoPane
  );

  return videoPane;
}


/* =====================================================================
   YOUTUBE RECOMMENDATION SECTION
   ===================================================================== */

function applyNormalFlowStyles(
  element
) {
  if (!element) {
    return;
  }

  /*
   * Do NOT set display:block here.
   *
   * Doing that can override a .hidden CSS rule.
   */
  element.style.position =
    "relative";

  element.style.width =
    "100%";

  element.style.boxSizing =
    "border-box";

  element.style.margin =
    "24px 0";

  element.style.clear =
    "both";

  element.style.zIndex =
    "1";
}


function setHidden(
  element,
  hidden
) {
  if (!element) {
    return;
  }

  /*
   * Native hidden property makes this reliable even if
   * .hidden CSS is missing or overridden.
   */
  element.hidden =
    Boolean(hidden);

  element.classList.toggle(
    "hidden",
    Boolean(hidden)
  );
}


function ensureYouTubeRecommendationSection() {
  if (
    youtubeRecommendationSection
  ) {
    return youtubeRecommendationSection;
  }

  youtubeRecommendationSection =
    document.getElementById(
      "youtube-recommendation-section"
    );

  if (
    youtubeRecommendationSection
  ) {
    applyNormalFlowStyles(
      youtubeRecommendationSection
    );

    return youtubeRecommendationSection;
  }

  if (!chatWindow) {
    return null;
  }

  youtubeRecommendationSection =
    document.createElement(
      "section"
    );

  youtubeRecommendationSection.id =
    "youtube-recommendation-section";

  youtubeRecommendationSection.className =
    "youtube-recommendation-section";

  applyNormalFlowStyles(
    youtubeRecommendationSection
  );

  chatWindow.insertAdjacentElement(
    "afterend",
    youtubeRecommendationSection
  );

  return youtubeRecommendationSection;
}


function clearYouTubeRecommendationPrompt() {
  const section =
    ensureYouTubeRecommendationSection();

  if (!section) {
    return;
  }

  section.innerHTML =
    "";

  setHidden(
    section,
    true
  );
}


/*
   #youtube-section / #youtube-list now live inside the dedicated
   .video-pane (see setupSplitLayout above) instead of inside the
   scrolling chat flow. This keeps them from ever overlapping or
   blocking the lesson column's scroll.
*/

function ensureYouTubeSection() {
  if (!videoPane) {
    setupSplitLayout();
  }

  if (!videoPane) {
    return youtubeSection;
  }

  if (!youtubeSection) {
    youtubeSection =
      document.getElementById(
        "youtube-section"
      );
  }

  if (!youtubeList) {
    youtubeList =
      document.getElementById(
        "youtube-list"
      );
  }

  if (!youtubeSection) {
    youtubeSection =
      document.createElement(
        "section"
      );

    youtubeSection.id =
      "youtube-section";

    youtubeSection.className =
      "youtube-section";

    const heading =
      document.createElement(
        "h2"
      );

    heading.textContent =
      "📺 Further Study — YouTube Videos";

    youtubeSection.appendChild(
      heading
    );
  }

  if (!youtubeList) {
    youtubeList =
      document.createElement(
        "div"
      );

    youtubeList.id =
      "youtube-list";

    youtubeList.className =
      "youtube-list";

    youtubeSection.appendChild(
      youtubeList
    );
  }

  /*
   * IMPORTANT: force youtube-section to live inside the video
   * pane no matter where it was found or created.
   *
   * cacheDom() grabs #youtube-section by ID before this function
   * ever runs, and if the page's HTML template already contains
   * these elements (or a prior call created them elsewhere), the
   * cached reference can point to an element sitting inside the
   * lesson column instead of the video pane. Without this check,
   * the videos would render on top of the lesson instead of in
   * their own scrollable panel.
   */
  if (
    youtubeSection.parentElement !==
    videoPane
  ) {
    videoPane.appendChild(
      youtubeSection
    );
  }

  return youtubeSection;
}


/* =====================================================================
   SHOW YOUTUBE PROMPT
   ===================================================================== */

function showYouTubeRecommendationPrompt(
  moduleId
) {
  if (
    !moduleId ||
    !chatWindow
  ) {
    return;
  }

  const section =
    ensureYouTubeRecommendationSection();

  if (!section) {
    return;
  }

  youtubeRecommendationAnswered =
    false;

  section.innerHTML =
    "";

  applyNormalFlowStyles(
    section
  );

  setHidden(
    section,
    false
  );

  const card =
    document.createElement(
      "div"
    );

  card.className =
    "youtube-recommendation-card";

  card.style.position =
    "relative";

  card.style.display =
    "block";

  card.style.width =
    "100%";

  card.style.boxSizing =
    "border-box";

  const heading =
    document.createElement(
      "h3"
    );

  heading.textContent =
    "📚 Want some extra help?";

  card.appendChild(
    heading
  );

  const message =
    document.createElement(
      "p"
    );

  message.textContent =
    "Would you like Curra to recommend a few YouTube tutorials related to this lesson? They are completely optional — you can also continue asking Curra questions or take the quiz.";

  card.appendChild(
    message
  );

  const actions =
    document.createElement(
      "div"
    );

  actions.className =
    "youtube-recommendation-actions";

  const yesBtn =
    document.createElement(
      "button"
    );

  yesBtn.type =
    "button";

  yesBtn.className =
    "youtube-recommend-yes";

  yesBtn.textContent =
    "▶ Yes — show me videos";

  const noBtn =
    document.createElement(
      "button"
    );

  noBtn.type =
    "button";

  noBtn.className =
    "youtube-recommend-no";

  noBtn.textContent =
    "No thanks";

  yesBtn.addEventListener(
    "click",
    async () => {
      if (
        youtubeRecommendationAnswered
      ) {
        return;
      }

      youtubeRecommendationAnswered =
        true;

      yesBtn.disabled =
        true;

      noBtn.disabled =
        true;

      message.textContent =
        "Finding useful tutorials for this lesson…";

      await loadYouTubeVideos(
        moduleId
      );
    }
  );

  noBtn.addEventListener(
    "click",
    () => {
      if (
        youtubeRecommendationAnswered
      ) {
        return;
      }

      youtubeRecommendationAnswered =
        true;

      yesBtn.disabled =
        true;

      noBtn.disabled =
        true;

      clearYouTubeRecommendationPrompt();
    }
  );

  actions.appendChild(
    yesBtn
  );

  actions.appendChild(
    noBtn
  );

  card.appendChild(
    actions
  );

  section.appendChild(
    card
  );

  const videos =
    ensureYouTubeSection();

  if (videos) {
    setHidden(
      videos,
      true
    );

    setHidden(
      videoPane,
      true
    );

    if (youtubeList) {
      youtubeList.innerHTML =
        "";
    }
  }
}


/* =====================================================================
   YOUTUBE DATA HELPERS
   ===================================================================== */

function getYouTubeVideoId(
  video
) {
  if (!video) {
    return "";
  }

  const directId =
    video.video_id ||
    video.videoId ||
    video.youtube_id ||
    video.youtubeId ||
    "";

  if (
    /^[A-Za-z0-9_-]{6,}$/.test(
      String(directId)
    )
  ) {
    return String(
      directId
    );
  }

  const url =
    String(
      video.url ||
      video.video_url ||
      video.link ||
      ""
    );

  const match =
    url.match(
      /(?:v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{6,})/
    );

  return match
    ? match[1]
    : "";
}


function getYouTubeVideoUrl(
  video
) {
  const direct =
    safeHttpUrl(
      video &&
        (
          video.url ||
          video.video_url ||
          video.link
        )
    );

  if (direct) {
    return direct;
  }

  const id =
    getYouTubeVideoId(
      video
    );

  if (!id) {
    return "";
  }

  return (
    `https://www.youtube.com/watch?v=${encodeURIComponent(
      id
    )}`
  );
}


function getYouTubeThumbnail(
  video
) {
  const direct =
    safeHttpUrl(
      video &&
        (
          video.thumbnail ||
          video.thumbnail_url ||
          video.thumbnailUrl
        )
    );

  if (direct) {
    return direct;
  }

  const id =
    getYouTubeVideoId(
      video
    );

  if (!id) {
    return "";
  }

  return (
    `https://i.ytimg.com/vi/${encodeURIComponent(
      id
    )}/hqdefault.jpg`
  );
}


/* =====================================================================
   LOAD YOUTUBE VIDEOS
   ===================================================================== */

async function loadYouTubeVideos(
  moduleId
) {
  if (!moduleId) {
    return;
  }

  const section =
    ensureYouTubeSection();

  if (
    !section ||
    !youtubeList
  ) {
    return;
  }

  const requestToken =
    ++youtubeRequestToken;

  setHidden(
    section,
    false
  );

  setHidden(
    videoPane,
    false
  );

  applyNormalFlowStyles(
    section
  );

  youtubeList.innerHTML =
    "<p>Finding helpful tutorials…</p>";

  try {
    const data =
      await fetchJson(
        `/api/youtube?student_id=${encodeURIComponent(
          STUDENT_ID
        )}&module_id=${encodeURIComponent(
          moduleId
        )}`,
        {
          method:
            "GET"
        }
      );

    if (
      requestToken !==
      youtubeRequestToken
    ) {
      return;
    }

    if (
      !isCurrentModule(
        moduleId
      )
    ) {
      return;
    }

    const videos =
      Array.isArray(
        data.videos
      )
        ? data.videos
        : [];

    if (!videos.length) {
      youtubeList.innerHTML =
        `<p>
          No additional videos were found for this lesson right now.
          You can continue learning with Curra.
        </p>`;

      return;
    }

    youtubeList.innerHTML =
      "";

    videos.forEach(
      (video) => {
        const card =
          document.createElement(
            "a"
          );

        card.className =
          "youtube-card";

        const videoUrl =
          getYouTubeVideoUrl(
            video
          );

        if (videoUrl) {
          card.href =
            videoUrl;

          card.target =
            "_blank";

          card.rel =
            "noopener noreferrer";
        } else {
          card.href =
            "#";

          card.addEventListener(
            "click",
            (event) => {
              event.preventDefault();
            }
          );
        }

        const thumbnail =
          document.createElement(
            "img"
          );

        thumbnail.className =
          "youtube-thumbnail";

        const thumbnailUrl =
          getYouTubeThumbnail(
            video
          );

        if (thumbnailUrl) {
          thumbnail.src =
            thumbnailUrl;
        } else {
          thumbnail.classList.add(
            "hidden"
          );
        }

        thumbnail.alt =
          video.title
            ? `Thumbnail for ${String(
                video.title
              )}`
            : "YouTube video thumbnail";

        thumbnail.loading =
          "lazy";

        thumbnail.onerror =
          () => {
            thumbnail.classList.add(
              "hidden"
            );
          };

        const info =
          document.createElement(
            "div"
          );

        info.className =
          "youtube-card-info";

        const title =
          document.createElement(
            "h3"
          );

        title.textContent =
          String(
            video.title ||
            "YouTube tutorial"
          );

        const channel =
          document.createElement(
            "p"
          );

        channel.textContent =
          String(
            video.channel ||
            video.channel_title ||
            video.author ||
            "YouTube"
          );

        info.appendChild(
          title
        );

        info.appendChild(
          channel
        );

        card.appendChild(
          thumbnail
        );

        card.appendChild(
          info
        );

        youtubeList.appendChild(
          card
        );
      }
    );
  } catch (error) {
    console.error(
      "YouTube loading failed:",
      error
    );

    if (
      requestToken !==
      youtubeRequestToken
    ) {
      return;
    }

    if (
      !isCurrentModule(
        moduleId
      )
    ) {
      return;
    }

    setHidden(
      section,
      false
    );

    setHidden(
      videoPane,
      false
    );

    youtubeList.innerHTML =
      `<p>
        ⚠️ I couldn't load the optional YouTube recommendations
        right now. You can continue studying with Curra.
      </p>`;
  }
}


/* =====================================================================
   PROGRESS STATUS
   ===================================================================== */

function statusIcon(
  status
) {
  const normalized =
    String(
      status || ""
    )
      .trim()
      .toLowerCase();

  const icons = {
    mastered:
      "✅",

    completed:
      "✅",

    passed:
      "✅",

    in_progress:
      "🔵",

    active:
      "🔵",

    available:
      "▶️",

    unlocked:
      "▶️",

    locked:
      "🔒"
  };

  return (
    icons[normalized] ||
    "🔒"
  );
}


function isModuleLocked(
  status
) {
  const normalized =
    String(
      status || ""
    )
      .trim()
      .toLowerCase();

  return (
    normalized ===
      "locked" ||
    normalized ===
      "unavailable"
  );
}


/* =====================================================================
   LOAD PROGRESS
   ===================================================================== */

async function loadProgress() {
  try {
    const data =
      await fetchJson(
        `/api/progress?student_id=${encodeURIComponent(
          STUDENT_ID
        )}`,
        {
          method:
            "GET"
        }
      );

    const completion =
      normalizePercentage(
        data.completion_percentage ??
        data.completion ??
        0
      );

    if (progressPct) {
      progressPct.textContent =
        `${Math.round(
          completion
        )}%`;
    }

    if (progressFill) {
      progressFill.style.width =
        `${completion}%`;
    }

    if (progressSub) {
      const mastered =
        data.mastered_modules ??
        data.completed_modules ??
        0;

      const total =
        data.total_modules ??
        0;

      progressSub.textContent =
        `${mastered} / ${total} modules mastered`;
    }

    if (!trackListEl) {
      return data;
    }

    trackListEl.innerHTML =
      "";

    const tracks =
      Array.isArray(
        data.tracks
      )
        ? data.tracks
        : [];

    if (!tracks.length) {
      trackListEl.innerHTML =
        `<div class="progress-empty">
          No modules are available yet.
        </div>`;

      return data;
    }

    tracks.forEach(
      (track) => {
        const trackEl =
          document.createElement(
            "div"
          );

        trackEl.className =
          "track";

        const header =
          document.createElement(
            "div"
          );

        header.className =
          "track-header";

        header.textContent =
          String(
            track.track_name ||
            track.name ||
            "Track"
          );

        trackEl.appendChild(
          header
        );

        const modules =
          Array.isArray(
            track.modules
          )
            ? track.modules
            : [];

        modules.forEach(
          (module) => {
            const moduleId =
              module.id ??
              module.module_id;

            if (
              moduleId ===
              undefined ||
              moduleId ===
              null
            ) {
              return;
            }

            const status =
              String(
                module.status ||
                "locked"
              ).toLowerCase();

            const locked =
              isModuleLocked(
                status
              );

            const item =
              document.createElement(
                "div"
              );

            item.className =
              "module-item";

            if (locked) {
              item.classList.add(
                "locked"
              );
            }

            if (
              String(moduleId) ===
              String(currentModuleId)
            ) {
              item.classList.add(
                "active"
              );
            }

            const icon =
              document.createElement(
                "span"
              );

            icon.className =
              "status-icon";

            icon.textContent =
              statusIcon(
                status
              );

            const title =
              document.createElement(
                "span"
              );

            title.className =
              "m-title";

            title.textContent =
              `${moduleId}. ${
                module.title ||
                module.module_title ||
                "Untitled module"
              }`;

            const score =
              document.createElement(
                "span"
              );

            score.className =
              "m-score";

            if (
              module.best_score !==
                null &&
              module.best_score !==
                undefined
            ) {
              const scorePercent =
                normalizePercentage(
                  module.best_score
                );

              score.textContent =
                `${Math.round(
                  scorePercent
                )}%`;
            }

            item.appendChild(
              icon
            );

            item.appendChild(
              title
            );

            item.appendChild(
              score
            );

            if (!locked) {
              item.addEventListener(
                "click",
                () => {
                  selectModule(
                    moduleId,
                    module.title ||
                      module.module_title ||
                      "Untitled module"
                  );
                }
              );
            }

            trackEl.appendChild(
              item
            );
          }
        );

        trackListEl.appendChild(
          trackEl
        );
      }
    );

    return data;
  } catch (error) {
    console.error(
      "Progress loading failed:",
      error
    );

    if (trackListEl) {
      trackListEl.innerHTML =
        `<div class="progress-error">
          ⚠️ Couldn't load your progress.
          Please refresh and try again.
        </div>`;
    }

    return null;
  }
}


/* =====================================================================
   CLOSE QUIZ MODAL
   ===================================================================== */

function closeQuizModal() {
  if (quizModal) {
    quizModal.classList.add(
      "hidden"
    );

    quizModal.hidden =
      true;
  }

  stopSpeaking();
}


function openQuizModal() {
  if (!quizModal) {
    return;
  }

  quizModal.hidden =
    false;

  quizModal.classList.remove(
    "hidden"
  );
}


function setupQuizModal() {
  if (quizCloseBtn) {
    quizCloseBtn.addEventListener(
      "click",
      () => {
        closeQuizModal();
      }
    );
  }

  if (quizModal) {
    quizModal.addEventListener(
      "click",
      (event) => {
        if (
          event.target ===
          quizModal
        ) {
          closeQuizModal();
        }
      }
    );
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        quizModal &&
        !quizModal.classList.contains(
          "hidden"
        )
      ) {
        closeQuizModal();
      }
    }
  );
}


/* =====================================================================
   SELECT MODULE
   ===================================================================== */

async function selectModule(
  id,
  title
) {
  const requestToken =
    ++moduleRequestToken;

  currentModuleId =
    id;

  currentQuiz =
    null;

  lessonLoaded =
    false;

  aiRequestInProgress =
    false;

  youtubeRecommendationAnswered =
    false;

  /*
   * Invalidate all older async work.
   */
  youtubeRequestToken++;
  chatRequestToken++;
  quizRequestToken++;

  stopSpeaking();

  /*
   * Stop microphone.
   */
  if (isRecording) {
    speechShouldSubmit =
      false;

    if (recognition) {
      try {
        recognition.stop();
      } catch {
        /* Already stopped. */
      }
    }
  }

  isRecording =
    false;

  if (micBtn) {
    micBtn.classList.remove(
      "recording"
    );
  }

  /*
   * Close old quiz.
   */
  closeQuizModal();

  /*
   * Clear YouTube UI.
   */
  clearYouTubeRecommendationPrompt();

  const videos =
    ensureYouTubeSection();

  if (videos) {
    setHidden(
      videos,
      true
    );

    setHidden(
      videoPane,
      true
    );
  }

  if (youtubeList) {
    youtubeList.innerHTML =
      "";
  }

  /*
   * Update title.
   */
  if (currentModuleTitle) {
    currentModuleTitle.textContent =
      `${id}. ${title}`;
  }

  /*
   * Clear old lesson/chat.
   */
  if (chatWindow) {
    chatWindow.innerHTML =
      "";
  }

  /*
   * Disable controls.
   */
  setChatEnabled(
    false
  );

  setQuizEnabled(
    false
  );

  const loading =
    addLoading(
      "Preparing your complete lesson…"
    );

  /*
   * Refresh progress.
   */
  await loadProgress();

  if (
    requestToken !==
    moduleRequestToken
  ) {
    return;
  }

  try {
    const data =
      await fetchJson(
        "/api/teach",
        {
          method:
            "POST",

          body:
            JSON.stringify({
              student_id:
                STUDENT_ID,

              module_id:
                id
            })
        }
      );

    if (
      requestToken !==
      moduleRequestToken
    ) {
      return;
    }

    if (loading) {
      loading.remove();
    }

    if (data.error) {
      addMessage(
        "system",
        `⚠️ ${data.error}`
      );

      return;
    }

    const lesson =
      String(
        data.lesson ||
        data.content ||
        data.response ||
        ""
      ).trim();

    if (!lesson) {
      addMessage(
        "system",
        "⚠️ The lesson was returned without any content."
      );

      lessonLoaded =
        false;

      return;
    }

    /*
     * LESSON FIRST.
     */
    addMessage(
      "assistant",
      lesson
    );

    lessonLoaded =
      true;

    /*
     * Optional voice.
     */
    speak(
      lesson
    );

    /*
     * Optional recommendation prompt AFTER lesson.
     */
    showYouTubeRecommendationPrompt(
      id
    );

    /*
     * Enable controls.
     */
    setChatEnabled(
      true
    );

    setQuizEnabled(
      true
    );

    if (chatInput) {
      chatInput.focus();
    }
  } catch (error) {
    console.error(
      "Lesson loading failed:",
      error
    );

    if (
      requestToken !==
      moduleRequestToken
    ) {
      return;
    }

    if (loading) {
      loading.remove();
    }

    lessonLoaded =
      false;

    setChatEnabled(
      false
    );

    setQuizEnabled(
      false
    );

    addMessage(
      "system",
      `⚠️ ${
        error.message ||
        "Couldn't load this lesson. Please try again."
      }`
    );
  }
}


/* =====================================================================
   CHAT SUBMISSION
   ===================================================================== */

function setupChat() {
  if (!chatForm) {
    return;
  }

  /*
     Send button state: while the input is empty, the button reads
     as a plain ghost icon (matching the mic button's style). Once
     the student types something, .has-text switches it to the
     solid colored send button. Purely visual — submission logic
     below is unaffected.
  */
  if (chatInput) {
    const updateHasText =
      () => {
        const hasText =
          chatInput.value.trim().length > 0;

        chatForm.classList.toggle(
          "has-text",
          hasText
        );
      };

    chatInput.addEventListener(
      "input",
      updateHasText
    );

    updateHasText();
  }

  chatForm.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      if (aiRequestInProgress) {
        return;
      }

      if (!lessonLoaded) {
        addMessage(
          "system",
          "Please wait for Curra to finish loading the lesson first."
        );

        return;
      }

      if (
        !chatInput ||
        !currentModuleId
      ) {
        return;
      }

      const message =
        chatInput.value.trim();

      if (!message) {
        return;
      }

      const moduleAtRequest =
        currentModuleId;

      const requestToken =
        ++chatRequestToken;

      aiRequestInProgress =
        true;

      stopSpeaking();

      addMessage(
        "user",
        message
      );

      chatInput.value =
        "";

      chatForm.classList.remove(
        "has-text"
      );

      setChatEnabled(
        false
      );

      const loading =
        addLoading();

      try {
        const data =
          await fetchJson(
            "/api/ask",
            {
              method:
                "POST",

              body:
                JSON.stringify({
                  student_id:
                    STUDENT_ID,

                  module_id:
                    moduleAtRequest,

                  message:
                    message
                })
            }
          );

        /*
         * Ignore response from an old module/request.
         */
        if (
          requestToken !==
          chatRequestToken ||
          !isCurrentModule(
            moduleAtRequest
          )
        ) {
          if (loading) {
            loading.remove();
          }

          return;
        }

        if (loading) {
          loading.remove();
        }

        if (data.error) {
          addMessage(
            "system",
            `⚠️ ${data.error}`
          );

          return;
        }

        const reply =
          String(
            data.reply ||
            data.response ||
            data.answer ||
            ""
          ).trim();

        if (!reply) {
          addMessage(
            "system",
            "⚠️ Curra returned an empty response. Please try again."
          );

          return;
        }

        addMessage(
          "assistant",
          reply
        );

        speak(
          reply
        );
      } catch (error) {
        console.error(
          "Curra request failed:",
          error
        );

        if (loading) {
          loading.remove();
        }

        if (
          requestToken !==
          chatRequestToken ||
          !isCurrentModule(
            moduleAtRequest
          )
        ) {
          return;
        }

        addMessage(
          "system",
          `⚠️ ${
            error.message ||
            "Curra couldn't respond right now. Please try again."
          }`
        );
      } finally {
        if (
          requestToken ===
          chatRequestToken
        ) {
          aiRequestInProgress =
            false;

          setChatEnabled(
            lessonLoaded &&
            isCurrentModule(
              moduleAtRequest
            )
          );

          if (
            chatInput &&
            lessonLoaded &&
            isCurrentModule(
              moduleAtRequest
            )
          ) {
            chatInput.focus();
          }
        }
      }
    }
  );
}


/* =====================================================================
   QUIZ HELPERS
   ===================================================================== */

function isMultipleChoiceQuestion(
  question
) {
  const type =
    String(
      question &&
        question.type ||
      ""
    )
      .toLowerCase()
      .replace(
        /[-\s]/g,
        "_"
      );

  return (
    type ===
      "multiple_choice" ||
    type ===
      "mcq" ||
    type ===
      "multiplechoice"
  );
}


function findQuizQuestionElement(
  questionId
) {
  if (!quizBody) {
    return null;
  }

  const elements =
    quizBody.querySelectorAll(
      ".quiz-q"
    );

  const target =
    String(
      questionId
    );

  for (const element of elements) {
    if (
      String(
        element.dataset.qid
      ) === target
    ) {
      return element;
    }
  }

  return null;
}


/* =====================================================================
   QUIZ GENERATION
   ===================================================================== */

function setupQuiz() {
  if (!quizBtn) {
    return;
  }

  quizBtn.addEventListener(
    "click",
    async () => {
      if (
        quizBtn.disabled ||
        !lessonLoaded ||
        !currentModuleId
      ) {
        return;
      }

      const moduleAtRequest =
        currentModuleId;

      const requestToken =
        ++quizRequestToken;

      quizBtn.disabled =
        true;

      currentQuiz =
        null;

      if (quizTitle) {
        quizTitle.textContent =
          "Generating quiz…";
      }

      if (quizBody) {
        quizBody.innerHTML =
          `<p style="color:var(--muted)">
            Curra is building your quiz…
          </p>`;
      }

      if (quizSubmitBtn) {
        quizSubmitBtn.disabled =
          true;

        quizSubmitBtn.textContent =
          "Submit Answers";

        quizSubmitBtn.onclick =
          submitQuiz;
      }

      openQuizModal();

      try {
        const data =
          await fetchJson(
            "/api/quiz/generate",
            {
              method:
                "POST",

              body:
                JSON.stringify({
                  student_id:
                    STUDENT_ID,

                  module_id:
                    moduleAtRequest
                })
            }
          );

        /*
         * Ignore stale quiz response.
         */
        if (
          requestToken !==
          quizRequestToken ||
          !isCurrentModule(
            moduleAtRequest
          )
        ) {
          return;
        }

        if (data.error) {
          if (quizBody) {
            quizBody.innerHTML =
              "";

            const errorEl =
              document.createElement(
                "p"
              );

            errorEl.style.color =
              "var(--danger)";

            errorEl.textContent =
              `⚠️ ${data.error}`;

            quizBody.appendChild(
              errorEl
            );
          }

          return;
        }

        const quiz =
          data.quiz ||
          data;

        if (
          !quiz ||
          !Array.isArray(
            quiz.questions
          )
        ) {
          throw new Error(
            "Invalid quiz data received."
          );
        }

        currentQuiz =
          quiz;

        renderQuiz(
          currentQuiz
        );
      } catch (error) {
        console.error(
          "Quiz generation failed:",
          error
        );

        if (
          requestToken !==
          quizRequestToken ||
          !isCurrentModule(
            moduleAtRequest
          )
        ) {
          return;
        }

        if (quizBody) {
          quizBody.innerHTML =
            "";

          const errorEl =
            document.createElement(
              "p"
            );

          errorEl.style.color =
            "var(--danger)";

          errorEl.textContent =
            `⚠️ ${
              error.message ||
              "Couldn't generate the quiz. Please try again."
            }`;

          quizBody.appendChild(
            errorEl
          );
        }

        if (quizSubmitBtn) {
          quizSubmitBtn.disabled =
            true;
        }
      } finally {
        if (
          requestToken ===
            quizRequestToken &&
          isCurrentModule(
            moduleAtRequest
          )
        ) {
          quizBtn.disabled =
            false;
        }
      }
    }
  );
}


/* =====================================================================
   RENDER QUIZ
   ===================================================================== */

function renderQuiz(
  quiz
) {
  if (
    !quiz ||
    !Array.isArray(
      quiz.questions
    ) ||
    !quizBody
  ) {
    return;
  }

  if (quizTitle) {
    quizTitle.textContent =
      `Quiz — ${
        currentModuleTitle
          ? currentModuleTitle.textContent
          : "Current Module"
      }`;
  }

  quizBody.innerHTML =
    "";

  quiz.questions.forEach(
    (question, questionIndex) => {
      const qEl =
        document.createElement(
          "div"
        );

      qEl.className =
        "quiz-q";

      const questionId =
        question.id ??
        question.question_id ??
        questionIndex + 1;

      qEl.dataset.qid =
        String(
          questionId
        );

      const prompt =
        document.createElement(
          "p"
        );

      prompt.className =
        "prompt";

      prompt.textContent =
        `${questionIndex + 1}. ${
          question.prompt ||
          question.question ||
          "Question"
        }`;

      qEl.appendChild(
        prompt
      );

      if (
        isMultipleChoiceQuestion(
          question
        )
      ) {
        const options =
          Array.isArray(
            question.options
          )
            ? question.options
            : [];

        options.forEach(
          (option, optionIndex) => {
            const label =
              document.createElement(
                "label"
              );

            label.className =
              "quiz-opt";

            const input =
              document.createElement(
                "input"
              );

            input.type =
              "radio";

            input.name =
              `q${questionId}`;

            input.value =
              String.fromCharCode(
                65 + optionIndex
              );

            label.appendChild(
              input
            );

            label.appendChild(
              document.createTextNode(
                ` ${String(
                  option
                )}`
              )
            );

            qEl.appendChild(
              label
            );
          }
        );
      } else {
        const textarea =
          document.createElement(
            "textarea"
          );

        textarea.name =
          `q${questionId}`;

        textarea.placeholder =
          "Type your answer…";

        textarea.rows =
          4;

        textarea.autocomplete =
          "off";

        qEl.appendChild(
          textarea
        );
      }

      const resultSlot =
        document.createElement(
          "div"
        );

      resultSlot.className =
        "quiz-result-slot";

      qEl.appendChild(
        resultSlot
      );

      quizBody.appendChild(
        qEl
      );
    }
  );

  if (quizSubmitBtn) {
    quizSubmitBtn.disabled =
      false;

    quizSubmitBtn.textContent =
      "Submit Answers";

    quizSubmitBtn.onclick =
      submitQuiz;
  }
}


/* =====================================================================
   SUBMIT QUIZ
   ===================================================================== */

async function submitQuiz() {
  if (
    !currentQuiz ||
    !Array.isArray(
      currentQuiz.questions
    ) ||
    !quizBody ||
    !quizSubmitBtn ||
    !currentModuleId
  ) {
    return;
  }

  if (
    quizSubmitBtn.disabled
  ) {
    return;
  }

  const moduleAtRequest =
    currentModuleId;

  const requestToken =
    ++quizRequestToken;

  const answers =
    {};

  const previousError =
    quizBody.querySelector(
      ".quiz-error"
    );

  if (previousError) {
    previousError.remove();
  }

  /*
   * Collect answers.
   */
  currentQuiz.questions.forEach(
    (question, questionIndex) => {
      const questionId =
        question.id ??
        question.question_id ??
        questionIndex + 1;

      const name =
        `q${questionId}`;

      if (
        isMultipleChoiceQuestion(
          question
        )
      ) {
        const inputs =
          quizBody.querySelectorAll(
            `input[name="${CSS.escape
              ? CSS.escape(name)
              : name
            }"]`
          );

        let checked =
          null;

        inputs.forEach(
          (input) => {
            if (
              input.checked
            ) {
              checked =
                input;
            }
          }
        );

        answers[
          questionId
        ] =
          checked
            ? checked.value
            : "";
      } else {
        const textareas =
          quizBody.querySelectorAll(
            "textarea"
          );

        let textarea =
          null;

        textareas.forEach(
          (element) => {
            if (
              element.name ===
              name
            ) {
              textarea =
                element;
            }
          }
        );

        answers[
          questionId
        ] =
          textarea
            ? textarea.value.trim()
            : "";
      }
    }
  );

  quizSubmitBtn.disabled =
    true;

  quizSubmitBtn.textContent =
    "Grading…";

  try {
    const data =
      await fetchJson(
        "/api/quiz/grade",
        {
          method:
            "POST",

          body:
            JSON.stringify({
              student_id:
                STUDENT_ID,

              module_id:
                moduleAtRequest,

              answers:
                answers
            })
        }
      );

    /*
     * Ignore stale grading response.
     */
    if (
      requestToken !==
      quizRequestToken ||
      !isCurrentModule(
        moduleAtRequest
      )
    ) {
      return;
    }

    if (data.error) {
      showQuizError(
        data.error
      );

      quizSubmitBtn.disabled =
        false;

      quizSubmitBtn.textContent =
        "Submit Answers";

      quizSubmitBtn.onclick =
        submitQuiz;

      return;
    }

    renderQuizResults(
      data
    );

    quizSubmitBtn.textContent =
      "Close & Continue";

    quizSubmitBtn.disabled =
      false;

    quizSubmitBtn.onclick =
      () => {
        closeQuizModal();

        currentQuiz =
          null;

        loadProgress();
      };

    await loadProgress();
  } catch (error) {
    console.error(
      "Quiz grading failed:",
      error
    );

    if (
      requestToken !==
      quizRequestToken ||
      !isCurrentModule(
        moduleAtRequest
      )
    ) {
      return;
    }

    showQuizError(
      error.message ||
      "Couldn't grade the quiz. Please try again."
    );

    quizSubmitBtn.disabled =
      false;

    quizSubmitBtn.textContent =
      "Submit Answers";

    quizSubmitBtn.onclick =
      submitQuiz;
  }
}


/* =====================================================================
   QUIZ ERROR
   ===================================================================== */

function showQuizError(
  message
) {
  if (!quizBody) {
    return;
  }

  const old =
    quizBody.querySelector(
      ".quiz-error"
    );

  if (old) {
    old.remove();
  }

  const errorEl =
    document.createElement(
      "p"
    );

  errorEl.className =
    "quiz-error";

  errorEl.style.color =
    "var(--danger)";

  errorEl.textContent =
    `⚠️ ${String(
      message ||
      "An error occurred."
    )}`;

  quizBody.prepend(
    errorEl
  );
}


/* =====================================================================
   QUIZ RESULTS
   ===================================================================== */

function renderQuizResults(
  data
) {
  if (!quizBody) {
    return;
  }

  const oldBanner =
    quizBody.querySelector(
      ".score-banner"
    );

  if (oldBanner) {
    oldBanner.remove();
  }

  const banner =
    document.createElement(
      "div"
    );

  banner.className =
    `score-banner ${
      data.passed
        ? "pass"
        : "fail"
    }`;

  const scorePercent =
    Math.round(
      normalizePercentage(
        data.score ??
        data.percentage ??
        0
      )
    );

  const thresholdPercent =
    Math.round(
      normalizePercentage(
        data.threshold ??
        data.passing_score ??
        0
      )
    );

  if (data.passed) {
    banner.textContent =
      `🎉 You scored ${scorePercent}% — module mastered! Next module unlocked.`;
  } else {
    banner.textContent =
      `You scored ${scorePercent}% — need ${thresholdPercent}% to pass. Review the feedback below, ask Curra questions, then retake the quiz.`;
  }

  quizBody.prepend(
    banner
  );

  if (
    !Array.isArray(
      data.results
    )
  ) {
    return;
  }

  data.results.forEach(
    (result, index) => {
      const questionId =
        result.id ??
        result.question_id ??
        index + 1;

      const qEl =
        findQuizQuestionElement(
          questionId
        );

      if (!qEl) {
        return;
      }

      const slot =
        qEl.querySelector(
          ".quiz-result-slot"
        );

      if (!slot) {
        return;
      }

      slot.innerHTML =
        "";

      const resultEl =
        document.createElement(
          "div"
        );

      resultEl.className =
        `quiz-result ${
          result.correct
            ? "correct"
            : "incorrect"
        }`;

      const feedback =
        String(
          result.feedback ||
          result.explanation ||
          ""
        );

      resultEl.textContent =
        `${
          result.correct
            ? "✔ Correct"
            : "✘ Needs review"
        }${feedback ? ` — ${feedback}` : ""}`;

      slot.appendChild(
        resultEl
      );
    }
  );
}


/* =====================================================================
   INITIALIZE DOM REFERENCES
   ===================================================================== */

function cacheDom() {
  chatForm =
    document.getElementById(
      "chat-form"
    );

  chatInput =
    document.getElementById(
      "chat-input"
    );

  chatWindow =
    document.getElementById(
      "chat-window"
    );

  micBtn =
    document.getElementById(
      "mic-btn"
    );

  micStatus =
    document.getElementById(
      "mic-status"
    );

  voiceToggle =
    document.getElementById(
      "voice-toggle"
    );

  voiceToggleLabel =
    document.getElementById(
      "voice-toggle-label"
    );

  voiceSupportBanner =
    document.getElementById(
      "voice-support-banner"
    );

  stopSpeakBtn =
    document.getElementById(
      "stop-speak-btn"
    );

  currentModuleTitle =
    document.getElementById(
      "current-module-title"
    );

  quizBtn =
    document.getElementById(
      "quiz-btn"
    );

  progressPct =
    document.getElementById(
      "progress-pct"
    );

  progressFill =
    document.getElementById(
      "progress-fill"
    );

  progressSub =
    document.getElementById(
      "progress-sub"
    );

  trackListEl =
    document.getElementById(
      "track-list"
    );

  quizModal =
    document.getElementById(
      "quiz-modal"
    );

  quizBody =
    document.getElementById(
      "quiz-body"
    );

  quizTitle =
    document.getElementById(
      "quiz-title"
    );

  quizSubmitBtn =
    document.getElementById(
      "quiz-submit"
    );

  quizCloseBtn =
    document.getElementById(
      "quiz-close"
    );

  youtubeSection =
    document.getElementById(
      "youtube-section"
    );

  youtubeList =
    document.getElementById(
      "youtube-list"
    );

  youtubeRecommendationSection =
    document.getElementById(
      "youtube-recommendation-section"
    );
}


/* =====================================================================
   INITIALIZE
   ===================================================================== */

async function initializeCurra() {
  cacheDom();

  /*
   * Apply the saved theme (or default dark) immediately, and build
   * the toggle switch in the topbar. This runs before the split
   * layout so the toggle lands in .topbar-actions before that
   * markup gets relocated into .lesson-pane.
   */
  applyTheme(
    loadThemePreference()
  );

  setupThemeToggle();

  /*
   * Build the split layout (lesson pane + video pane) before
   * anything else touches .main's children.
   */
  setupSplitLayout();

  /*
   * Voice preference must be loaded after the DOM exists.
   */
  voiceOutputEnabled =
    loadVoicePreference();

  /*
   * Set up browser features.
   */
  setupVoiceSupport();
  setupVoiceToggle();
  setupStopSpeaking();
  setupMicrophone();

  /*
   * Quiz / modal.
   */
  setupQuizModal();
  setupQuiz();

  /*
   * Chat.
   */
  setupChat();

  /*
   * Optional YouTube containers.
   */
  ensureYouTubeRecommendationSection();
  ensureYouTubeSection();

  clearYouTubeRecommendationPrompt();

  if (youtubeSection) {
    setHidden(
      youtubeSection,
      true
    );
  }

  if (videoPane) {
    setHidden(
      videoPane,
      true
    );
  }

  if (youtubeList) {
    youtubeList.innerHTML =
      "";
  }

  /*
   * Disable controls until a lesson exists.
   */
  setChatEnabled(
    false
  );

  setQuizEnabled(
    false
  );

  /*
   * Load progress.
   */
  await loadProgress();

  /*
   * Browser voice list can load asynchronously.
   */
  if (
    synth &&
    "onvoiceschanged" in synth
  ) {
    synth.onvoiceschanged =
      () => {
        getCurraVoice();
      };
  }

  /*
   * Expose useful functions for debugging / HTML integration.
   */
  window.Curra = {
    studentId:
      STUDENT_ID,

    selectModule,
    loadProgress,

    speak,
    stopSpeaking,

    loadYouTubeVideos,

    generateQuiz:
      () => {
        if (quizBtn) {
          quizBtn.click();
        }
      }
  };
}


/* =====================================================================
   START
   ===================================================================== */

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initializeCurra,
    {
      once:
        true
    }
  );
} else {
  initializeCurra();
}