"""Tests for review.py: FR-17 through FR-20, the human-review-before-send gate.

Matches the SRS acceptance criteria for the human review workflow: "for
every sent reply in a test/staging environment, a query of the audit log
shows a recorded human review/edit action with agent identity and
timestamp preceding the send, with zero exceptions" and "an agent can
successfully edit, replace, or discard a draft and the resulting action
(and final sent content, if sent) is recorded correctly in each of the
three cases."
"""
from __future__ import annotations

import unittest

from ticket_triage.models import Draft, ReviewActionType, TicketStatus, new_id
from ticket_triage.review import ReviewError, ReviewWorkflow, edit_distance
from ticket_triage.send_gateway import SendGateway
from ticket_triage.storage import Storage
from tests.helpers import make_ticket


def _draft_for(ticket_id: str, text: str = "Here is your draft reply.") -> Draft:
    return Draft(
        id=new_id(),
        ticket_id=ticket_id,
        text=text,
        model_version="m1",
        prompt_version="p1",
        grounding_ticket_ids=[],
        grounding_kb_ids=[],
    )


class EditDistanceTests(unittest.TestCase):
    def test_identical_strings_have_zero_distance(self) -> None:
        self.assertEqual(edit_distance("hello", "hello"), 0)

    def test_distance_against_empty_string_is_length(self) -> None:
        self.assertEqual(edit_distance("", "hello"), 5)
        self.assertEqual(edit_distance("hello", ""), 5)

    def test_single_substitution(self) -> None:
        self.assertEqual(edit_distance("cat", "bat"), 1)


class AcceptActionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = Storage(":memory:")
        self.gateway = SendGateway()
        self.workflow = ReviewWorkflow(self.storage, self.gateway)
        self.ticket = make_ticket()
        self.storage.insert_ticket(self.ticket)
        self.draft = _draft_for(self.ticket.id)
        self.storage.insert_draft(self.draft)

    def test_accept_records_review_action_and_sends(self) -> None:
        action = self.workflow.submit_review_action(
            ticket=self.ticket,
            draft=self.draft,
            agent_id="agent-1",
            action_type=ReviewActionType.ACCEPT,
            final_text=self.draft.text,
        )
        self.assertEqual(action.action_type, ReviewActionType.ACCEPT)
        self.assertEqual(action.edit_distance, 0)
        self.assertEqual(len(self.gateway.outbox), 1)
        self.assertEqual(self.gateway.outbox[0].final_text, self.draft.text)

        sends = self.storage.list_sends()
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0].review_action_id, action.id)

        updated_ticket = self.storage.get_ticket(self.ticket.id)
        self.assertEqual(updated_ticket.status, TicketStatus.SENT)

    def test_accept_requires_non_empty_final_text(self) -> None:
        with self.assertRaises(ReviewError):
            self.workflow.submit_review_action(
                ticket=self.ticket, draft=self.draft, agent_id="agent-1", action_type=ReviewActionType.ACCEPT, final_text="   "
            )
        self.assertEqual(self.gateway.outbox, [])


class EditActionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = Storage(":memory:")
        self.gateway = SendGateway()
        self.workflow = ReviewWorkflow(self.storage, self.gateway)
        self.ticket = make_ticket()
        self.storage.insert_ticket(self.ticket)
        self.draft = _draft_for(self.ticket.id, text="Original draft text.")
        self.storage.insert_draft(self.draft)

    def test_edit_sends_final_text_and_records_nonzero_edit_distance(self) -> None:
        final_text = "Edited and improved draft text."
        action = self.workflow.submit_review_action(
            ticket=self.ticket, draft=self.draft, agent_id="agent-1", action_type=ReviewActionType.EDIT, final_text=final_text
        )
        self.assertGreater(action.edit_distance, 0)
        self.assertEqual(self.gateway.outbox[0].final_text, final_text)
        self.assertNotEqual(self.gateway.outbox[0].final_text, self.draft.text)


class DiscardActionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = Storage(":memory:")
        self.gateway = SendGateway()
        self.workflow = ReviewWorkflow(self.storage, self.gateway)
        self.ticket = make_ticket()
        self.storage.insert_ticket(self.ticket)
        self.draft = _draft_for(self.ticket.id)
        self.storage.insert_draft(self.draft)

    def test_discard_records_action_but_never_sends(self) -> None:
        action = self.workflow.submit_review_action(
            ticket=self.ticket, draft=self.draft, agent_id="agent-1", action_type=ReviewActionType.DISCARD
        )
        self.assertEqual(action.action_type, ReviewActionType.DISCARD)
        self.assertIsNone(action.final_text)
        self.assertEqual(self.gateway.outbox, [])
        self.assertEqual(self.storage.list_sends(), [])

        updated_ticket = self.storage.get_ticket(self.ticket.id)
        self.assertEqual(updated_ticket.status, TicketStatus.DISCARDED)

    def test_discard_with_final_text_raises(self) -> None:
        with self.assertRaises(ReviewError):
            self.workflow.submit_review_action(
                ticket=self.ticket,
                draft=self.draft,
                agent_id="agent-1",
                action_type=ReviewActionType.DISCARD,
                final_text="should not be allowed",
            )


class DraftTicketMismatchTests(unittest.TestCase):
    def test_draft_from_a_different_ticket_is_rejected(self) -> None:
        storage = Storage(":memory:")
        workflow = ReviewWorkflow(storage, SendGateway())
        ticket = make_ticket()
        storage.insert_ticket(ticket)
        other_ticket_draft = _draft_for("some-other-ticket-id")
        with self.assertRaises(ReviewError):
            workflow.submit_review_action(
                ticket=ticket, draft=other_ticket_draft, agent_id="agent-1", action_type=ReviewActionType.DISCARD
            )


class AuditTrailZeroExceptionsTests(unittest.TestCase):
    """SRS acceptance criterion: every sent reply has a preceding recorded
    review action, with zero exceptions, queryable from the audit log."""

    def test_every_send_in_audit_log_has_a_preceding_review_action(self) -> None:
        storage = Storage(":memory:")
        gateway = SendGateway()
        workflow = ReviewWorkflow(storage, gateway)

        tickets_and_drafts = []
        for i in range(5):
            ticket = make_ticket(subject=f"Ticket {i}")
            storage.insert_ticket(ticket)
            draft = _draft_for(ticket.id, text=f"Draft {i}")
            storage.insert_draft(draft)
            tickets_and_drafts.append((ticket, draft))

        for i, (ticket, draft) in enumerate(tickets_and_drafts):
            action_type = ReviewActionType.DISCARD if i == 0 else ReviewActionType.ACCEPT
            final_text = None if action_type == ReviewActionType.DISCARD else draft.text
            workflow.submit_review_action(ticket=ticket, draft=draft, agent_id="agent-1", action_type=action_type, final_text=final_text)

        sends = storage.list_sends()
        self.assertEqual(len(sends), 4)  # one ticket discarded, not sent
        for send in sends:
            review_action = storage.get_review_action(send.review_action_id)
            self.assertIsNotNone(review_action, "every send must have a preceding recorded review action")
            self.assertIn(review_action.action_type, (ReviewActionType.ACCEPT, ReviewActionType.EDIT))

        # And the audit log itself contains a "send" event for each send,
        # each carrying the review_action_id that authorized it.
        send_events = storage.list_audit_events(event_type="send")
        self.assertEqual(len(send_events), 4)
        for event in send_events:
            self.assertIn("review_action_id", event.details)


if __name__ == "__main__":
    unittest.main()
