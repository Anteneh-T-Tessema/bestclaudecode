"""Integration tests against throwaway git fixture repos.

Exercises the full pipeline (CLI -> git access -> classify -> sections ->
render -> output) end to end, covering the SRS acceptance criteria for
FR-1 through FR-6, FR-19, FR-22 through FR-25, NFR-2, and a code-level
check supporting NFR-7.
"""

from __future__ import annotations

import io
import subprocess
import tempfile
import unittest
from pathlib import Path

from changelog_cli.cli import EXIT_FAILURE, EXIT_OK, run
from tests.helpers import commit, init_repo, tag


class CliIntegrationTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = init_repo(Path(self._tmp.name))

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _run(self, args: list[str]):
        out = io.StringIO()
        err = io.StringIO()
        code = run(args, stdout=out, stderr=err)
        return code, out.getvalue(), err.getvalue()


class TestRepoAndRangeTargeting(CliIntegrationTestCase):
    def test_default_repo_path_uses_cwd(self) -> None:
        commit(self.repo, "feat: initial feature")
        tag(self.repo, "v1.0.0")
        commit(self.repo, "fix: a bug")

        import os

        cwd = os.getcwd()
        try:
            os.chdir(self.repo)
            code, out, err = self._run(["v1.0.0..HEAD"])
        finally:
            os.chdir(cwd)

        self.assertEqual(code, EXIT_OK)
        self.assertIn("### Fixes", out)

    def test_non_repository_directory_fails_clearly(self) -> None:
        with tempfile.TemporaryDirectory() as not_a_repo:
            code, out, err = self._run([not_a_repo, "v1.0.0..HEAD"])
        self.assertEqual(code, EXIT_FAILURE)
        self.assertIn("not a git repository", err)
        self.assertEqual(out, "")

    def test_nonexistent_path_fails_clearly(self) -> None:
        code, out, err = self._run(["/path/does/not/exist/at/all", "v1.0.0..HEAD"])
        self.assertEqual(code, EXIT_FAILURE)
        self.assertTrue(err.strip())

    def test_invalid_range_typo_fails_with_clear_message(self) -> None:
        commit(self.repo, "feat: initial feature")
        tag(self.repo, "v1.0.0")
        code, out, err = self._run([str(self.repo), "v1.0.0..v1.3.O"])  # letter O typo
        self.assertEqual(code, EXIT_FAILURE)
        self.assertIn("invalid commit range", err)
        self.assertEqual(out, "")

    def test_valid_tag_to_tag_range_matches_git_log(self) -> None:
        commit(self.repo, "chore: bootstrap")
        tag(self.repo, "v1.0.0")
        commit(self.repo, "feat: add thing one")
        commit(self.repo, "fix: fix thing one")
        tag(self.repo, "v1.1.0")
        commit(self.repo, "feat: add thing two (after v1.1.0)")

        code, out, err = self._run([str(self.repo), "v1.0.0..v1.1.0"])
        self.assertEqual(code, EXIT_OK)

        git_log = subprocess.run(
            ["git", "-C", str(self.repo), "log", "v1.0.0..v1.1.0", "--format=%s"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        expected_subjects = [line for line in git_log.splitlines() if line]
        self.assertEqual(len(expected_subjects), 2)
        self.assertIn("add thing one", out)
        self.assertIn("fix thing one", out)
        self.assertNotIn("after v1.1.0", out)

    def test_valid_empty_range_exits_zero_with_well_formed_output(self) -> None:
        commit(self.repo, "feat: only commit")
        tag(self.repo, "v1.0.0")
        code, out, err = self._run([str(self.repo), "v1.0.0..v1.0.0"])
        self.assertEqual(code, EXIT_OK)
        self.assertTrue(out.strip())
        self.assertEqual(err, "")


class TestCatchAllAndMergeCommits(CliIntegrationTestCase):
    def test_mixed_typed_and_untyped_commits_all_present(self) -> None:
        commit(self.repo, "chore: bootstrap")
        tag(self.repo, "v1.0.0")
        commit(self.repo, "feat: add feature")
        commit(self.repo, "Fixture update for tests")
        commit(self.repo, "fix: resolve issue")
        tag(self.repo, "v1.1.0")

        code, out, err = self._run([str(self.repo), "v1.0.0..v1.1.0"])
        self.assertEqual(code, EXIT_OK)
        self.assertIn("### Features", out)
        self.assertIn("### Fixes", out)
        self.assertIn("### Other", out)
        self.assertIn("Fixture update for tests", out)
        # "fix" must not have swallowed the catch-all entry:
        fixes_section = out.split("### Fixes", 1)[1].split("###", 1)[0]
        self.assertNotIn("Fixture update", fixes_section)

    def test_merge_commit_included_exactly_once(self) -> None:
        commit(self.repo, "chore: bootstrap")
        tag(self.repo, "v1.0.0")

        subprocess.run(
            ["git", "-C", str(self.repo), "checkout", "-b", "feature-branch"],
            check=True,
            capture_output=True,
        )
        commit(self.repo, "feat: branch feature", filename="branch_file.txt")
        subprocess.run(
            ["git", "-C", str(self.repo), "checkout", "main"],
            check=True,
            capture_output=True,
        )
        commit(self.repo, "fix: main fix", filename="main_file.txt")
        subprocess.run(
            [
                "git",
                "-C",
                str(self.repo),
                "merge",
                "feature-branch",
                "--no-ff",
                "-m",
                "fix: merge feature branch",
            ],
            check=True,
            capture_output=True,
        )
        tag(self.repo, "v1.1.0")

        code, out, err = self._run([str(self.repo), "v1.0.0..v1.1.0"])
        self.assertEqual(code, EXIT_OK)
        self.assertEqual(out.count("merge feature branch"), 1)


class TestOutputDestination(CliIntegrationTestCase):
    def test_output_file_receives_content_and_stdout_is_empty(self) -> None:
        commit(self.repo, "feat: add thing")
        tag(self.repo, "v1.0.0")
        commit(self.repo, "fix: fix thing")
        tag(self.repo, "v1.1.0")

        with tempfile.TemporaryDirectory() as outdir:
            outfile = Path(outdir) / "out.md"
            code, out, err = self._run(
                [str(self.repo), "v1.0.0..v1.1.0", "--output", str(outfile)]
            )
            self.assertEqual(code, EXIT_OK)
            self.assertEqual(out, "")
            content = outfile.read_text(encoding="utf-8")
            self.assertIn("### Fixes", content)


class TestHelpAndExitCodes(CliIntegrationTestCase):
    def test_help_exits_zero_and_prints_usage(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            run(["--help"])
        self.assertEqual(ctx.exception.code, 0)

    def test_successful_run_exits_zero(self) -> None:
        commit(self.repo, "feat: thing")
        tag(self.repo, "v1.0.0")
        commit(self.repo, "fix: other thing")
        code, _, _ = self._run([str(self.repo), "v1.0.0..HEAD"])
        self.assertEqual(code, EXIT_OK)

    def test_failure_modes_exit_nonzero_distinguishable_from_success(self) -> None:
        code_bad_repo, _, _ = self._run(["/nonexistent", "v1.0.0..HEAD"])
        commit(self.repo, "feat: thing")
        tag(self.repo, "v1.0.0")
        code_ok, _, _ = self._run([str(self.repo), "v1.0.0..HEAD"])
        self.assertNotEqual(code_bad_repo, code_ok)
        self.assertEqual(code_ok, EXIT_OK)
        self.assertEqual(code_bad_repo, EXIT_FAILURE)


class TestDeterminism(CliIntegrationTestCase):
    def test_repeated_runs_produce_byte_identical_output(self) -> None:
        commit(self.repo, "feat: thing one")
        commit(self.repo, "fix: thing two")
        commit(self.repo, "chore: thing three")
        tag(self.repo, "v1.0.0")

        _, first_out, _ = self._run([str(self.repo), "v1.0.0~3..v1.0.0"])
        _, second_out, _ = self._run([str(self.repo), "v1.0.0~3..v1.0.0"])
        self.assertEqual(first_out, second_out)


class TestMaliciousInputDoesNotReachAShell(CliIntegrationTestCase):
    """Code-level check supporting NFR-7.

    A maliciously crafted commit subject or tag/range string must never be
    able to influence what gets *executed* -- only what gets *displayed*.
    We prove this behaviorally: a subject line containing shell metachars
    is treated as inert text data, and a range string containing shell
    metachars is rejected by git as an invalid ref rather than executed.
    """

    def test_shell_metacharacters_in_commit_subject_are_inert_text(self) -> None:
        commit(self.repo, "chore: bootstrap")
        tag(self.repo, "v1.0.0")
        dangerous_subject = "feat: do thing; rm -rf /tmp/should-not-run $(whoami) `id`"
        commit(self.repo, dangerous_subject)
        code, out, err = self._run([str(self.repo), "v1.0.0..HEAD"])
        self.assertEqual(code, EXIT_OK)
        # The dangerous text appears verbatim as *data* in the rendered
        # output -- proving it was never interpreted as shell syntax.
        self.assertIn("do thing; rm -rf /tmp/should-not-run $(whoami) `id`", out)

    def test_shell_metacharacters_in_range_argument_do_not_execute(self) -> None:
        commit(self.repo, "chore: bootstrap")
        marker_file = self.repo / "INJECTED_MARKER"
        injected_range = f"v1.0.0..HEAD; touch {marker_file}"
        code, out, err = self._run([str(self.repo), injected_range])
        # git rejects this as an invalid range (the whole string is treated
        # as one literal, malformed ref). If the `;` had been interpreted
        # by a shell as a command separator, `touch` would have created
        # the marker file -- proving the argument was executed rather than
        # passed through as inert data. It must not exist.
        self.assertEqual(code, EXIT_FAILURE)
        self.assertFalse(marker_file.exists())

    def test_no_shell_true_in_subprocess_call_sites(self) -> None:
        """AST-level check (NFR-7): every subprocess.run call in the git
        access layer must pass shell=False (or omit shell, which defaults
        to False) and must never pass shell=True as a keyword argument.
        This inspects actual call nodes, not docstring prose, so comments
        discussing the constraint don't produce false positives/negatives.
        """
        import ast

        import changelog_cli.git_access as git_access_module

        source = Path(git_access_module.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)

        run_calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "run"
        ]
        self.assertTrue(run_calls, "expected at least one subprocess.run call")

        for call in run_calls:
            shell_kwargs = [kw for kw in call.keywords if kw.arg == "shell"]
            for kw in shell_kwargs:
                self.assertIsInstance(kw.value, ast.Constant)
                self.assertFalse(
                    kw.value.value,
                    "found shell=True on a subprocess.run call",
                )


if __name__ == "__main__":
    unittest.main()
