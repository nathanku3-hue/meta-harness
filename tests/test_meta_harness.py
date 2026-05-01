from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "meta_harness.py"


class MetaHarnessCliTest(unittest.TestCase):
    def run_cli(self, cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            cwd=cwd,
            check=True,
            text=True,
            capture_output=True,
        )

    def test_init_event_status_and_lookback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cwd = Path(tmp)

            init = self.run_cli(
                cwd,
                "init",
                "write a minimal SOP harness",
                "--actor",
                "test",
                "--owner",
                "codex",
            )
            self.assertIn("Initialized run:", init.stdout)

            run_id = (cwd / ".meta-harness" / "current-run").read_text(encoding="utf-8").strip()
            run_path = cwd / ".meta-harness" / "runs" / run_id
            self.assertTrue((run_path / "status.md").exists())
            self.assertTrue((run_path / "events.jsonl").exists())

            self.run_cli(
                cwd,
                "event",
                "--phase",
                "implementation",
                "--action",
                "added CLI",
                "--result",
                "commands run locally",
                "--verification",
                "unit test covered the CLI path",
                "--artifact",
                "meta_harness.py",
                "--decision",
                "keep first version dependency-free",
                "--next-action",
                "document usage",
            )

            status = self.run_cli(cwd, "status", "--refresh").stdout
            self.assertIn("Latest action: added CLI", status)
            self.assertIn("keep first version dependency-free", status)
            self.assertIn("meta_harness.py", status)

            lookback = self.run_cli(cwd, "lookback", "--write").stdout
            self.assertIn("write a minimal SOP harness", lookback)
            self.assertIn("added CLI -> commands run locally", lookback)
            self.assertTrue((run_path / "lookback.md").exists())


if __name__ == "__main__":
    unittest.main()
