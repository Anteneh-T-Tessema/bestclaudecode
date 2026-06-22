"""Integration tests for cli.py: end-to-end runs against a temp SQLite db."""
from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path

from ticket_triage.cli import EXIT_FAILURE, EXIT_OK, run


class CliIntegrationTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmp.name)
        self.db_path = str(self.tmp_path / "tickets.db")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _run(self, args: list[str]):
        out = io.StringIO()
        err = io.StringIO()
        code = run(args, stdout=out, stderr=err)
        return code, out.getvalue(), err.getvalue()

    def _write_kb(self) -> str:
        kb_path = self.tmp_path / "kb.json"
        kb_path.write_text(
            json.dumps([{"id": "kb-1", "title": "Password reset", "body": "Click the reset link in your email."}]),
            encoding="utf-8",
        )
        return str(kb_path)


class InitAndIngestTests(CliIntegrationTestCase):
    def test_init_creates_database(self) -> None:
        code, out, err = self._run(["--db", self.db_path, "init"])
        self.assertEqual(code, EXIT_OK)
        self.assertTrue(Path(self.db_path).exists())

    def test_ingest_web_and_show(self) -> None:
        code, out, err = self._run(
            [
                "--db", self.db_path,
                "ingest-web", "--subject", "Help", "--body", "I forgot my password and need a reset.", "--email", "a@example.com",
            ]
        )
        self.assertEqual(code, EXIT_OK)
        self.assertIn("ingested ticket", out)
        ticket_id = out.split()[2]

        code, out, err = self._run(["--db", self.db_path, "show", ticket_id])
        self.assertEqual(code, EXIT_OK)
        self.assertIn("subject: Help", out)

    def test_ingest_email_from_file(self) -> None:
        msg_path = self.tmp_path / "msg.eml"
        msg_path.write_text("From: c@example.com\nSubject: Billing issue\n\nI was charged twice.", encoding="utf-8")
        code, out, err = self._run(["--db", self.db_path, "ingest-email", str(msg_path)])
        self.assertEqual(code, EXIT_OK)
        self.assertIn("ingested ticket", out)

    def test_show_nonexistent_ticket_fails_clearly(self) -> None:
        code, out, err = self._run(["--db", self.db_path, "show", "does-not-exist"])
        self.assertEqual(code, EXIT_FAILURE)
        self.assertIn("no such ticket", err)


class QueueAndReviewFlowTests(CliIntegrationTestCase):
    def _ingest(self, body: str, email: str = "a@example.com") -> str:
        code, out, _ = self._run(["--db", self.db_path, "ingest-web", "--body", body, "--email", email])
        self.assertEqual(code, EXIT_OK)
        return out.split()[2]

    def test_queue_lists_urgent_ahead_of_normal(self) -> None:
        self._ingest("Just a general question, no rush.")
        self._ingest("URGENT the system is down and I'm losing money.")
        code, out, err = self._run(["--db", self.db_path, "queue"])
        self.assertEqual(code, EXIT_OK)
        lines = [line for line in out.splitlines() if line.strip()]
        self.assertEqual(len(lines), 2)
        self.assertIn("urgent", lines[0])

    def test_override_then_review_accept_sends(self) -> None:
        ticket_id = self._ingest("I need help resetting my password.")
        code, _, _ = self._run(["--db", self.db_path, "override", ticket_id, "--urgency", "urgent"])
        self.assertEqual(code, EXIT_OK)

        code, out, _ = self._run(["--db", self.db_path, "show", ticket_id])
        self.assertIn("urgency: urgent", out)

        code, out, err = self._run(["--db", self.db_path, "review", ticket_id, "--action", "accept", "--text", "Final reply text."])
        self.assertEqual(code, EXIT_OK)
        self.assertIn("review action accept recorded", out)

    def test_review_discard_records_action_without_send(self) -> None:
        ticket_id = self._ingest("A routine question.")
        code, out, err = self._run(["--db", self.db_path, "review", ticket_id, "--action", "discard"])
        self.assertEqual(code, EXIT_OK)
        self.assertIn("review action discard recorded", out)

    def test_review_without_draft_fails_clearly(self) -> None:
        code, out, err = self._run(["--db", self.db_path, "review", "no-such-ticket", "--action", "discard"])
        self.assertEqual(code, EXIT_FAILURE)
        self.assertIn("no such ticket", err)


class KnowledgeBaseWiringTests(CliIntegrationTestCase):
    def test_ingest_with_kb_grounds_draft(self) -> None:
        kb_path = self._write_kb()
        ticket_id_out = self._run(
            ["--db", self.db_path, "--kb", kb_path, "ingest-web", "--body", "I forgot my password, how do I reset it?", "--email", "x@example.com"]
        )
        code, out, err = ticket_id_out
        self.assertEqual(code, EXIT_OK)
        ticket_id = out.split()[2]

        code, out, err = self._run(["--db", self.db_path, "--kb", kb_path, "show", ticket_id])
        self.assertEqual(code, EXIT_OK)
        self.assertIn("draft", out)


if __name__ == "__main__":
    unittest.main()
