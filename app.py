"""AI Lead-Qualifier Chatbot — demo Flask app.

A single <script> tag drops an AI chat widget onto any website. The widget engages
visitors, qualifies them (need / budget / timeline / contact), scores the lead, and
routes it (book a call / email follow-up / nurture). Qualified leads optionally fire
a Slack webhook so the owner hears about a hot lead in seconds.

Proactive (greets visitors) vs the service-booker demo's reactive (handles requests).

Run:
    pip install -r requirements.txt
    python app.py
Then open http://localhost:5000  (chat bubble is bottom-right).
"""
from __future__ import annotations

import json
import os
import secrets
import urllib.request
from datetime import datetime
from pathlib import Path

from flask import Flask, Response, jsonify, render_template, request

import qualifier

APP_ROOT = Path(__file__).parent
LEADS_FILE = APP_ROOT / "leads.json"
MAX_MESSAGES = 24  # hard cap on conversation length (abuse / cost guard)
MAX_MSG_LEN = 1000

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024


# ----------------------------- storage -----------------------------

def _load_leads() -> list[dict]:
    if not LEADS_FILE.exists():
        return []
    try:
        return json.loads(LEADS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def _save_lead(lead: dict, transcript: list[dict]) -> dict:
    record = {
        "id": secrets.token_hex(6),
        "created_at": datetime.now().isoformat(timespec="seconds"),
        **lead,
        "transcript": transcript,
    }
    items = _load_leads()
    items.append(record)
    LEADS_FILE.write_text(json.dumps(items, indent=2), encoding="utf-8")
    return record


def _notify_slack(lead: dict) -> None:
    """Fire-and-forget Slack ping when a lead is captured. No-op if unconfigured."""
    webhook = os.environ.get("SLACK_WEBHOOK_URL")
    if not webhook:
        return
    emoji = {"book_call": "🔥", "email_followup": "📧", "nurture": "🌱"}.get(
        lead.get("recommended_action"), "•")
    text = (f"{emoji} *New lead — score {lead.get('score')}/100* "
            f"({lead.get('recommended_action')})\n"
            f"*{lead.get('name')}* · {lead.get('contact')}\n"
            f"{lead.get('summary')}")
    try:
        req = urllib.request.Request(
            webhook, data=json.dumps({"text": text}).encode("utf-8"),
            headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # never let notification failure break the visitor's experience


# ----------------------------- routes -----------------------------

@app.route("/")
def index():
    return render_template("index.html", business=qualifier.BUSINESS)


@app.route("/widget.js")
def widget_js():
    # Served from the route (not /static) so the embed snippet is a clean single line.
    js = (APP_ROOT / "static" / "widget.js").read_text(encoding="utf-8")
    return Response(js, mimetype="application/javascript")


@app.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.get_json(silent=True) or {}
    messages = data.get("messages")
    if not isinstance(messages, list) or not messages:
        return jsonify({"error": "messages[] required"}), 400
    if len(messages) > MAX_MESSAGES:
        return jsonify({"reply": "Thanks! Let's continue this over a quick call — "
                                 f"{qualifier.BUSINESS['booking_url']}", "done": True}), 200

    # sanitize: only role/content strings, clip length
    clean: list[dict] = []
    for m in messages:
        role = m.get("role")
        content = m.get("content")
        if role in ("user", "assistant") and isinstance(content, str):
            clean.append({"role": role, "content": content[:MAX_MSG_LEN]})
    if not clean or clean[-1]["role"] != "user":
        return jsonify({"error": "last message must be from user"}), 400

    result = qualifier.run_turn(clean)

    if result.get("done") and result.get("lead"):
        record = _save_lead(result["lead"], clean)
        _notify_slack(result["lead"])
        return jsonify({
            "reply": result["reply"],
            "done": True,
            "lead_captured": True,
            "recommended_action": result["lead"].get("recommended_action"),
            "booking_url": qualifier.BUSINESS["booking_url"]
            if result["lead"].get("recommended_action") == "book_call" else None,
        })

    return jsonify({"reply": result["reply"], "done": False, "lead_captured": False})


@app.route("/admin")
def admin():
    leads = sorted(_load_leads(), key=lambda l: l.get("score", 0), reverse=True)
    stats = {
        "total": len(leads),
        "qualified": sum(1 for l in leads if l.get("qualified")),
        "book_call": sum(1 for l in leads if l.get("recommended_action") == "book_call"),
    }
    return render_template("admin.html", leads=leads, stats=stats,
                           business=qualifier.BUSINESS)


@app.route("/healthz")
def healthz():
    return {"ok": True, "has_api_key": qualifier.has_api_key(),
            "mode": "claude" if qualifier.has_api_key() else "scripted",
            "leads": len(_load_leads())}


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    app.run(host=host, port=port, debug=True)
