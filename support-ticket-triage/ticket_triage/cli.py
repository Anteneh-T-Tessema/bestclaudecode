"""CLI entry point: a runnable demonstration of the full ticket lifecycle.

The SDD's "Agent UI" is a web application (C-7); this study repo does not
build a web frontend (see README "What this does not build"). This CLI is
the runnable substitute that exercises the same backend operations a real
Agent UI would call through the Ticket Service facade: ingest, list the
queue, show ticket detail, override a classification, and submit a review
action (accept/edit/discard) -- the same single send-authorization code
path described in SDD 4.2, just invoked from a terminal instead of a
browser.

    python -m ticket_triage.cli init --db tickets.db --kb kb.json
    python -m ticket_triage.cli ingest-email --db tickets.db <path-to-message-file>
    python -m ticket_triage.cli ingest-web --db tickets.db --subject "..." --body "..." --email a@b.com
    python -m ticket_triage.cli queue --db tickets.db
    python -m ticket_triage.cli show --db tickets.db <ticket-id>
    python -m ticket_triage.cli override --db tickets.db <ticket-id> --urgency urgent
    python -m ticket_triage.cli review --db tickets.db <ticket-id> --action accept
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

from ticket_triage.ai_worker import AIWorker
from ticket_triage.ingestion import parse_email_file, parse_web_form_submission
from ticket_triage.knowledge_base import KnowledgeBase
from ticket_triage.llm_client import FakeLLMClient
from ticket_triage.local_index import VectorIndex
from ticket_triage.models import Category, ReviewActionType, Urgency
from ticket_triage.overrides import apply_override
from ticket_triage.queue import QueueView
from ticket_triage.storage import Storage
from ticket_triage.ticket_service import TicketService

EXIT_OK = 0
EXIT_FAILURE = 1


def _build_service(db_path: str, kb_path: str | None) -> TicketService:
    storage = Storage(db_path)
    index = VectorIndex()
    kb = KnowledgeBase.from_json_file(kb_path) if kb_path else KnowledgeBase()
    for article in kb.all():
        index.index_kb_article(article.id, article.text)

    tickets_by_id = {t.id: t for t in storage.list_tickets()}
    for t in tickets_by_id.values():
        index.index_ticket(t.id, f"{t.subject}\n{t.body}")

    worker = AIWorker(FakeLLMClient(), index, kb, tickets_by_id)
    service = TicketService(storage, worker)

    # Keep the in-memory ticket lookup (used for similar-ticket retrieval)
    # in sync as new tickets are ingested in this process.
    original_ingest = service.ingest_ticket

    def ingest_and_index(ticket):
        result = original_ingest(ticket)
        tickets_by_id[ticket.id] = ticket
        index.index_ticket(ticket.id, f"{ticket.subject}\n{ticket.body}")
        return result

    service.ingest_ticket = ingest_and_index  # type: ignore[method-assign]
    return service


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ticket-triage", description=__doc__)
    parser.add_argument("--db", default="tickets.db", help="path to the SQLite datastore (default: tickets.db)")
    parser.add_argument("--kb", default=None, help="path to a KB articles JSON file")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="initialize the datastore")

    p_email = sub.add_parser("ingest-email", help="ingest a ticket from a local email message file")
    p_email.add_argument("path", help="path to a .eml/.txt message file")

    p_web = sub.add_parser("ingest-web", help="ingest a ticket from web-form fields")
    p_web.add_argument("--subject", default="")
    p_web.add_argument("--body", required=True)
    p_web.add_argument("--email", required=True)

    sub.add_parser("queue", help="list the agent queue, urgent/manual-triage first")

    p_show = sub.add_parser("show", help="show ticket detail")
    p_show.add_argument("ticket_id")

    p_override = sub.add_parser("override", help="correct AI-assigned category/urgency")
    p_override.add_argument("ticket_id")
    p_override.add_argument("--category", choices=[c.value for c in Category], default=None)
    p_override.add_argument("--urgency", choices=[u.value for u in Urgency], default=None)
    p_override.add_argument("--agent", default="cli-agent")

    p_review = sub.add_parser("review", help="submit a review action (accept/edit/discard)")
    p_review.add_argument("ticket_id")
    p_review.add_argument("--action", choices=[a.value for a in ReviewActionType], required=True)
    p_review.add_argument("--text", default=None, help="final text (required for accept/edit)")
    p_review.add_argument("--agent", default="cli-agent")

    return parser


def run(argv: Sequence[str] | None = None, stdout=None, stderr=None) -> int:
    out = stdout if stdout is not None else sys.stdout
    err = stderr if stderr is not None else sys.stderr

    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "init":
            Storage(args.db).close()
            out.write(f"initialized datastore at {args.db}\n")
            return EXIT_OK

        service = _build_service(args.db, args.kb)

        if args.command == "ingest-email":
            ticket = parse_email_file(Path(args.path))
            updated = service.ingest_ticket(ticket)
            out.write(f"ingested ticket {updated.id} status={updated.status.value}\n")
            return EXIT_OK

        if args.command == "ingest-web":
            ticket = parse_web_form_submission({"subject": args.subject, "body": args.body, "email": args.email})
            updated = service.ingest_ticket(ticket)
            out.write(f"ingested ticket {updated.id} status={updated.status.value}\n")
            return EXIT_OK

        if args.command == "queue":
            entries = QueueView().build(service.storage.list_tickets())
            for entry in entries:
                t = entry.ticket
                out.write(f"[{entry.bucket.value:>20}] {t.id}  {t.subject!r}  status={t.status.value}\n")
            return EXIT_OK

        if args.command == "show":
            ticket = service.storage.get_ticket(args.ticket_id)
            if ticket is None:
                err.write(f"error: no such ticket {args.ticket_id}\n")
                return EXIT_FAILURE
            draft = service.storage.get_latest_draft_for_ticket(ticket.id)
            out.write(f"ticket {ticket.id}\n")
            out.write(f"  subject: {ticket.subject}\n")
            out.write(f"  channel: {ticket.channel.value}\n")
            out.write(f"  status: {ticket.status.value}\n")
            out.write(f"  category: {ticket.category.value if ticket.category else '-'}\n")
            out.write(f"  urgency: {ticket.urgency.value if ticket.urgency else '-'}\n")
            if draft is not None:
                flagged = " [CONTENT-FILTER-FLAGGED]" if draft.content_filter_flagged else ""
                out.write(f"  draft{flagged}:\n    {draft.text}\n")
            return EXIT_OK

        if args.command == "override":
            ticket = service.storage.get_ticket(args.ticket_id)
            if ticket is None:
                err.write(f"error: no such ticket {args.ticket_id}\n")
                return EXIT_FAILURE
            apply_override(
                service.storage,
                ticket,
                agent_id=args.agent,
                corrected_category=Category(args.category) if args.category else None,
                corrected_urgency=Urgency(args.urgency) if args.urgency else None,
            )
            out.write(f"override recorded for ticket {ticket.id}\n")
            return EXIT_OK

        if args.command == "review":
            ticket = service.storage.get_ticket(args.ticket_id)
            if ticket is None:
                err.write(f"error: no such ticket {args.ticket_id}\n")
                return EXIT_FAILURE
            draft = service.storage.get_latest_draft_for_ticket(ticket.id)
            if draft is None:
                err.write(f"error: ticket {ticket.id} has no draft to review\n")
                return EXIT_FAILURE
            action_type = ReviewActionType(args.action)
            final_text = args.text if action_type != ReviewActionType.DISCARD else None
            service.review_workflow.submit_review_action(
                ticket=ticket,
                draft=draft,
                agent_id=args.agent,
                action_type=action_type,
                final_text=final_text,
            )
            out.write(f"review action {args.action} recorded for ticket {ticket.id}\n")
            return EXIT_OK

        err.write(f"error: unknown command {args.command!r}\n")
        return EXIT_FAILURE
    except Exception as exc:  # noqa: BLE001 - CLI boundary: report, don't crash with a raw traceback
        err.write(f"error: {exc}\n")
        return EXIT_FAILURE


def main() -> None:
    sys.exit(run(sys.argv[1:]))


if __name__ == "__main__":
    main()
