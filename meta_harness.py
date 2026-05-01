#!/usr/bin/env python3
"""Minimal Markdown-first workflow harness."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


HARNESS_DIR = Path(".meta-harness")
RUNS_DIR = HARNESS_DIR / "runs"
CURRENT_RUN_FILE = HARNESS_DIR / "current-run"


@dataclass(frozen=True)
class Run:
    run_id: str
    path: Path

    @property
    def events_path(self) -> Path:
        return self.path / "events.jsonl"

    @property
    def status_path(self) -> Path:
        return self.path / "status.md"

    @property
    def lookback_path(self) -> Path:
        return self.path / "lookback.md"


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def run_stamp() -> str:
    return datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")


def slugify(value: str, limit: int = 48) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return (slug[:limit].strip("-") or "run")


def ensure_harness_dirs() -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)


def load_events(run: Run) -> list[dict[str, Any]]:
    if not run.events_path.exists():
        return []

    events: list[dict[str, Any]] = []
    for line_number, line in enumerate(run.events_path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Invalid JSON in {run.events_path} line {line_number}: {exc}") from exc
    return events


def append_event(run: Run, event: dict[str, Any]) -> None:
    with run.events_path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(event, ensure_ascii=True, sort_keys=True) + "\n")


def current_run_id() -> str | None:
    if CURRENT_RUN_FILE.exists():
        value = CURRENT_RUN_FILE.read_text(encoding="utf-8").strip()
        return value or None
    return None


def resolve_run(run_id: str | None) -> Run:
    selected = run_id or current_run_id()
    if not selected:
        raise SystemExit("No run selected. Use `init` first or pass `--run <run-id>`.")

    path = RUNS_DIR / selected
    if not path.exists():
        raise SystemExit(f"Run not found: {selected}")
    return Run(selected, path)


def markdown_list(items: list[str]) -> str:
    if not items:
        return "- none"
    return "\n".join(f"- {item}" for item in items)


def latest_nonempty(events: list[dict[str, Any]], key: str, fallback: str = "none") -> str:
    for event in reversed(events):
        value = event.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def render_status(run: Run) -> str:
    events = load_events(run)
    init_event = events[0] if events else {}
    latest = events[-1] if events else {}

    decisions = [
        f"{event['decision']} ({event.get('timestamp', 'unknown time')})"
        for event in events
        if event.get("decision")
    ]
    conclusions = [
        f"{event['conclusion']} ({event.get('impact', 'impact not stated')})"
        for event in events
        if event.get("conclusion")
    ]
    artifacts = sorted(
        {
            artifact
            for event in events
            for artifact in ([event.get("artifact")] if event.get("artifact") else [])
        }
    )
    blockers = [event["blocker"] for event in events if event.get("blocker")]

    return f"""# Status

Run: {run.run_id}
Mode: {init_event.get("mode", latest.get("mode", "solo"))}
Phase: {latest.get("phase", "intake")}
Owner: {latest.get("owner", init_event.get("owner", "unassigned"))}
Updated: {now_iso()}

## Goal

{init_event.get("goal", "No goal recorded.")}

## Current Truth

- Latest action: {latest.get("action", "none")}
- Latest result: {latest.get("result", "none")}
- Latest verification: {latest.get("verification", "not recorded")}

## Active Work

- {latest_nonempty(events, "active_work", "none")}

## Background Work

- {latest_nonempty(events, "background_work", "none")}

## Decisions

{markdown_list(decisions)}

## New Or Revised Conclusions

{markdown_list(conclusions)}

## Artifacts

{markdown_list(artifacts)}

## Blockers

{markdown_list(blockers)}

## Next Action

{latest.get("next_action", "Select the next action.")}

## Stop Criteria

