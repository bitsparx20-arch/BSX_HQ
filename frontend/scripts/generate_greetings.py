#!/usr/bin/env python3
"""Generate greetings.js with 365 unique quotes per role."""

import itertools
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "lib" / "greetings.js"

SEEDS = {
    "ceo": {
        "verbs": ["Lead", "Build", "Scale", "Drive", "Own", "Shape", "Command", "Fuel", "Ignite", "Steer", "Chart", "Pioneer", "Elevate", "Amplify", "Orchestrate", "Cultivate", "Champion", "Direct", "Launch", "Transform"],
        "nouns": ["vision", "momentum", "culture", "strategy", "execution", "clarity", "impact", "growth", "excellence", "ambition", "focus", "discipline", "courage", "innovation", "legacy", "standards", "results", "teams", "markets", "opportunity"],
        "phrases": [
            "Think big. Act now.",
            "Decide fast. Deliver faster.",
            "Less noise. More impact.",
            "Win the morning, win the week.",
            "Pressure makes diamonds.",
            "Be the standard.",
            "Own the room. Own the day.",
            "Your energy is the culture.",
            "Bold calls build empires.",
            "Strategy beats hustle.",
            "Clarity is your superpower.",
            "Run the day — don't chase it.",
            "One sharp call changes everything.",
            "Big picture. Sharp execution.",
            "Trust your gut. Verify with data.",
            "Scale ideas, not chaos.",
            "Outwork the doubt.",
            "Today's focus = tomorrow's edge.",
            "Make today count twice.",
            "Stay hungry. Stay sharp.",
            "Lead with intent, not noise.",
            "Turn ambition into momentum.",
            "Excellence starts at the top.",
            "The bar rises with you.",
            "Build what others won't.",
            "Vision today, wins tomorrow.",
            "Your move sets the pace.",
            "Lead loud. Ship faster.",
            "Command calm. Move fast.",
            "Start strong. Stay stronger.",
        ],
        "templates": [
            "{v} the {n}.",
            "{v} with {n}.",
            "Today's {n}, tomorrow's win.",
            "{n} starts at the top.",
            "Set the {n}. Set the tone.",
            "Your {n} moves the room.",
            "Lead through {n}.",
            "Chase {n}, not chaos.",
            "{n} is the strategy.",
            "Ship with {n}.",
        ],
    },
    "manager": {
        "verbs": ["Rally", "Guide", "Unblock", "Coach", "Align", "Shield", "Boost", "Clear", "Support", "Empower", "Motivate", "Streamline", "Celebrate", "Protect", "Enable", "Inspire", "Organize", "Prioritize", "Delegate", "Listen"],
        "nouns": ["team", "sprint", "focus", "pace", "clarity", "trust", "rhythm", "progress", "morale", "goals", "blockers", "wins", "energy", "momentum", "standards", "check-ins", "delivery", "collaboration", "feedback", "execution"],
        "phrases": [
            "Unblock one person, win the day.",
            "Your team feels your vibe.",
            "Guide. Don't micromanage.",
            "Clear path, fast sprint.",
            "Rally the crew. Ship it.",
            "Small wins stack big.",
            "Listen first. Lead second.",
            "Be the glue today.",
            "Progress over perfection.",
            "Remove friction. Add fuel.",
            "Ship before sunset.",
            "Be the answer, not the bottleneck.",
            "One clear goal beats ten vague ones.",
            "Team energy starts with you.",
            "Make work feel winnable.",
            "Praise in public. Fix in private.",
            "Stay sharp. Stay kind.",
            "Lead from the trenches.",
            "Today: unblock, align, deliver.",
            "Your calm is contagious.",
            "Celebrate the grind.",
            "Coach in the moment.",
            "Plans are nothing without pace.",
            "Earn trust in small moments.",
            "Protect focus. Kill distractions.",
            "Show up loud for your team.",
            "Turn chaos into a checklist.",
            "Momentum loves a manager.",
            "Your 1:1s move mountains.",
            "Make the hard call early.",
        ],
        "templates": [
            "{v} the {n}.",
            "{v} with {n}.",
            "Today's {n}, team's win.",
            "Build {n} daily.",
            "Your {n} lifts everyone.",
            "Lead through {n}.",
            "Chase {n}, not drama.",
            "{n} beats busywork.",
            "Ship with {n}.",
            "Protect the {n}.",
        ],
    },
    "employee": {
        "verbs": ["Show", "Crush", "Own", "Finish", "Start", "Keep", "Push", "Build", "Learn", "Deliver", "Focus", "Grind", "Rise", "Tackle", "Nail", "Spark", "Move", "Create", "Solve", "Win"],
        "nouns": ["focus", "momentum", "progress", "tasks", "goals", "effort", "craft", "hustle", "discipline", "curiosity", "results", "streak", "energy", "details", "deadlines", "growth", "pride", "pace", "impact", "grind"],
        "phrases": [
            "Show up. Stand out.",
            "One task closer to done.",
            "Focus beats frenzy.",
            "Small steps. Big payoff.",
            "You've got this — prove it.",
            "Checked in? Already winning.",
            "Do the work. Own the result.",
            "Progress > perfect.",
            "Make today your best rep.",
            "Deep breath. Deep work.",
            "Finish what you start.",
            "Hustle with heart.",
            "Crush the next task.",
            "Stay curious. Stay sharp.",
            "Done is better than perfect.",
            "Bring the energy.",
            "Quiet grind, loud results.",
            "One win at a time.",
            "No zero days.",
            "Work smart. Win daily.",
            "Rise. Grind. Repeat.",
            "Today is yours to shape.",
            "Outdo yesterday's you.",
            "Be the teammate you'd want.",
            "Turn effort into excellence.",
            "Start messy. Finish strong.",
            "Your focus fuels the team.",
            "Make it count today.",
            "Learn something. Ship something.",
            "Keep the streak alive.",
        ],
        "templates": [
            "{v} the {n}.",
            "{v} with {n}.",
            "Today's {n}, tomorrow's edge.",
            "Chase {n}, not excuses.",
            "Your {n} matters.",
            "Win with {n}.",
            "Stack small {n}.",
            "Lead with {n}.",
            "{n} compounds daily.",
            "Ship your {n}.",
        ],
    },
}


