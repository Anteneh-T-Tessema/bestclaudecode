# PRD: AI-Powered Support Ticket Triage

Date: 2026-06-18

## 1. Business problem / opportunity

Support teams receive tickets from multiple channels (email and a web
form) that must be manually read, categorized, and prioritized before
anyone can respond. This manual triage step delays first response,
and urgent tickets can be missed or buried behind lower-priority ones
simply because no one has looked at them yet. Agents also spend time
re-writing answers to questions that have effectively been answered
before, either in past tickets or in the knowledge base, which slows
down first response further and produces inconsistent answers across
agents.

The opportunity is to use an LLM to do the triage work automatically
(classify category and urgency) and to draft a first-response using
similar past tickets and knowledge-base articles (RAG), so that a
human agent's job shifts from "read, research, and write from
scratch" to "review and edit." Every outbound message still requires
human review before sending — this is a productivity and consistency
tool for agents, not an autonomous responder.

## 2. Goals & success metrics

1. **Reduce first-response time.** Measure: median and 90th-percentile
   time from ticket creation to first agent response, compared
   before/after rollout.
2. **Reduce missed or delayed urgent tickets.** Measure: count and
   percentage of tickets classified as urgent that breach a defined
   response-time SLA (e.g., no agent action within 1 hour), compared
   before/after rollout.
3. **Reduce agent drafting effort.** Measure: percentage of sent
   responses that originated from an AI-suggested draft (vs. written
   from scratch), and average edit distance between the draft and the
   sent response, as a proxy for how much rewriting was needed.
4. **Maintain classification accuracy high enough to trust.** Measure:
   percentage of AI-assigned category/urgency labels that agents
   accept without changing, tracked via an explicit
   accept/override action in the agent UI.
5. **Preserve human control over outbound communication.** Measure:
   100% of sent replies have a recorded human review/edit action
   prior to send (this is a hard requirement, not a target to
   approach — see Features).

Assumption: the idea does not state current baseline numbers (e.g.
existing first-response time or SLA definitions), so goals 1 and 2
are framed as relative before/after comparisons rather than absolute
targets. The specific SLA threshold for "urgent" (e.g. 1 hour) is an
assumed placeholder, not a number given in the idea — it should be
confirmed with the team that owns support SLAs before this is used to
judge success.

## 3. Target users

- **Support agents** who handle the day-to-day queue of incoming
  tickets. They are the primary users of the triage and drafting
  features: they need fast, trustworthy categorization and a
  starting-point reply they can edit rather than write from scratch.
- **Support team leads / supervisors** who need urgent tickets
  surfaced reliably and want visibility into whether triage is
  working (e.g., are urgent tickets being missed, are drafts being
  used or ignored).

Assumption: the idea does not mention end customers as direct users
of this system, end customers only interact with it indirectly
(email and a web form are the ticket-submission channels, not a
self-service UI). Customers are therefore not modeled as a "user" of
the triage product itself.

## 4. Features (in scope)

1. **Ticket ingestion** from two channels: incoming support email and
   a web form submission, normalized into a single ticket record.
2. **Automatic classification** of each incoming ticket by category
   and urgency using an LLM.
3. **Similar-ticket retrieval**: for each incoming ticket, retrieve
   similar past tickets to give the agent context on precedent and
   prior resolutions.
4. **Knowledge-base retrieval (RAG)**: retrieve relevant
   knowledge-base articles related to the incoming ticket's content.
5. **Suggested first-response drafting**: generate a draft reply
   grounded in the retrieved similar tickets and KB articles.
6. **Human review and edit workflow**: every draft is presented to a
   human agent, who can edit, replace, or discard it before anything
   is sent. The system has no path that sends a reply without a human
   review step.
7. **Urgency-based queue surfacing**: tickets classified as urgent are
   visibly prioritized/surfaced to agents so they are not missed
   among lower-priority tickets.
8. **Classification override**: agents can correct an AI-assigned
   category or urgency label, and that action is recorded (supports
   goal 4's accuracy metric).

## 5. Out of scope / non-goals

- **Autonomous sending of replies.** The system will never send a
  customer-facing message without explicit human review and approval
  for this version, and no future "auto-send" mode is implied by this
  PRD.
- **Additional ingestion channels** beyond email and the web form
  (e.g., chat widgets, social media, phone transcripts) are not
  included in this version.
- **Knowledge-base authoring/management tools.** This system consumes
  an existing knowledge base for retrieval; building or improving KB
  content-management tooling is out of scope.
- **Ticket routing/assignment to specific agents or teams** beyond
  surfacing urgency. Workload balancing, skill-based routing, and
  assignment automation are not addressed in this version.
- **Customer-facing self-service** (e.g., a chatbot that answers
  customers directly) is not in scope — this is strictly an internal
  agent-assist tool.
- **Multi-language support, SLA configuration tooling, and reporting
  dashboards** beyond the basic metrics needed to evaluate the goals
  above are not specified in the idea and are treated as future
  work, not included here.