{init_event.get("stop_criteria", "Not recorded.")}
"""


def render_lookback(run: Run) -> str:
    events = load_events(run)
    init_event = events[0] if events else {}

    lines = [
        "# Lookback",
        "",
        f"Run: {run.run_id}",
        f"Generated: {now_iso()}",
        "",
        "## Original Goal",
        "",
        init_event.get("goal", "No goal recorded."),
        "",
        "## Timeline",
        "",
    ]

    if not events:
        lines.append("- No events recorded.")
    else:
        for event in events:
            detail = event.get("result") or event.get("verification") or "no result recorded"
            lines.append(
                f"- {event.get('timestamp', 'unknown time')} | "
                f"{event.get('phase', 'unknown phase')} | "
                f"{event.get('actor', 'unknown actor')}: "
                f"{event.get('action', 'no action recorded')} -> {detail}"
            )

    decisions = [event for event in events if event.get("decision")]
    conclusions = [event for event in events if event.get("conclusion")]
    blockers = [event for event in events if event.get("blocker")]

    lines.extend(["", "## Decisions", ""])
    lines.extend(
        [f"- {event.get('timestamp', 'unknown time')}: {event['decision']}" for event in decisions]
        or ["- none"]
    )

    lines.extend(["", "## Conclusion Changes", ""])
    lines.extend(
        [
            f"- {event.get('timestamp', 'unknown time')}: {event['conclusion']} "
            f"({event.get('impact', 'impact not stated')})"
            for event in conclusions
        ]
        or ["- none"]
    )

    lines.extend(["", "## Remaining Blockers", ""])
    lines.extend(
        [f"- {event.get('timestamp', 'unknown time')}: {event['blocker']}" for event in blockers]
        or ["- none"]
    )

    lines.extend(["", "## Current Next Action", "", latest_nonempty(events, "next_action", "Select the next action.")])

    return "\n".join(lines) + "\n"


def write_status(run: Run) -> str:
    status = render_status(run)
    run.status_path.write_text(status, encoding="utf-8")
    return status


def command_init(args: argparse.Namespace) -> int:
    ensure_harness_dirs()

    run_id = args.run_id or f"{run_stamp()}-{slugify(args.goal)}"
    run_path = RUNS_DIR / run_id
    if run_path.exists():
        raise SystemExit(f"Run already exists: {run_id}")

    for directory in ("artifacts", "background"):
        (run_path / directory).mkdir(parents=True, exist_ok=True)

    run = Run(run_id, run_path)
    (run_path / "decisions.md").write_text("# Decisions\n\n- none\n", encoding="utf-8")
    (run_path / "handoff.md").write_text("# Handoff\n\nNo handoff written yet.\n", encoding="utf-8")

    append_event(
        run,
        {
            "timestamp": now_iso(),
            "actor": args.actor,
            "owner": args.owner,
            "mode": args.mode,
            "phase": "intake",
            "action": "initialized run",
            "goal": args.goal,
            "result": "run directory created",
            "verification": "status and event ledger initialized",
            "next_action": args.next_action,
            "stop_criteria": args.stop_criteria,
        },
    )
    write_status(run)
    CURRENT_RUN_FILE.write_text(run_id + "\n", encoding="utf-8")

    print(f"Initialized run: {run_id}")
    print(run.status_path)
    return 0


def command_event(args: argparse.Namespace) -> int:
    run = resolve_run(args.run)
    event = {
        "timestamp": now_iso(),
        "actor": args.actor,
        "owner": args.owner,
        "phase": args.phase,
        "action": args.action,
        "result": args.result,
        "verification": args.verification,
        "artifact": args.artifact,
        "decision": args.decision,
        "conclusion": args.conclusion,
        "impact": args.impact,
        "blocker": args.blocker,
        "active_work": args.active_work,
        "background_work": args.background_work,
        "next_action": args.next_action,
    }
    append_event(run, {key: value for key, value in event.items() if value})
    write_status(run)

    print(f"Recorded event for run: {run.run_id}")
    print(run.status_path)
    return 0


def command_status(args: argparse.Namespace) -> int:
    run = resolve_run(args.run)
    status = write_status(run) if args.refresh else run.status_path.read_text(encoding="utf-8")
    print(status, end="" if status.endswith("\n") else "\n")
    return 0


def command_lookback(args: argparse.Namespace) -> int:
    run = resolve_run(args.run)
    lookback = render_lookback(run)
    if args.write:
        run.lookback_path.write_text(lookback, encoding="utf-8")
        print(f"Wrote {run.lookback_path}")
    print(lookback, end="" if lookback.endswith("\n") else "\n")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Markdown-first workflow harness.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init = subparsers.add_parser("init", help="Create a run from a goal.")
    init.add_argument("goal")
    init.add_argument("--run-id")
    init.add_argument("--mode", default="solo", choices=["solo", "team", "background", "review", "retrospective"])
    init.add_argument("--actor", default="human")
    init.add_argument("--owner", default="unassigned")
    init.add_argument("--next-action", default="Observe current local truth and choose the first implementation step.")
    init.add_argument("--stop-criteria", default="Goal is satisfied and the lookback states remaining risks.")
    init.set_defaults(func=command_init)

    event = subparsers.add_parser("event", help="Append a structured event to the current run.")
    event.add_argument("--run")
    event.add_argument("--actor", default="human")
    event.add_argument("--owner", default="unassigned")
    event.add_argument("--phase", required=True)
    event.add_argument("--action", required=True)
    event.add_argument("--result", required=True)
    event.add_argument("--verification", default="")
    event.add_argument("--artifact", default="")
    event.add_argument("--decision", default="")
    event.add_argument("--conclusion", default="")
    event.add_argument("--impact", default="")
    event.add_argument("--blocker", default="")
    event.add_argument("--active-work", default="")
    event.add_argument("--background-work", default="")
    event.add_argument("--next-action", default="Select the next action.")
    event.set_defaults(func=command_event)

    status = subparsers.add_parser("status", help="Print the current status truth.")
    status.add_argument("--run")
    status.add_argument("--refresh", action="store_true", help="Regenerate status.md from events before printing.")
    status.set_defaults(func=command_status)

    lookback = subparsers.add_parser("lookback", help="Render a retrospective from the event ledger.")
    lookback.add_argument("--run")
    lookback.add_argument("--write", action="store_true", help="Write lookback.md as well as printing it.")
    lookback.set_defaults(func=command_lookback)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
