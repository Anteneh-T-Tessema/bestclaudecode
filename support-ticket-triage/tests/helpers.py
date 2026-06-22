"""Shared test fixtures/builders for the ticket_triage test suite."""
from __future__ import annotations

from ticket_triage.ai_worker import AIWorker
from ticket_triage.knowledge_base import KBArticle, KnowledgeBase
from ticket_triage.llm_client import FakeLLMClient
from ticket_triage.local_index import VectorIndex
from ticket_triage.models import Channel, Ticket, TicketStatus, new_id, utcnow
from ticket_triage.send_gateway import SendGateway
from ticket_triage.storage import Storage
from ticket_triage.ticket_service import TicketService


def make_ticket(
    subject: str = "Help needed",
    body: str = "I need some help with my account.",
    customer_email: str = "customer@example.com",
    channel: Channel = Channel.EMAIL,
) -> Ticket:
    return Ticket(
        id=new_id(),
        subject=subject,
        body=body,
        customer_email=customer_email,
        channel=channel,
        created_at=utcnow(),
        status=TicketStatus.INGESTED,
    )


def make_kb(articles: list[tuple[str, str, str]] | None = None) -> KnowledgeBase:
    """articles: list of (id, title, body) tuples."""
    articles = articles or [
        ("kb-1", "How to reset your password", "Go to settings and click reset password to get a reset link emailed to you."),
        ("kb-2", "Billing and refund policy", "Refunds are processed within 5-7 business days after a request is approved."),
    ]
    return KnowledgeBase([KBArticle(id=a, title=t, body=b) for a, t, b in articles])


def build_service(
    *,
    kb: KnowledgeBase | None = None,
    existing_tickets: list[Ticket] | None = None,
    db_path: str = ":memory:",
) -> tuple[TicketService, VectorIndex, dict[str, Ticket], SendGateway]:
    """Build a fully-wired TicketService backed by FakeLLMClient, for tests."""
    storage = Storage(db_path)
    kb = kb or make_kb()
    index = VectorIndex()
    for article in kb.all():
        index.index_kb_article(article.id, article.text)

    tickets_by_id: dict[str, Ticket] = {}
    for t in existing_tickets or []:
        storage.insert_ticket(t)
        tickets_by_id[t.id] = t
        index.index_ticket(t.id, f"{t.subject}\n{t.body}")

    worker = AIWorker(FakeLLMClient(), index, kb, tickets_by_id)
    gateway = SendGateway()
    service = TicketService(storage, worker, gateway)
    return service, index, tickets_by_id, gateway