def generate_quotes(role: str, count: int = 365) -> list[str]:
    cfg = SEEDS[role]
    seen = set()
    quotes = []

    for p in cfg["phrases"]:
        if p not in seen:
            seen.add(p)
            quotes.append(p)

    for tpl, verb, noun in itertools.product(cfg["templates"], cfg["verbs"], cfg["nouns"]):
        q = tpl.format(v=verb, n=noun)
        if q not in seen:
            seen.add(q)
            quotes.append(q)
        if len(quotes) >= count:
            break

    # Day-number flavored fallbacks if somehow short
    i = 1
    while len(quotes) < count:
        q = f"Day {i}: make it legendary."
        if role == "ceo":
            q = f"Day {i}: lead with purpose."
        elif role == "manager":
            q = f"Day {i}: lift the team."
        else:
            q = f"Day {i}: own your momentum."
        if q not in seen:
            seen.add(q)
            quotes.append(q)
        i += 1

    return quotes[:count]


def main():
    data = {role: generate_quotes(role, 365) for role in ("ceo", "manager", "employee")}

    lines = [
        "/** 365 unique quotes per role — one per calendar day (day-of-year index). */",
        "const DAILY_QUOTES = {",
    ]
    for role, quotes in data.items():
        lines.append(f"  {role}: [")
        for q in quotes:
            lines.append(f'    {json.dumps(q)},')
        lines.append("  ],")
    lines.append("};")
    lines.extend([
        "",
        "function dayOfYear(date) {",
        "  const start = new Date(date.getFullYear(), 0, 0);",
        "  return Math.floor((date - start) / 86_400_000);",
        "}",
        "",
        "function getTimeLabel(hour) {",
        '  if (hour >= 5 && hour < 12) return "Good morning";',
        '  if (hour >= 12 && hour < 17) return "Good afternoon";',
        '  if (hour >= 17 && hour < 22) return "Good evening";',
        '  return "Good night";',
        "}",
        "",
        "function roleKey(role) {",
        '  if (role === "admin") return "ceo";',
        '  if (role === "manager") return "manager";',
        '  return "employee";',
        "}",
        "",
        "/** One unique quote per calendar day (1–365), per role. */",
        "export function getHeaderGreeting(user) {",
        "  const now = new Date();",
        "  const key = roleKey(user?.role);",
        "  const quotes = DAILY_QUOTES[key] || DAILY_QUOTES.employee;",
        "  const idx = (dayOfYear(now) - 1) % quotes.length;",
        '  const firstName = (user?.name || "there").split(/\\s+/)[0];',
        "",
        "  return {",
        "    label: getTimeLabel(now.getHours()),",
        "    quote: quotes[idx],",
        "    firstName,",
        "  };",
        "}",
        "",
    ])

    OUT.write_text("\n".join(lines), encoding="utf-8")
    for role, quotes in data.items():
        assert len(quotes) == 365, role
        assert len(set(quotes)) == 365, f"duplicates in {role}"
    print(f"Wrote {OUT} — 365 quotes × 3 roles")


if __name__ == "__main__":
    main()
