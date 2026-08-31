# 📘 Curra — Offline AI Curriculum Tutor

Curra is a self-paced chatbot instructor that teaches a student every module in the
**"Data Science, Machine Learning & Career Readiness Program"** curriculum, tracks their
progress, quizzes them, and only unlocks the next module once they've proven mastery.
Students can also jump back into any already-unlocked module to be re-taught a topic
they're struggling with — **by typing or by talking**, and Curra can respond back in text
and/or speech.

It is intentionally simple: **Flask + SQLite + vanilla JS**, no heavy framework, one LLM
call pattern reused everywhere (teach / re-explain / quiz-gen / quiz-grade). This makes it
easy to run for free on Render's free tier using a free Grok API key.

---

## 1. How it works

```
curriculum.json  ──►  Flask backend  ──►  Grok LLM (x.ai)
                          │  │
                          │  └── SQLite (per-student progress + chat log)
                          ▼
                     Browser chat UI (HTML/CSS/JS)
```

- **`data/curriculum.json`** is the single source of truth for tracks → modules → topics.
  It's the file you uploaded (`learner_curriculum_data.json`), renamed for the app.
- **On first visit**, a random `student_id` is generated in the browser's `localStorage`
  and every module gets a progress row seeded in SQLite:
  - Modules already marked `"completed"` in the JSON are seeded as `mastered`.
  - The next module in sequence is unlocked (`in_progress`), everything else is `locked`.
- **Teaching**: clicking a module calls `/api/teach`, which sends the module's title +
  topic list to Grok with a teaching system prompt, and streams back a structured lesson.
- **Re-teaching / questions**: anything the student types in the chat box goes to
  `/api/ask`, which asks Grok to diagnose the confusion and re-explain differently.
- **Quizzing**: "Take Quiz" calls `/api/quiz/generate`, which asks Grok to return **strict
  JSON** (3 multiple-choice + 2 short-answer questions) covering the module's topics.
  On submit, `/api/quiz/grade` scores multiple-choice locally and uses Grok to grade the
  short-answer questions against a model answer.
- **Progress gating**: a score ≥ `PASS_THRESHOLD` (default 70%) marks the module
  `mastered` and unlocks the next module. A failing score keeps it `in_progress` so the
  student can ask more questions and retake the quiz.
- Everything (lessons, questions, answers, scores) is logged to SQLite so progress
  survives restarts and multiple students can use the same deployment (each gets their
  own `student_id`).

### Voice (speak + listen)

Voice runs entirely in the **browser**, not on your Flask backend, using the built-in
**Web Speech API** — so it costs nothing, needs no API key, and doesn't touch your Grok
free-tier quota:

- **🎤 Mic button** (next to the chat input) uses `SpeechRecognition` to transcribe the
  student's spoken question, drops it into the chat input, and auto-sends it to `/api/ask`
  — same backend flow as typing, the model never knows the difference.
- **🔊 Voice toggle** (top right) controls whether Curra automatically reads lessons and
  replies aloud using `SpeechSynthesis` as soon as they arrive. Every assistant message
  also gets its own **"🔊 Read aloud"** button so a student can replay it any time, and a
  **⏹ Stop** button appears whenever Curra is talking.
- Students can freely mix input modes — type one question, speak the next — nothing needs
  to be toggled to switch.
- If a browser doesn't support the Web Speech API (older Firefox, some mobile browsers),
  the app detects this on load, shows a small warning banner, disables the mic button, and
  everything else keeps working normally via typing/reading.

**Browser support:** Chrome, Edge, and Safari support both directions well. Firefox
currently only supports `SpeechSynthesis` (speaking), not `SpeechRecognition` (listening)
— the mic button will be disabled there but voice *output* still works.

---

## 2. Tech stack

