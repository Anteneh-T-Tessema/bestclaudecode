"""Tests for drafting.py: FR-13 through FR-16 (grounded drafting + content filter)."""
from __future__ import annotations

import unittest

from ticket_triage.drafting import ContentFilter, DraftGenerator
from ticket_triage.llm_client import DraftResult, FakeLLMClient, ScriptedLLMClient
from ticket_triage.models import Channel, RetrievedItem, Ticket, TicketStatus, new_id, utcnow


def _ticket() -> Ticket:
    return Ticket(
        id=new_id(),
        subject="Refund question",
        body="I'd like a refund for a duplicate charge.",
        customer_email="cust@example.com",
        channel=Channel.EMAIL,
        created_at=utcnow(),
        status=TicketStatus.CLASSIFIED,
    )


class DraftGeneratorTests(unittest.TestCase):
    def test_draft_references_grounding_material(self) -> None:
        generator = DraftGenerator(FakeLLMClient())
        similar = [RetrievedItem(source_type="ticket", source_id="t-1", rank=1, score=0.9, snippet="Refunds take 5 days.")]
        kb = [RetrievedItem(source_type="kb_article", source_id="kb-1", rank=1, score=0.8, snippet="Refund policy: 5-7 days.")]
        draft = generator.generate(_ticket(), similar_tickets=similar, kb_articles=kb)
        self.assertIn("Refund policy", draft.text)
        self.assertEqual(draft.grounding_ticket_ids, ["t-1"])
        self.assertEqual(draft.grounding_kb_ids, ["kb-1"])
        self.assertFalse(draft.content_filter_flagged)

    def test_no_grounding_material_still_produces_a_safe_draft(self) -> None:
        generator = DraftGenerator(FakeLLMClient())
        draft = generator.generate(_ticket(), similar_tickets=[], kb_articles=[])
        self.assertTrue(draft.text)
        self.assertFalse(draft.content_filter_flagged)

    def test_flagged_draft_is_marked_not_silently_passed_through(self) -> None:
        scripted = ScriptedLLMClient(draft_responses=[DraftResult(text="You're an idiot for asking that.")])
        generator = DraftGenerator(scripted)
        draft = generator.generate(_ticket(), similar_tickets=[], kb_articles=[])
        self.assertTrue(draft.content_filter_flagged)
        self.assertIsNotNone(draft.content_filter_reason)
        # The draft is still returned (so the caller can log + hold it),
        # but it is clearly marked rather than silently presented as a
        # normal draft.
        self.assertEqual(draft.text, "You're an idiot for asking that.")


class ContentFilterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.filter = ContentFilter()

    def test_flags_offensive_language(self) -> None:
        flagged, reason = self.filter.check("You are being stupid about this.", grounding_text="")
        self.assertTrue(flagged)
        self.assertIn("offensive", reason)

    def test_flags_fabricated_commitment_not_in_grounding(self) -> None:
        flagged, reason = self.filter.check(
            "We offer a 100% guarantee on all refunds, no exceptions.", grounding_text="Refunds take 5-7 days."
        )
        self.assertTrue(flagged)
        self.assertIn("unsupported commitment", reason)

    def test_does_not_flag_commitment_that_is_present_in_grounding(self) -> None:
        flagged, _ = self.filter.check(
            "As stated in our policy, we offer a 100% guarantee on refunds.",
            grounding_text="Our policy: we offer a 100% guarantee on refunds.",
        )
        self.assertFalse(flagged)

    def test_flags_email_address_not_present_in_grounding_as_possible_pii_leak(self) -> None:
        flagged, reason = self.filter.check(
            "You can also reach out to someoneelse@example.com for help.", grounding_text="General help info."
        )
        self.assertTrue(flagged)
        self.assertIn("leaked PII", reason)

    def test_does_not_flag_email_address_present_in_grounding(self) -> None:
        flagged, _ = self.filter.check(
            "Please follow up with support@ourcompany.com.", grounding_text="Our support address is support@ourcompany.com."
        )
        self.assertFalse(flagged)

    def test_clean_draft_is_not_flagged(self) -> None:
        flagged, reason = self.filter.check("Thanks for reaching out, here is some helpful information.", grounding_text="info")
        self.assertFalse(flagged)
        self.assertIsNone(reason)


if __name__ == "__main__":
    unittest.main()
