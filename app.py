"""
Curriculum Tutor Chatbot
------------------------
An offline-style AI instructor that teaches a learner every topic in a
curriculum JSON file, tracks progress in SQLite, and gates advancement
behind a passing quiz score. Uses Groq as the LLM backend with the openai/gpt-oss-120b model.

Run locally:
    python app.py

Deploy on Render: see README.md
"""

import os
import json
import sqlite3
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, render_template, g
from dotenv import load_dotenv
from groq import Groq
from googleapiclient.discovery import build

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "data" / "curriculum.json"
DB_PATH = BASE_DIR / "instance" / "progress.db"
DB_PATH.parent.mkdir(exist_ok=True)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")
PASS_THRESHOLD = float(os.getenv("PASS_THRESHOLD", "0.7"))  # 70% to pass a quiz

app = Flask(__name__)

client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

# Temporary server-side quiz storage.
# Keeps answer keys out of the browser.
QUIZ_CACHE = {}

# --------------------------------------------------------------------------
# Curriculum loading
# --------------------------------------------------------------------------

def load_curriculum():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


CURRICULUM = load_curriculum()


def flatten_modules():
    """Return a flat list of every module across every track, in order,
    each tagged with its track name and an overall sequence index."""
    flat = []
    seq = 0
    for track in CURRICULUM["tracks"]:
        for module in track["modules"]:
            seq += 1
            flat.append({
                "seq": seq,
                "track_name": track["track_name"],
                **module,
            })
    return flat


FLAT_MODULES = flatten_modules()
MODULES_BY_ID = {m["id"]: m for m in FLAT_MODULES}
def search_youtube_videos(query, max_results=3):
    """Search YouTube for practical learning videos."""
    if not YOUTUBE_API_KEY:
        raise RuntimeError("YOUTUBE_API_KEY is not set.")

    youtube = build(
        "youtube",
        "v3",
        developerKey=YOUTUBE_API_KEY
    )

    response = youtube.search().list(
        part="snippet",
        q=query,
        type="video",
        maxResults=max_results,
        order="relevance",
        safeSearch="strict",
    ).execute()

    videos = []

    for item in response.get("items", []):
        video_id = item["id"]["videoId"]
        snippet = item["snippet"]

        videos.append({
            "video_id": video_id,
            "title": snippet["title"],
            "description": snippet["description"],
            "channel": snippet["channelTitle"],
            "thumbnail": snippet["thumbnails"]["high"]["url"],
            "url": f"https://www.youtube.com/watch?v={video_id}",
        })

    return videos