| Layer            | Choice                                   | Why |
|-------------------|-------------------------------------------|-----|
| Backend            | Python 3 + Flask                          | Lightweight, easy to deploy on Render free tier |
| LLM                | **Grok** (x.ai) via the OpenAI-compatible SDK | Free-tier API, drop-in `openai` Python client works unmodified by pointing `base_url` at `https://api.x.ai/v1` |
| Database           | SQLite (file-based, `instance/progress.db`) | Zero setup, no extra service to pay for; fine for a small/free deployment |
| Frontend           | Vanilla HTML/CSS/JS                       | No build step, no npm — keeps the whole thing deployable as-is |
| Voice (speech-to-text) | **Web Speech API** — `SpeechRecognition` (browser-native) | 100% free, no API key, no signup, runs client-side, zero added latency/cost |
| Voice (text-to-speech) | **Web Speech API** — `SpeechSynthesis` (browser-native)  | Same as above — free and built into the browser |
| Server (prod)      | Gunicorn                                  | Render's recommended production WSGI server for Flask |
| Hosting            | Render (free web service)                 | Per your requirement |

### Free API options for voice (and why Web Speech API is the default)

| Option | Cost | Setup | Notes |
|---|---|---|---|
| **Web Speech API** (used here) | Free forever | None — built into the browser | No backend cost, no rate limits from you, but voice quality/accents depend on the OS/browser's own engine, and Chrome is the most reliable |
| **ElevenLabs** (TTS only) | Free tier (~10k chars/mo) | API key at elevenlabs.io | Much more natural/expressive voices; would need a small `/api/speak` backend route to call it and stream audio back — good upgrade path if voice *quality* matters more than $0 cost |
| **OpenAI Whisper API** (STT only) | Paid, no meaningful free tier | API key | Very accurate transcription, but not free — skipped for this build |
| **Google Cloud Speech-to-Text / Text-to-Speech** | Free tier (limited monthly minutes/characters) | Requires a Google Cloud project + billing account on file (even for free tier) | More setup friction than Web Speech API for similar quality |
| **Vosk** (offline, open-source STT) | Free, self-hosted | Runs a model on your server | True offline STT, but adds real server load/complexity — worth it only if you need voice recognition to work without any internet at all |

