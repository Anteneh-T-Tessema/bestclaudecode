"""Ingestion adapters: Email (2.1) and Web Form (2.2), plus normalization (2.3).

Local-equivalent infrastructure note: the SDD assumes a real inbound mail
handling integration (C-7) pushing messages to a webhook. This is a local
study repo, not a production deployment with a real mailbox, so the Email
Ingestion Adapter here reads ``.eml``-like plain-text message files dropped
into a folder (a "maildir-ish" local equivalent) instead of speaking IMAP/
webhook to a real provider. The Web-Form Ingestion Adapter takes a plain
dict, which is exactly the shape a real web form POST handler would already
have decoded into before calling this layer -- so that adapter needs no
local-equivalent substitution at all.

Both adapters do the same thing structurally: parse a channel-specific raw
payload, then hand it to ``normalize_ticket`` (FR-2) to produce one
canonical ``Ticket`` regardless of source channel (FR-1, FR-3).
"""
from __future__ import annotations

import re
from pathlib import Path

from ticket_triage.models import Channel, Ticket, TicketStatus, new_id, utcnow

_EMAIL_HEADER_RE = re.compile(r"^([A-Za-z-]+):\s*(.*)$")


class IngestionError(Exception):
    """A raw payload could not be parsed into a ticket (malformed input)."""


def normalize_ticket(*, subject: str, body: str, customer_email: str, channel: Channel) -> Ticket:
    """Build the canonical ticket schema (FR-2) from channel-agnostic fields.

    Every ingestion adapter must funnel through this function so that
    downstream classification/retrieval/drafting always sees one consistent
    shape, regardless of which channel produced it (FR-1, FR-3).
    """
    subject = subject.strip()
    body = body.strip()
    customer_email = customer_email.strip()
    if not body:
        raise IngestionError("ticket body must not be empty")
    if not customer_email:
        raise IngestionError("ticket must have a customer email/contact")

    return Ticket(
        id=new_id(),
        subject=subject or "(no subject)",
        body=body,
        customer_email=customer_email,
        channel=channel,
        created_at=utcnow(),
        status=TicketStatus.INGESTED,
    )


def parse_email_message(raw_text: str) -> Ticket:
    """Parse a simple RFC-2822-ish text message into a canonical Ticket.

    Local equivalent of the Email Ingestion Adapter (SDD 2.1): in a real
    deployment this would be invoked by a webhook callback from the
    organization's mail-handling integration (C-7). Here it parses a plain
    text file with ``From:``/``Subject:`` headers followed by a blank line
    and a body, the same shape ``.eml``-style fixtures or a local maildir
    drop folder would produce -- so the parsing logic is realistic without
    requiring a real SMTP/IMAP server.
    """
    lines = raw_text.splitlines()
    headers: dict[str, str] = {}
    body_start = len(lines)
    for i, line in enumerate(lines):
        if line.strip() == "":
            body_start = i + 1
            break
        match = _EMAIL_HEADER_RE.match(line)
        if not match:
            raise IngestionError(f"malformed email header line: {line!r}")
        headers[match.group(1).lower()] = match.group(2).strip()

    if "from" not in headers:
        raise IngestionError("email message missing From: header")

    body = "\n".join(lines[body_start:])
    return normalize_ticket(
        subject=headers.get("subject", ""),
        body=body,
        customer_email=headers["from"],
        channel=Channel.EMAIL,
    )


def parse_email_file(path: str | Path) -> Ticket:
    """Read and parse a single email-message file from a local inbox folder."""
    text = Path(path).read_text(encoding="utf-8")
    return parse_email_message(text)


def scan_email_inbox(folder: str | Path) -> list[Ticket]:
    """Parse every message file in a local "inbox" folder into tickets.

    The local equivalent of a webhook firing for each new inbound message:
    instead of a push notification from a real mail provider, this adapter
    polls a folder. Files are read in name-sorted order for deterministic
    test behavior. Non-``.eml``/``.txt`` files are ignored.
    """
    folder_path = Path(folder)
    if not folder_path.is_dir():
        return []
    tickets = []
    for path in sorted(folder_path.iterdir()):
        if path.suffix not in (".eml", ".txt"):
            continue
        tickets.append(parse_email_file(path))
    return tickets


def parse_web_form_submission(payload: dict) -> Ticket:
    """Parse a web-form POST payload (already-decoded dict) into a Ticket.

    Local equivalent of the Web-Form Ingestion Adapter (SDD 2.2). Expects
    keys ``subject`` (optional), ``body``/``message``, and
    ``email``/``customer_email``.
    """
    body = payload.get("body") or payload.get("message") or ""
    customer_email = payload.get("customer_email") or payload.get("email") or ""
    subject = payload.get("subject", "")
    return normalize_ticket(subject=subject, body=body, customer_email=customer_email, channel=Channel.WEB_FORM)