# --------------------------------------------------------------------------
# Database (per-student progress) — SQLite, one row per module per student
# --------------------------------------------------------------------------

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS student_progress (
            student_id TEXT NOT NULL,
            module_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'locked', -- locked | in_progress | mastered
            best_score REAL DEFAULT 0,
            attempts INTEGER DEFAULT 0,
            last_updated TEXT,
            PRIMARY KEY (student_id, module_id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            module_id INTEGER,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def ensure_student_seeded(student_id: str):
    """Seed a student's progress rows the first time we see them.
    Pre-completed modules from the curriculum file (status 'completed')
    are seeded as mastered; the very next module is unlocked; the rest
    stay locked."""
    db = get_db()
    existing = db.execute(
        "SELECT COUNT(*) c FROM student_progress WHERE student_id = ?",
        (student_id,),
    ).fetchone()["c"]
    if existing > 0:
        # Repair progression for existing students.
        # If a module is already mastered, make sure the next
        # locked module is unlocked.
        rows = db.execute(
            """
            SELECT module_id, status
            FROM student_progress
            WHERE student_id=?
            ORDER BY module_id
            """,
            (student_id,),
        ).fetchall()

        mastered_ids = {
            row["module_id"]
            for row in rows
            if row["status"] == "mastered"
        }

        for m in FLAT_MODULES:
            if m["id"] not in mastered_ids:
                row = db.execute(
                    """
                    SELECT status
                    FROM student_progress
                    WHERE student_id=? AND module_id=?
                    """,
                    (student_id, m["id"]),
                ).fetchone()

                if row and row["status"] == "locked":
                    db.execute(
                        """
                        UPDATE student_progress
                        SET status='in_progress'
                        WHERE student_id=? AND module_id=?
                        """,
                        (student_id, m["id"]),
                    )
                    db.commit()

                break

        return

    now = datetime.utcnow().isoformat()
    first_unlockable_set = False
    for m in FLAT_MODULES:
        if m["status"] == "completed":
            status = "mastered"
            score = 1.0
        else:
            status = "locked"
            score = 0.0
        db.execute(
            "INSERT INTO student_progress (student_id, module_id, status, best_score, last_updated) "
            "VALUES (?, ?, ?, ?, ?)",
            (student_id, m["id"], status, score, now),
        )

    # Unlock the first non-mastered module
    for m in FLAT_MODULES:
        row = db.execute(
            "SELECT status FROM student_progress WHERE student_id=? AND module_id=?",
            (student_id, m["id"]),
        ).fetchone()
        if row["status"] == "locked":
            db.execute(
                "UPDATE student_progress SET status='in_progress' WHERE student_id=? AND module_id=?",
                (student_id, m["id"]),
            )
            first_unlockable_set = True
            break
    db.commit()
    return first_unlockable_set


def get_progress_row(student_id, module_id):
    db = get_db()
    return db.execute(
        "SELECT * FROM student_progress WHERE student_id=? AND module_id=?",
        (student_id, module_id),
    ).fetchone()


def unlock_next_module(student_id, module_id):
    """When a module is mastered, unlock the next locked module in sequence."""
    db = get_db()
    seq_list = [m["id"] for m in FLAT_MODULES]
    if module_id not in seq_list:
        return
    idx = seq_list.index(module_id)
    for next_id in seq_list[idx + 1:]:
        row = get_progress_row(student_id, next_id)
        if row and row["status"] == "locked":
            db.execute(
                "UPDATE student_progress SET status='in_progress' WHERE student_id=? AND module_id=?",
                (student_id, next_id),
            )
            db.commit()
        break


def log_chat(student_id, module_id, role, content):
    db = get_db()
    db.execute(
        "INSERT INTO chat_log (student_id, module_id, role, content, created_at) VALUES (?,?,?,?,?)",
        (student_id, module_id, role, content, datetime.utcnow().isoformat()),
    )
    db.commit()


# --------------------------------------------------------------------------
# Groq (LLM) helpers
# --------------------------------------------------------------------------

def call_groq(
    system_prompt: str,
    user_prompt: str,
    json_mode: bool = False,
    temperature: float = 0.5
):
    """
    Sends a system + user message to Groq using the
    openai/gpt-oss-120b model and returns the complete streamed response.
    The existing function name is kept so the rest of the app does not need
    to change.
    """
    if client is None:
        raise RuntimeError(
            "GROQ_API_KEY is not set. Add it to your .env file."
        )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    completion = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        temperature=temperature,
        max_completion_tokens=2048,
        top_p=1,
        reasoning_effort="medium",
        stream=True,
        stop=None,
    )

    chunks = []
    for chunk in completion:
        content = chunk.choices[0].delta.content or ""
        chunks.append(content)

    return "".join(chunks)


def parse_json_response(raw: str):
    """
    xai_sdk doesn't enforce a strict JSON response_format the way the
    OpenAI-compatible endpoint could, so the model occasionally wraps its
    JSON in ```json ... ``` fences despite being told not to. Strip those
    before parsing so quiz generation/grading doesn't break.
    """
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    return json.loads(cleaned.strip())


TEACH_SYSTEM_PROMPT = """
You are "Curra", a professional, patient, encouraging, and highly structured
data science instructor.

You are teaching a student inside a self-paced data science learning platform.

Your job is to teach ONLY the current module provided by the application.

The student should be able to read your response easily and understand the
concept without feeling overwhelmed.

IMPORTANT RESPONSE FORMAT:

Always use clean Markdown.

Do NOT write huge walls of text.

Do NOT use large Markdown tables for teaching.

Do NOT place Python or SQL code inside tables.

Use this exact structure:

# [Module Title]

## 1. Overview

Give a short, simple explanation of what this module is and why it matters
in data science.

## 2. Topics

Teach every topic in the order provided.

For each topic use:

### [Topic Name]

**What it means**

Explain the concept in simple language.

**Why it matters**

Explain why the concept is useful in data science.

**Example**

Give a small, practical example.

If code is useful, put it in a proper fenced code block.

For Python:

```python
# example
"""

REPLY_SYSTEM_PROMPT = """
You are "Curra", a professional, patient, and clear data science instructor.

A student is asking a follow-up question about the CURRENT MODULE.

Answer the student's question directly.

Use clean Markdown and make the answer easy to read.

Use this structure when appropriate:

## Short Answer

Answer the student's question directly in 1-3 sentences.

## Explanation

Explain the concept clearly using simple language.

## Example

Give a practical example that makes the concept easier to understand.

If code is useful, use a fenced code block.

For Python:

```python
# example
"""

QUIZ_SYSTEM_PROMPT = """You are a quiz generator for a data science curriculum. Given a module \
title and its topic list, generate a quiz that verifies real understanding. Return STRICT JSON \
only, matching this schema, no markdown fences, no commentary:

{
  "questions": [
    {
      "id": 1,
      "type": "multiple_choice",
      "prompt": "...",
      "options": ["A ...", "B ...", "C ...", "D ..."],
      "correct_option": "A",
      "explanation": "..."
    },
    {
      "id": 2,
      "type": "short_answer",
      "prompt": "...",
      "model_answer": "...",
      "explanation": "..."
    }
  ]
}

Generate exactly 5 questions: 3 multiple_choice and 2 short_answer, covering different topics \
from the module's topic list. Keep questions practical and specific to the topics given.
"""

GRADE_SYSTEM_PROMPT = """You are grading a student's short-answer response against a model \
answer for a data science quiz. Be lenient about phrasing but strict about correctness of the \
underlying concept. Return STRICT JSON only:

{"correct": true or false, "feedback": "one or two sentence explanation"}
"""


# --------------------------------------------------------------------------
# Routes — pages
# --------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# --------------------------------------------------------------------------
# Routes — curriculum & progress
# --------------------------------------------------------------------------

@app.route("/api/curriculum")
def api_curriculum():
    return jsonify(CURRICULUM)


@app.route("/api/progress")
def api_progress():
    student_id = request.args.get("student_id", "default")
    ensure_student_seeded(student_id)
    db = get_db()
    rows = db.execute(
        "SELECT * FROM student_progress WHERE student_id=? ORDER BY module_id",
        (student_id,),
    ).fetchall()
    progress = {r["module_id"]: dict(r) for r in rows}

    tracks_out = []
    for track in CURRICULUM["tracks"]:
        mods_out = []
        for m in track["modules"]:
            p = progress.get(m["id"], {})
            mods_out.append({
                "id": m["id"],
                "title": m["title"],
                "status": p.get("status", "locked"),
                "best_score": p.get("best_score", 0),
                "attempts": p.get("attempts", 0),
                "topics": m["topics"],
            })
        tracks_out.append({
            "track_name": track["track_name"],
            "modules": mods_out,
        })

    total = len(FLAT_MODULES)
    mastered = sum(1 for r in rows if r["status"] == "mastered")
    return jsonify({
        "student_id": student_id,
        "total_modules": total,
        "mastered_modules": mastered,
        "completion_percentage": round(100 * mastered / total, 1) if total else 0,
        "tracks": tracks_out,
    })


@app.route("/api/module/<int:module_id>")
def api_module(module_id):
    student_id = request.args.get("student_id", "default")
    ensure_student_seeded(student_id)
    module = MODULES_BY_ID.get(module_id)
    if not module:
        return jsonify({"error": "Module not found"}), 404
    row = get_progress_row(student_id, module_id)
    return jsonify({
        "module": module,
        "progress": dict(row) if row else None,
    })


# --------------------------------------------------------------------------
# Routes — teaching
# --------------------------------------------------------------------------
@app.route("/api/youtube")
def api_youtube():
    student_id = request.args.get("student_id", "default")
    module_id = request.args.get("module_id", type=int)

    if not module_id:
        return jsonify({
            "error": "module_id is required"
        }), 400

    ensure_student_seeded(student_id)

    module = MODULES_BY_ID.get(module_id)

    if not module:
        return jsonify({
            "error": "Module not found"
        }), 404

    row = get_progress_row(student_id, module_id)

    if row and row["status"] == "locked":
        return jsonify({
            "error": "This module is locked. Complete earlier modules first."
        }), 403

    # Build a focused search query from the module.
    query = f"{module['title']} tutorial"

    try:
        videos = search_youtube_videos(
            query,
            max_results=3
        )

        return jsonify({
            "module_id": module_id,
            "module_title": module["title"],
            "query": query,
            "videos": videos
        })

    except Exception as e:
        return jsonify({
            "error": str(e)
        }), 500
    
@app.route("/api/teach", methods=["POST"])
def api_teach():
    """Generate (or regenerate) the lesson for a module."""
    body = request.get_json(force=True)
    student_id = body.get("student_id", "default")
    module_id = int(body.get("module_id"))
    ensure_student_seeded(student_id)

    module = MODULES_BY_ID.get(module_id)
    if not module:
        return jsonify({"error": "Module not found"}), 404

    row = get_progress_row(student_id, module_id)
    if row and row["status"] == "locked":
        return jsonify({"error": "This module is locked. Complete earlier modules first."}), 403

    user_prompt = (
        f"Track: {module['track_name']}\n"
        f"Module {module['id']}: {module['title']}\n"
        f"Topics to cover: {', '.join(module['topics'])}\n\n"
        f"Teach this module now."
    )
    try:
        lesson = call_groq(TEACH_SYSTEM_PROMPT, user_prompt, temperature=0.4)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    log_chat(student_id, module_id, "assistant", lesson)

    db = get_db()
    db.execute(
        "UPDATE student_progress SET status='in_progress', last_updated=? "
        "WHERE student_id=? AND module_id=? AND status != 'mastered'",
        (datetime.utcnow().isoformat(), student_id, module_id),
    )
    db.commit()

    return jsonify({"lesson": lesson})


@app.route("/api/ask", methods=["POST"])
def api_ask():
    """Student asks a follow-up / re-teach question about the current module."""
    body = request.get_json(force=True)
    student_id = body.get("student_id", "default")
    module_id = int(body.get("module_id"))
    question = body.get("message", "").strip()
    ensure_student_seeded(student_id)

    module = MODULES_BY_ID.get(module_id)
    if not module or not question:
        return jsonify({"error": "Missing module or message"}), 400

    row = get_progress_row(student_id, module_id)

    if row and row["status"] == "locked":
        return jsonify({
            "error": "This module is locked. Complete earlier modules first."
        }), 403

    log_chat(student_id, module_id, "user", question)

    user_prompt = (
        f"Module {module['id']}: {module['title']}\n"
        f"Topics: {', '.join(module['topics'])}\n\n"
        f"Student's message: {question}"
    )
    try:
        reply = call_groq(REPLY_SYSTEM_PROMPT, user_prompt, temperature=0.5)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    log_chat(student_id, module_id, "assistant", reply)
    return jsonify({"reply": reply})


# --------------------------------------------------------------------------
# Routes — quiz
# --------------------------------------------------------------------------

@app.route("/api/quiz/generate", methods=["POST"])
def api_quiz_generate():
    body = request.get_json(force=True)

    student_id = body.get("student_id", "default")
    module_id = int(body.get("module_id"))

    ensure_student_seeded(student_id)

    module = MODULES_BY_ID.get(module_id)

    if not module:
        return jsonify({"error": "Module not found"}), 404

    # Do not allow quizzes for locked modules.
    row = get_progress_row(student_id, module_id)

    if row and row["status"] == "locked":
        return jsonify({
            "error": "This module is locked. Complete earlier modules first."
        }), 403

    user_prompt = (
        f"Module: {module['title']}\n"
        f"Topics: {', '.join(module['topics'])}"
    )

    try:
        raw = call_groq(
            QUIZ_SYSTEM_PROMPT,
            user_prompt,
            json_mode=True,
            temperature=0.6
        )

        quiz = parse_json_response(raw)

    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    except json.JSONDecodeError:
        return jsonify({
            "error": "Failed to parse quiz from model output"
        }), 500

    # Store the COMPLETE quiz, including answer keys,
    # on the server only.
    quiz_key = f"{student_id}:{module_id}"

    QUIZ_CACHE[quiz_key] = quiz

    # ---------------------------------------------------------------
    # Remove answer keys before sending anything to the browser.
    # ---------------------------------------------------------------

    safe_questions = []

    for q in quiz.get("questions", []):

        safe_question = {
            "id": q["id"],
            "type": q["type"],
            "prompt": q["prompt"],
        }

        if q["type"] == "multiple_choice":
            safe_question["options"] = q["options"]

        safe_questions.append(safe_question)

    return jsonify({
        "quiz": {
            "questions": safe_questions
        }
    })


@app.route("/api/quiz/grade", methods=["POST"])
def api_quiz_grade():
    body = request.get_json(force=True)

    student_id = body.get("student_id", "default")
    module_id = int(body.get("module_id"))
    answers = body.get("answers", {})

    quiz_key = f"{student_id}:{module_id}"

    # Retrieve the original quiz from server-side storage.
    quiz_data = QUIZ_CACHE.get(quiz_key)

    if not quiz_data:
        return jsonify({
            "error": "Quiz expired or could not be found. Please generate a new quiz."
        }), 400

    quiz = quiz_data.get("questions", [])

    if not quiz:
        return jsonify({
            "error": "Invalid quiz."
        }), 400

    results = []
    correct_count = 0

    for q in quiz:

        qid = str(q["id"])

        student_answer = str(
            answers.get(qid, "")
        ).strip()

        # -----------------------------------------------------------
        # Multiple choice
        # -----------------------------------------------------------

        if q["type"] == "multiple_choice":

            correct_option = q["correct_option"].strip().upper()

            is_correct = (
                student_answer.upper() == correct_option
            )

            feedback = q.get(
                "explanation",
                ""
            )

        # -----------------------------------------------------------
        # Short answer
        # -----------------------------------------------------------

        else:

            try:

                raw = call_groq(
                    GRADE_SYSTEM_PROMPT,

                    (
                        f"Question: {q['prompt']}\n"
                        f"Model answer: {q['model_answer']}\n"
                        f"Student answer: {student_answer}"
                    ),

                    json_mode=True,
                    temperature=0.2
                )

                graded = parse_json_response(raw)

                is_correct = bool(
                    graded.get("correct")
                )

                feedback = graded.get(
                    "feedback",
                    q.get("explanation", "")
                )

            except Exception as e:

                print("Short-answer grading error:", e)

                is_correct = False

                feedback = (
                    "Could not auto-grade this answer; "
                    "please review with your instructor."
                )

        if is_correct:
            correct_count += 1

        results.append({
            "id": q["id"],
            "prompt": q["prompt"],
            "correct": is_correct,
            "feedback": feedback,
        })

    # ---------------------------------------------------------------
    # Calculate score
    # ---------------------------------------------------------------

    score = (
        correct_count / len(quiz)
        if quiz
        else 0
    )

    passed = score >= PASS_THRESHOLD

    # ---------------------------------------------------------------
    # Update student progress
    # ---------------------------------------------------------------

    ensure_student_seeded(student_id)

    db = get_db()

    row = get_progress_row(
        student_id,
        module_id
    )

    best_score = max(
        score,
        row["best_score"] if row else 0
    )

    attempts = (
        row["attempts"] if row else 0
    ) + 1

    new_status = (
        "mastered"
        if passed
        else "in_progress"
    )

    db.execute(
        """
        UPDATE student_progress
        SET status=?,
            best_score=?,
            attempts=?,
            last_updated=?
        WHERE student_id=?
          AND module_id=?
        """,
        (
            new_status,
            best_score,
            attempts,
            datetime.utcnow().isoformat(),
            student_id,
            module_id,
        ),
    )

    db.commit()

    # ---------------------------------------------------------------
    # Unlock next module after passing
    # ---------------------------------------------------------------

    if passed:
        unlock_next_module(
            student_id,
            module_id
        )

    # Quiz has now been graded.
    # Remove it from temporary server memory.
    QUIZ_CACHE.pop(
        quiz_key,
        None
    )

    return jsonify({
        "score": round(score, 2),
        "passed": passed,
        "threshold": PASS_THRESHOLD,
        "results": results,
        "new_status": new_status,
    })

@app.route("/api/history")
def api_history():
    student_id = request.args.get("student_id", "default")
    module_id = request.args.get("module_id", type=int)
    db = get_db()
    if module_id:
        rows = db.execute(
            "SELECT role, content, created_at FROM chat_log WHERE student_id=? AND module_id=? ORDER BY id",
            (student_id, module_id),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT role, content, created_at, module_id FROM chat_log WHERE student_id=? ORDER BY id",
            (student_id,),
        ).fetchall()
    return jsonify([dict(r) for r in rows])


with app.app_context():
    init_db()


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=os.getenv("FLASK_DEBUG", "0") == "1")