If you outgrow the built-in browser voices later, the cleanest upgrade is: keep
`SpeechRecognition` for listening (it's already free and good), and swap only
`SpeechSynthesis` for an ElevenLabs (or similar) backend call for nicer-sounding replies.

---

## 3. Project structure

```
curriculum-tutor/
├── app.py                     # Flask app: all routes + Grok calls + progress logic
├── requirements.txt
├── render.yaml                 # Render blueprint (optional, for one-click config)
├── .env.example                 # Copy to .env for local dev
├── .gitignore
├── data/
│   └── curriculum.json         # Your uploaded curriculum data
├── instance/
│   └── progress.db             # SQLite DB (auto-created on first run)
├── templates/
│   └── index.html              # Chat UI shell
├── static/
│   ├── style.css
│   └── script.js                # All frontend logic (progress, chat, quiz modal)
└── README.md
```

---

## 4. Running locally

```bash
cd curriculum-tutor
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# then edit .env and paste your GROK_API_KEY

python app.py
# visit http://localhost:5000
```

### Getting a free Grok API key
1. Go to **https://console.x.ai/** and sign up.
2. Create an API key under the API Keys section.
3. Check the **Models** page for the current free-tier model name — as of writing this
   project defaults to `grok-4-fast` in `.env.example`; update `GROK_MODEL` if x.ai renames
   or retires it. The app will error clearly in the chat window if the key or model is
   invalid, rather than crashing silently.

> ⚠️ **Free tier note:** Grok's free tier has rate limits and may reject rapid repeated
> requests (e.g., generating a quiz right after a lesson). If you see a 429/rate-limit
> error surfaced in the chat, wait a few seconds and retry. Consider lowering usage during
> testing (e.g., don't spam "Take Quiz").

---

## 5. Deploying to Render

You can deploy either via the `render.yaml` blueprint or manually:

### Option A — Blueprint (recommended)
1. Push this folder to a GitHub repo.
2. In Render, click **New → Blueprint**, point it at your repo. Render reads
   `render.yaml` and creates the web service automatically.
3. When prompted, paste your `GROK_API_KEY` (it's marked `sync: false` so Render will ask
   for it rather than committing it to the repo).
4. Deploy. Render runs `pip install -r requirements.txt` then
   `gunicorn app:app --bind 0.0.0.0:$PORT`.

### Option B — Manual web service
1. New → Web Service → connect your repo.
2. **Build command:** `pip install -r requirements.txt`
3. **Start command:** `gunicorn app:app --bind 0.0.0.0:$PORT`
4. **Environment variables:** add `GROK_API_KEY`, `GROK_BASE_URL`, `GROK_MODEL`,
   `PASS_THRESHOLD` (see `.env.example` for values).
5. **Persistent disk (important):** Render's filesystem is ephemeral — every deploy or
   restart wipes local files. Since progress is stored in SQLite at `instance/progress.db`,
   attach a **Render Disk** (Settings → Disks) mounted at
   `/opt/render/project/src/instance` (already configured in `render.yaml`) so student
   progress survives restarts/redeploys. Without this, progress resets on every deploy.

### Notes specific to Render + free tier
- Render's **free web services spin down after inactivity** and take ~30-60s to wake up
  on the next request — the first lesson/quiz request after idling may time out or feel
  slow. This is expected on the free plan.
- If you don't attach a persistent disk, treat this deployment as a demo — progress will
  reset whenever Render restarts the container.
- SQLite is fine for a single small instance but won't survive Render's free-tier
  container recycling *without* the disk, and doesn't scale across multiple instances if
  you later upgrade — swap in Postgres (Render offers a free Postgres tier too) if you
  outgrow this.

---

## 6. API reference (for extending the frontend later)

| Method | Endpoint              | Purpose |
|--------|------------------------|---------|
| GET    | `/api/curriculum`      | Raw curriculum JSON |
| GET    | `/api/progress?student_id=`      | Per-student progress across all tracks/modules |
| GET    | `/api/module/<id>`     | One module + student's progress row |
| POST   | `/api/teach`            | `{student_id, module_id}` → generates the lesson |
| POST   | `/api/ask`               | `{student_id, module_id, message}` → re-teach / answer a question |
| POST   | `/api/quiz/generate`     | `{student_id, module_id}` → 5-question quiz (JSON) |
| POST   | `/api/quiz/grade`        | `{student_id, module_id, quiz, answers}` → scores, feedback, unlocks next module if passed |
| GET    | `/api/history?student_id=&module_id=` | Chat log for review |

---

## 7. Customization ideas
- **Multiple named students / auth:** currently a `student_id` is just a random string in
  `localStorage`. Add a simple login (even just "enter your name") if you want named
  profiles instead of anonymous browser-based ones.
- **Adjust pass threshold** per module by extending the curriculum JSON with a per-module
  `pass_threshold` field and reading it in `api_quiz_grade`.
- **Swap curriculum**: replace `data/curriculum.json` with any file following the same
  `tracks → modules → topics` shape — nothing else needs to change.
- **Swap LLM providers**: since Grok is accessed through the OpenAI-compatible SDK, you
  can point `GROK_BASE_URL`/`GROK_MODEL`/`GROK_API_KEY` at any other OpenAI-compatible
  endpoint (OpenAI, Groq, local Ollama with an OpenAI shim, etc.) without touching the
  code — just the `.env` values.

---

## 8. Voice feature — nothing to configure

Because voice is entirely client-side (Web Speech API), there is **no new environment
variable, no new dependency in `requirements.txt`, and no backend route** for it — it
works locally and on Render exactly the same way, as soon as the student opens the app in
a supported browser and grants microphone permission when prompted.

> 🔒 **HTTPS requirement:** browsers only allow microphone access (`SpeechRecognition`) on
> secure origins. `localhost` is exempt for local dev, but once deployed, the mic will only
> work if the site is served over `https://` — Render's free web services are HTTPS by
> default, so this "just works" after deploy with no extra setup.

---

## 9. Known limitations / honest notes
- "Offline instructor" here means *self-paced, one-on-one, no live human instructor* —
  it still requires an internet connection to reach the Grok API for each lesson/quiz. A
  fully offline (no internet) version would require running a local open-source model
  (e.g., via Ollama) instead of Grok; the code is structured so that swap is just an env
  var change plus pointing `GROK_BASE_URL` at your local model server.
- Quiz short-answer grading quality depends on the LLM's judgment — it's lenient by
  design (see `GRADE_SYSTEM_PROMPT` in `app.py`) but isn't perfect; treat it as formative,
  not high-stakes, assessment.
- No authentication/security hardening included — fine for a personal/demo deployment,
  not for handling sensitive student data at scale.
