"""Architectural / code-level audit: enforces NFR-6, C-9, FR-19.

This is the test the SRS acceptance criteria explicitly call for: "a
code-level/architectural audit confirms no service other than the
agent-facing UI holds credentials to the outbound send API." Since this
study repo collapses the SDD's separate AI Worker/Ticket Service network
boundary into one Python process, the equivalent enforceable property is
at the import-graph and class-construction level:

1. ``ai_worker`` (and everything it imports: classifier, retrieval,
   drafting, local_index, knowledge_base, llm_client) must contain no
   reference whatsoever to ``send_gateway`` -- neither an import, nor the
   literal string "send_gateway"/"SendGateway" anywhere in source.
2. ``AIWorker`` must not expose any method/attribute that is or returns a
   ``SendGateway``.
3. ``ReviewWorkflow`` must be the only class in the package that is
   constructed with (holds a reference to) a ``SendGateway``.

This complements (does not replace) the behavioral tests in
``test_review.py`` -- those prove sends always have a preceding review
action when going through the one real path; this proves there is no
*other* path to construct.
"""
from __future__ import annotations

import ast
import inspect
import unittest
from pathlib import Path

import ticket_triage.ai_worker as ai_worker_module
import ticket_triage.classifier as classifier_module
import ticket_triage.drafting as drafting_module
import ticket_triage.retrieval as retrieval_module
from ticket_triage.ai_worker import AIWorker
from ticket_triage.review import ReviewWorkflow
from ticket_triage.send_gateway import SendGateway

_PACKAGE_DIR = Path(__file__).resolve().parent.parent / "ticket_triage"

# Modules that make up "the AI Worker and its collaborators" per the SDD's
# 2.9 credential boundary -- none of these may reference the send gateway.
_AI_WORKER_SIDE_MODULES = [
    ai_worker_module,
    classifier_module,
    retrieval_module,
    drafting_module,
]


class NoSendReferenceInAIWorkerSourceTests(unittest.TestCase):
    def test_ai_worker_side_modules_never_mention_send_gateway(self) -> None:
        for module in _AI_WORKER_SIDE_MODULES:
            source = inspect.getsource(module)
            self.assertNotIn(
                "send_gateway", source.lower(),
                f"{module.__name__} must not reference send_gateway at all (NFR-6, SDD 2.9)",
            )
            self.assertNotIn(
                "sendgateway", source.lower(),
                f"{module.__name__} must not reference SendGateway at all (NFR-6, SDD 2.9)",
            )

    def test_ai_worker_module_does_not_import_send_gateway(self) -> None:
        tree = ast.parse(inspect.getsource(ai_worker_module))
        imported_names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                imported_names.update(alias.name for alias in node.names)
                if node.module:
                    imported_names.add(node.module)
            elif isinstance(node, ast.Import):
                imported_names.update(alias.name for alias in node.names)
        self.assertFalse(
            any("send_gateway" in name or "SendGateway" in name for name in imported_names),
            f"ai_worker.py must not import send_gateway; found imports: {imported_names}",
        )


class AIWorkerHasNoSendCapabilityTests(unittest.TestCase):
    def test_ai_worker_constructor_signature_has_no_send_gateway_parameter(self) -> None:
        sig = inspect.signature(AIWorker.__init__)
        for name, param in sig.parameters.items():
            self.assertNotIn("send", name.lower(), f"AIWorker.__init__ must not accept a send-related parameter, found {name!r}")

    def test_ai_worker_instance_has_no_attribute_referencing_a_send_gateway(self) -> None:
        from ticket_triage.knowledge_base import KnowledgeBase
        from ticket_triage.llm_client import FakeLLMClient
        from ticket_triage.local_index import VectorIndex

        worker = AIWorker(FakeLLMClient(), VectorIndex(), KnowledgeBase(), {})
        for attr_name in vars(worker):
            attr_value = getattr(worker, attr_name)
            self.assertNotIsInstance(
                attr_value, SendGateway, f"AIWorker.{attr_name} must not hold a SendGateway instance"
            )
            # also walk one level into known collaborator objects
            for sub_name in vars(attr_value) if hasattr(attr_value, "__dict__") else []:
                sub_value = getattr(attr_value, sub_name, None)
                self.assertNotIsInstance(
                    sub_value, SendGateway,
                    f"AIWorker.{attr_name}.{sub_name} must not hold a SendGateway instance",
                )

    def test_ai_worker_public_methods_do_not_mention_send(self) -> None:
        for name, _ in inspect.getmembers(AIWorker, predicate=inspect.isfunction):
            if name.startswith("_"):
                continue
            self.assertNotIn("send", name.lower(), f"AIWorker must not expose a send-capable method, found {name!r}")


class ReviewWorkflowIsSoleSendCallerTests(unittest.TestCase):
    def test_review_workflow_is_constructed_with_a_send_gateway(self) -> None:
        sig = inspect.signature(ReviewWorkflow.__init__)
        self.assertIn("send_gateway", sig.parameters)

    def test_only_review_module_imports_send_gateway_among_package_modules(self) -> None:
        """Scan every .py file in the package; only review.py (and the gateway
        module itself, and ticket_service.py which wires it through to
        ReviewWorkflow) may import send_gateway."""
        allowed = {"review.py", "send_gateway.py", "ticket_service.py", "cli.py"}
        offenders = []
        for path in _PACKAGE_DIR.glob("*.py"):
            if path.name in allowed:
                continue
            text = path.read_text(encoding="utf-8")
            if "send_gateway" in text or "SendGateway" in text:
                offenders.append(path.name)
        self.assertEqual(offenders, [], f"unexpected references to send_gateway found in: {offenders}")


if __name__ == "__main__":
    unittest.main()
