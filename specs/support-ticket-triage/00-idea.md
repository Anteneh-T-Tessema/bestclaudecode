# Idea

Date: 2026-06-18

An AI-powered support ticket triage system. Incoming customer support
tickets (from email and a web form) are automatically classified by
category and urgency using an LLM. For each ticket, the system retrieves
similar past tickets and relevant knowledge-base articles (RAG) and
drafts a suggested first response. A human agent reviews and edits the
draft before anything is sent — the system never sends a reply
autonomously. Goal: cut first-response time and reduce missed/delayed
urgent tickets, while keeping a human in the loop for every outbound
message.
