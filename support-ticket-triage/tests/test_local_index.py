"""Tests for local_index.py: the local TF-IDF vector index stand-in."""
from __future__ import annotations

import unittest

from ticket_triage.local_index import TFIDFCorpus, VectorIndex, tokenize


class TokenizeTests(unittest.TestCase):
    def test_lowercases_and_strips_stopwords(self) -> None:
        tokens = tokenize("The Quick Brown Fox is a test")
        self.assertNotIn("the", tokens)
        self.assertNotIn("is", tokens)
        self.assertNotIn("a", tokens)
        self.assertIn("quick", tokens)
        self.assertIn("brown", tokens)

    def test_empty_string_yields_no_tokens(self) -> None:
        self.assertEqual(tokenize(""), [])


class TFIDFCorpusTests(unittest.TestCase):
    def test_search_ranks_more_relevant_document_higher(self) -> None:
        corpus = TFIDFCorpus()
        corpus.add("doc1", "password reset link is broken and does not work")
        corpus.add("doc2", "refund request for a duplicate charge on my invoice")
        results = corpus.search("password reset broken")
        self.assertTrue(results)
        self.assertEqual(results[0][0], "doc1")

    def test_search_on_empty_corpus_returns_empty(self) -> None:
        corpus = TFIDFCorpus()
        self.assertEqual(corpus.search("anything"), [])

    def test_search_with_no_scorable_tokens_returns_empty(self) -> None:
        corpus = TFIDFCorpus()
        corpus.add("doc1", "some real content here")
        self.assertEqual(corpus.search("the and is"), [])  # all stopwords

    def test_remove_excludes_document_from_future_searches(self) -> None:
        corpus = TFIDFCorpus()
        corpus.add("doc1", "billing refund invoice charge")
        corpus.remove("doc1")
        self.assertEqual(corpus.search("billing refund"), [])

    def test_get_text_returns_original_text(self) -> None:
        corpus = TFIDFCorpus()
        corpus.add("doc1", "original text here")
        self.assertEqual(corpus.get_text("doc1"), "original text here")
        self.assertIsNone(corpus.get_text("missing"))

    def test_len_reflects_document_count(self) -> None:
        corpus = TFIDFCorpus()
        corpus.add("doc1", "a")
        corpus.add("doc2", "b")
        self.assertEqual(len(corpus), 2)


class VectorIndexPartitionTests(unittest.TestCase):
    """The SDD requires two logically separate partitions: tickets and KB."""

    def test_ticket_and_kb_partitions_are_independent(self) -> None:
        index = VectorIndex()
        index.index_ticket("t1", "password reset issue")
        index.index_kb_article("kb1", "password reset issue")

        ticket_hits = index.search_tickets("password reset")
        kb_hits = index.search_kb("password reset")

        self.assertEqual([h[0] for h in ticket_hits], ["t1"])
        self.assertEqual([h[0] for h in kb_hits], ["kb1"])

    def test_search_tickets_excludes_given_id(self) -> None:
        index = VectorIndex()
        index.index_ticket("t1", "billing refund invoice")
        index.index_ticket("t2", "billing refund invoice")
        hits = index.search_tickets("billing refund", exclude_id="t1")
        self.assertNotIn("t1", [h[0] for h in hits])
        self.assertIn("t2", [h[0] for h in hits])


if __name__ == "__main__":
    unittest.main()
