"""Tests for retrieval.py: FR-9 through FR-12, and the FR-11/NFR-7 PII redaction
acceptance criterion ("a retrieved similar ticket containing another
customer's PII... does not appear in the resulting draft or in the agent
UI without clear visual separation, verified via a test case using a
planted cross-customer PII fixture").
"""
from __future__ import annotations

import unittest

from ticket_triage.knowledge_base import KBArticle, KnowledgeBase
from ticket_triage.local_index import VectorIndex
from ticket_triage.models import Channel, Ticket, TicketStatus, new_id, utcnow
from ticket_triage.retrieval import KnowledgeBaseRetriever, SimilarTicketRetriever, redact_other_customer_pii


def _ticket(subject: str, body: str, email: str) -> Ticket:
    return Ticket(
        id=new_id(),
        subject=subject,
        body=body,
        customer_email=email,
        channel=Channel.EMAIL,
        created_at=utcnow(),
        status=TicketStatus.INGESTED,
    )


class RedactionFunctionTests(unittest.TestCase):
    def test_redacts_other_customers_email(self) -> None:
        snippet = "Please contact me at victim@example.com if you have questions."
        redacted, changed = redact_other_customer_pii(
            snippet, retrieved_customer_email="victim@example.com", current_customer_email="someone-else@example.com"
        )
        self.assertTrue(changed)
        self.assertNotIn("victim@example.com", redacted)

    def test_does_not_redact_when_same_customer(self) -> None:
        snippet = "Please contact me at me@example.com about my own prior ticket."
        redacted, changed = redact_other_customer_pii(
            snippet, retrieved_customer_email="me@example.com", current_customer_email="me@example.com"
        )
        self.assertFalse(changed)
        self.assertIn("me@example.com", redacted)

    def test_redacts_unrelated_email_shaped_string_in_snippet_as_backstop(self) -> None:
        snippet = "My account manager is bob@othercorp.com, please loop him in."
        redacted, changed = redact_other_customer_pii(
            snippet, retrieved_customer_email="victim@example.com", current_customer_email="someone-else@example.com"
        )
        self.assertTrue(changed)
        self.assertNotIn("bob@othercorp.com", redacted)


class SimilarTicketRetrieverTests(unittest.TestCase):
    def test_retrieves_similar_ticket_and_redacts_other_customer_pii(self) -> None:
        victim_ticket = _ticket(
            "Refund issue",
            "I need a refund, my account email is victim@example.com and my account number is 12345.",
            "victim@example.com",
        )
        current_ticket = _ticket("Refund question", "I also need a refund for my recent invoice charge.", "newcustomer@example.com")

        index = VectorIndex()
        index.index_ticket(victim_ticket.id, f"{victim_ticket.subject}\n{victim_ticket.body}")
        index.index_ticket(current_ticket.id, f"{current_ticket.subject}\n{current_ticket.body}")

        retriever = SimilarTicketRetriever(index, {victim_ticket.id: victim_ticket, current_ticket.id: current_ticket})
        record = retriever.retrieve(current_ticket, top_k=3)

        self.assertTrue(record.items, "expected at least one similar ticket to be retrieved")
        hit = record.items[0]
        self.assertEqual(hit.source_id, victim_ticket.id)
        self.assertTrue(hit.redacted)
        self.assertNotIn("victim@example.com", hit.snippet)

    def test_does_not_redact_own_prior_ticket(self) -> None:
        prior_ticket = _ticket("Prior issue", "My email is same@example.com for reference.", "same@example.com")
        current_ticket = _ticket("New issue", "Following up, my email is same@example.com again.", "same@example.com")

        index = VectorIndex()
        index.index_ticket(prior_ticket.id, f"{prior_ticket.subject}\n{prior_ticket.body}")
        index.index_ticket(current_ticket.id, f"{current_ticket.subject}\n{current_ticket.body}")

        retriever = SimilarTicketRetriever(index, {prior_ticket.id: prior_ticket, current_ticket.id: current_ticket})
        record = retriever.retrieve(current_ticket, top_k=3)

        self.assertTrue(record.items)
        hit = record.items[0]
        self.assertFalse(hit.redacted)
        self.assertIn("same@example.com", hit.snippet)

    def test_excludes_the_ticket_itself_from_its_own_results(self) -> None:
        current_ticket = _ticket("Issue", "Some content here about billing.", "x@example.com")
        index = VectorIndex()
        index.index_ticket(current_ticket.id, f"{current_ticket.subject}\n{current_ticket.body}")
        retriever = SimilarTicketRetriever(index, {current_ticket.id: current_ticket})
        record = retriever.retrieve(current_ticket)
        self.assertEqual(record.items, [])


class KnowledgeBaseRetrieverTests(unittest.TestCase):
    def test_retrieves_relevant_kb_article(self) -> None:
        kb = KnowledgeBase([KBArticle(id="kb-1", title="Password reset", body="To reset your password, click the link.")])
        index = VectorIndex()
        for article in kb.all():
            index.index_kb_article(article.id, article.text)

        ticket = _ticket("Cannot log in", "I forgot my password and need to reset it.", "user@example.com")
        retriever = KnowledgeBaseRetriever(index, kb)
        record = retriever.retrieve(ticket)

        self.assertTrue(record.items)
        self.assertEqual(record.items[0].source_id, "kb-1")
        self.assertEqual(record.items[0].source_type, "kb_article")

    def test_no_relevant_articles_returns_empty(self) -> None:
        kb = KnowledgeBase([KBArticle(id="kb-1", title="Unrelated", body="Completely unrelated content about cats.")])
        index = VectorIndex()
        for article in kb.all():
            index.index_kb_article(article.id, article.text)
        ticket = _ticket("Refund", "xyzxyz qwerty asdf zzz", "user@example.com")
        retriever = KnowledgeBaseRetriever(index, kb)
        record = retriever.retrieve(ticket)
        self.assertEqual(record.items, [])


if __name__ == "__main__":
    unittest.main()
