"""Tests for ingestion.py: FR-1, FR-2, FR-3 (two channels, one canonical schema)."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from ticket_triage.ingestion import (
    IngestionError,
    parse_email_file,
    parse_email_message,
    parse_web_form_submission,
    scan_email_inbox,
)
from ticket_triage.models import Channel


class EmailIngestionTests(unittest.TestCase):
    def test_parses_headers_and_body(self) -> None:
        raw = "From: alice@example.com\nSubject: Cannot log in\n\nI keep getting an error.\nPlease help."
        ticket = parse_email_message(raw)
        self.assertEqual(ticket.customer_email, "alice@example.com")
        self.assertEqual(ticket.subject, "Cannot log in")
        self.assertIn("I keep getting an error.", ticket.body)
        self.assertEqual(ticket.channel, Channel.EMAIL)

    def test_missing_from_header_raises(self) -> None:
        raw = "Subject: no sender\n\nbody text"
        with self.assertRaises(IngestionError):
            parse_email_message(raw)

    def test_malformed_header_line_raises(self) -> None:
        raw = "This is not a header line\n\nbody"
        with self.assertRaises(IngestionError):
            parse_email_message(raw)

    def test_missing_subject_defaults(self) -> None:
        raw = "From: bob@example.com\n\njust a body, no subject header"
        ticket = parse_email_message(raw)
        self.assertEqual(ticket.subject, "(no subject)")

    def test_parse_email_file_reads_from_disk(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "msg1.eml"
            path.write_text("From: carol@example.com\nSubject: Refund\n\nI want a refund.", encoding="utf-8")
            ticket = parse_email_file(path)
            self.assertEqual(ticket.customer_email, "carol@example.com")

    def test_scan_email_inbox_reads_all_messages_sorted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "b.eml").write_text("From: b@example.com\nSubject: B\n\nbody b", encoding="utf-8")
            (tmp_path / "a.eml").write_text("From: a@example.com\nSubject: A\n\nbody a", encoding="utf-8")
            (tmp_path / "ignore.json").write_text("{}", encoding="utf-8")
            tickets = scan_email_inbox(tmp_path)
            self.assertEqual(len(tickets), 2)
            self.assertEqual([t.subject for t in tickets], ["A", "B"])

    def test_scan_email_inbox_missing_folder_returns_empty(self) -> None:
        self.assertEqual(scan_email_inbox("/nonexistent/path/at/all"), [])


class WebFormIngestionTests(unittest.TestCase):
    def test_parses_standard_field_names(self) -> None:
        ticket = parse_web_form_submission({"subject": "Bug", "body": "It crashed", "email": "dave@example.com"})
        self.assertEqual(ticket.subject, "Bug")
        self.assertEqual(ticket.body, "It crashed")
        self.assertEqual(ticket.customer_email, "dave@example.com")
        self.assertEqual(ticket.channel, Channel.WEB_FORM)

    def test_accepts_alternate_field_names(self) -> None:
        ticket = parse_web_form_submission({"message": "alt body field", "customer_email": "eve@example.com"})
        self.assertEqual(ticket.body, "alt body field")
        self.assertEqual(ticket.customer_email, "eve@example.com")

    def test_empty_body_raises(self) -> None:
        with self.assertRaises(IngestionError):
            parse_web_form_submission({"email": "f@example.com", "body": "   "})

    def test_missing_email_raises(self) -> None:
        with self.assertRaises(IngestionError):
            parse_web_form_submission({"body": "no email given"})


class NormalizationProducesOneSchemaTests(unittest.TestCase):
    """FR-2: both channels normalize into the same Ticket schema/shape."""

    def test_email_and_web_form_tickets_have_same_fields(self) -> None:
        email_ticket = parse_email_message("From: x@example.com\nSubject: S\n\nbody")
        web_ticket = parse_web_form_submission({"subject": "S", "body": "body", "email": "y@example.com"})
        self.assertEqual(set(vars(email_ticket).keys()), set(vars(web_ticket).keys()))
        self.assertNotEqual(email_ticket.channel, web_ticket.channel)


if __name__ == "__main__":
    unittest.main()
