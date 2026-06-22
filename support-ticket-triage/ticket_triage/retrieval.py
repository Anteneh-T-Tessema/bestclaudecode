"""Similar-Ticket Retriever (2.5) and Knowledge-Base Retriever (2.6).

Implements FR-9 through FR-12: semantic search over ticket history and KB
content, with the Similar-Ticket Retriever additionally redacting another
customer's identifying fields from retrieved ticket content before it can
reach the drafting prompt (FR-11, NFR-7) -- unless that identifying
information belongs to the *current* ticket's own customer, in which case
redacting it would remove a customer's own legitimate context for no
safety benefit.

Both retrievers log what they retrieved and at what rank (FR-10, NFR-14)
by returning a ``RetrievalRecord`` the caller (the AI worker) persists via
``Storage.insert_retrieval``.
"""
from __future__ import annotations

import re

from ticket_triage.knowledge_base import KnowledgeBase
from ticket_triage.local_index import VectorIndex
from ticket_triage.models import RetrievalRecord, RetrievedItem, Ticket, new_id, utcnow

#: Naive email-address pattern, sufficient for redacting another
#: customer's email address out of retrieved ticket snippets.
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")

_REDACTED_EMAIL = "[redacted-customer-email]"
_REDACTED_NAME = "[redacted-customer-name]"


def redact_other_customer_pii(snippet: str, *, retrieved_customer_email: str, current_customer_email: str) -> tuple[str, bool]:
    """Strip another customer's identifying fields from a retrieved snippet.

    FR-11: only redact if the retrieved ticket's customer differs from the
    current ticket's customer -- a customer's own historical ticket should
    not have its own information stripped, since that isn't a leak.

    Returns (possibly-redacted snippet, whether anything was redacted).
    """
    if retrieved_customer_email.strip().lower() == current_customer_email.strip().lower():
        return snippet, False

    redacted = snippet
    changed = False

    if retrieved_customer_email and retrieved_customer_email in redacted:
        redacted = redacted.replace(retrieved_customer_email, _REDACTED_EMAIL)
        changed = True

    # Backstop: redact any other email-shaped string too, in case the
    # snippet contains an address that isn't exactly retrieved_customer_email
    # (e.g. a different contact mentioned in the ticket body) -- defense in
    # depth per AI requirements Section 4's "cross-ticket data leakage" guard.
    def _sub(match: re.Match) -> str:
        nonlocal changed
        if match.group(0).strip().lower() == current_customer_email.strip().lower():
            return match.group(0)
        changed = True
        return _REDACTED_EMAIL

    redacted = _EMAIL_RE.sub(_sub, redacted)

    return redacted, changed


class SimilarTicketRetriever:
    """Embeds/searches ticket history and redacts cross-customer PII (2.5)."""

    def __init__(self, index: VectorIndex, tickets_by_id: dict[str, Ticket]) -> None:
        self._index = index
        self._tickets_by_id = tickets_by_id

    def retrieve(self, ticket: Ticket, top_k: int = 3) -> RetrievalRecord:
        """Return a RetrievalRecord of similar past tickets, PII-redacted (FR-9/10/11)."""
        query = f"{ticket.subject}\n{ticket.body}"
        hits = self._index.search_tickets(query, top_k=top_k, exclude_id=ticket.id)

        items: list[RetrievedItem] = []
        for rank, (other_id, score) in enumerate(hits, start=1):
            other_ticket = self._tickets_by_id.get(other_id)
            if other_ticket is None:
                continue
            snippet, redacted = redact_other_customer_pii(
                other_ticket.body,
                retrieved_customer_email=other_ticket.customer_email,
                current_customer_email=ticket.customer_email,
            )
            items.append(
                RetrievedItem(
                    source_type="ticket",
                    source_id=other_id,
                    rank=rank,
                    score=score,
                    snippet=snippet,
                    redacted=redacted,
                )
            )

        return RetrievalRecord(id=new_id(), ticket_id=ticket.id, items=items, created_at=utcnow())


class KnowledgeBaseRetriever:
    """Embeds/searches KB articles for grounding material (2.6)."""

    def __init__(self, index: VectorIndex, kb: KnowledgeBase) -> None:
        self._index = index
        self._kb = kb

    def retrieve(self, ticket: Ticket, top_k: int = 3) -> RetrievalRecord:
        """Return a RetrievalRecord of relevant KB articles (FR-12)."""
        query = f"{ticket.subject}\n{ticket.body}"
        hits = self._index.search_kb(query, top_k=top_k)

        items: list[RetrievedItem] = []
        for rank, (article_id, score) in enumerate(hits, start=1):
            article = self._kb.get(article_id)
            if article is None:
                continue
            items.append(
                RetrievedItem(
                    source_type="kb_article",
                    source_id=article_id,
                    rank=rank,
                    score=score,
                    snippet=article.body,
                    redacted=False,
                )
            )

        return RetrievalRecord(id=new_id(), ticket_id=ticket.id, items=items, created_at=utcnow())
