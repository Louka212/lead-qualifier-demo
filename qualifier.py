"""Conversational AI lead-qualifier — the brain behind the embeddable chat widget.

Engages a website visitor, asks 3-5 qualifying questions (what they need, budget,
timeline, contact), and when it has enough signal calls the `capture_lead` tool to
score + route the lead (book a call / email follow-up / nurture).

Two modes:
- **Live** (ANTHROPIC_API_KEY set): Claude Haiku 4.5 drives the conversation with tool-use.
- **Scripted fallback** (no key): a deterministic 4-question state machine. Keeps the
  demo fully working — and zero-cost — before a key is wired up, and caps public abuse.

Single-tenant demo. Each client would get their own BUSINESS config + booking link.
"""
from __future__ import annotations

import json
import os
import re

MODEL = os.environ.get("QUALIFIER_MODEL", "claude-haiku-4-5-20251001")

# The demo "host" business. Each client customizes this block.
BUSINESS = {
    "name": "Northbeam Studio",
    "tagline": "websites, apps & automation for growing brands",
    "booking_url": os.environ.get("BOOKING_URL", "https://calendly.com/loukabuilds/intro"),
    # what this business sells — shapes the qualifying questions
    "offerings": ["website design", "web apps", "AI automation", "SEO"],
    "qualified_min_budget": 1000,  # USD; below this → nurture, not a booked call
}

CAPTURE_TOOL = {
    "name": "capture_lead",
    "description": (
        "Record the qualified (or unqualified) lead once you have enough signal. "
        "Call this after you've learned what they need, a rough budget, a timeline, "
        "and a name + contact — OR when the visitor clearly won't share more. "
        "Do not call it on the very first message."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Visitor's name, or 'Unknown'."},
            "contact": {"type": "string", "description": "Email or phone, or 'Not provided'."},
            "project_type": {"type": "string", "description": "What they want built/done, in a few words."},
            "budget": {"type": "string", "description": "Rough budget as they stated it (e.g. '$2-3k', 'not sure')."},
            "timeline": {"type": "string", "description": "When they want it done (e.g. 'this month', 'no rush')."},
            "qualified": {"type": "boolean", "description": "True if a realistic fit (clear need + viable budget/timeline)."},
            "score": {"type": "integer", "description": "Lead quality 0-100 (need + budget + timeline + contact completeness)."},
            "recommended_action": {
                "type": "string",
                "enum": ["book_call", "email_followup", "nurture"],
                "description": "book_call for hot qualified leads; email_followup for warm; nurture for low-intent.",
            },
            "summary": {"type": "string", "description": "One sentence the business owner reads to decide whether to prioritize."},
        },
        "required": ["name", "contact", "project_type", "budget", "timeline",
                     "qualified", "score", "recommended_action", "summary"],
    },
}


def _system_prompt(business: dict) -> str:
    return (
        f"You are the friendly AI assistant on {business['name']}'s website "
        f"({business['name']} does {business['tagline']}). Your job is to engage a visitor, "
        f"understand what they need, and qualify them as a potential client.\n\n"
        "Learn these four things, ONE question at a time:\n"
        "1. What they're looking to build or get help with\n"
        "2. A rough budget\n"
        "3. Their timeline\n"
        "4. Their name and best contact (email)\n\n"
        "Rules:\n"
        "- Warm, concise, human. 1-2 sentences per reply. Never a wall of text.\n"
        "- Ask ONE question at a time. Don't interrogate — 3 to 5 questions total, max.\n"
        "- Acknowledge what they said before asking the next thing.\n"
        "- If they're just browsing or won't share, stay helpful and don't push.\n"
        f"- Once you have the four things (or they clearly won't share more), call capture_lead. "
        f"Treat budgets at or above ${business['qualified_min_budget']} with a clear need as qualified.\n"
        "- Never invent details the visitor didn't give. Use 'Unknown' / 'Not provided' where needed.\n"
        "- Do not call capture_lead on the first message."
    )


# ----------------------------- live (Claude) -----------------------------

def _run_claude(messages: list[dict], business: dict) -> dict:
    import anthropic

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=400,
        system=[{"type": "text", "text": _system_prompt(business),
                 "cache_control": {"type": "ephemeral"}}],
        tools=[CAPTURE_TOOL],
        messages=messages,
    )

    text = next((b.text for b in resp.content if b.type == "text"), None)
    tool = next((b for b in resp.content if b.type == "tool_use"), None)

    if tool is not None:
        lead = dict(tool.input)
        reply = text or _closing_message(lead, business)
        return {"reply": reply, "done": True, "lead": lead}
    return {"reply": text or "Could you tell me a bit more about what you need?",
            "done": False, "lead": None}


# ----------------------------- scripted fallback -----------------------------

_STEPS = [
    ("project_type", "Happy to help! What are you looking to build or get done?"),
    ("budget", "Got it. Do you have a rough budget in mind for this?"),
    ("timeline", "Makes sense. What's your ideal timeline?"),
    ("contact", "Last thing — what's your name and the best email to reach you?"),
]


def _scripted(messages: list[dict], business: dict) -> dict:
    """Deterministic state machine: count prior user turns to know which Q is next."""
    user_turns = [m for m in messages if m["role"] == "user"]
    answered = len(user_turns) - 1  # the latest user msg answers step `answered`

    if answered < 0:  # opening
        return {"reply": _STEPS[0][1], "done": False, "lead": None}

    if answered < len(_STEPS) - 1:
        return {"reply": _STEPS[answered + 1][1], "done": False, "lead": None}

    # All four answered → assemble a lead from the transcript.
    # The greeting is shown client-side (display-only), so the first USER message is
    # already the project answer: answers = [project, budget, timeline, contact].
    answers = [m["content"] if isinstance(m["content"], str) else "" for m in user_turns]
    project_type = answers[0] if len(answers) > 0 else "Unknown"
    budget = answers[1] if len(answers) > 1 else "not sure"
    timeline = answers[2] if len(answers) > 2 else "unspecified"
    contact_raw = answers[3] if len(answers) > 3 else ""
    email = (re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", contact_raw) or [None])
    email = email.group(0) if hasattr(email, "group") else "Not provided"
    name = re.sub(r"[\w.+-]+@[\w-]+\.[\w.-]+", "", contact_raw).strip(" ,-") or "Unknown"

    budget_num = _budget_to_number(budget)
    qualified = budget_num is None or budget_num >= business["qualified_min_budget"]
    score = 50
    if budget_num and budget_num >= business["qualified_min_budget"]:
        score += 25
    if email != "Not provided":
        score += 20
    if timeline and "no rush" not in timeline.lower():
        score += 5
    score = min(score, 100)

    lead = {
        "name": name, "contact": email, "project_type": project_type,
        "budget": budget, "timeline": timeline, "qualified": qualified,
        "score": score,
        "recommended_action": "book_call" if qualified and email != "Not provided"
        else ("email_followup" if email != "Not provided" else "nurture"),
        "summary": f"{name} wants {project_type} (budget {budget}, timeline {timeline}).",
    }
    return {"reply": _closing_message(lead, business), "done": True, "lead": lead}


def _budget_to_number(text: str) -> int | None:
    if not text:
        return None
    t = text.lower().replace(",", "")
    m = re.search(r"\$?\s*(\d+(?:\.\d+)?)\s*([km])?", t)
    if not m:
        return None
    val = float(m.group(1))
    if m.group(2) == "k":
        val *= 1_000
    elif m.group(2) == "m":
        val *= 1_000_000
    return int(val)


def _closing_message(lead: dict, business: dict) -> str:
    name = lead.get("name") or ""
    first = name.split()[0] if name and name != "Unknown" else "there"
    if lead.get("recommended_action") == "book_call":
        return (f"Perfect, {first} — this sounds like a great fit. Grab a time that works "
                f"and {business['name']} will walk you through it: {business['booking_url']}")
    if lead.get("recommended_action") == "email_followup":
        return (f"Thanks, {first}! I've passed your details to the team — "
                f"someone will follow up by email shortly. Anything else I can note?")
    return (f"Thanks for stopping by, {first}. I've saved your info and we'll be in touch "
            f"when the timing's right. Feel free to look around!")


# ----------------------------- public API -----------------------------

def run_turn(messages: list[dict], business: dict | None = None) -> dict:
    """Advance the conversation one turn.

    `messages` is the running history: [{"role": "user"|"assistant", "content": str}, ...].
    Returns {"reply": str, "done": bool, "lead": dict | None}.
    """
    business = business or BUSINESS
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            return _run_claude(messages, business)
        except Exception:
            # Never let an API hiccup break the demo — fall back to scripted.
            return _scripted(messages, business)
    return _scripted(messages, business)


def has_api_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))
