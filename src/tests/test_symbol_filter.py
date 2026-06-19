from src.symbol_filter import _tokenise, filter_map


def test_tokenise_splits_on_word_boundaries():
    tokens = _tokenise("cached_context")
    assert "cached" in tokens
    assert "context" in tokens


def test_tokenise_drops_stopwords():
    tokens = _tokenise("add a fix to the cache")
    assert "the" not in tokens
    assert "cache" in tokens


def test_tokenise_drops_short_tokens():
    tokens = _tokenise("a to be in on")
    assert tokens == frozenset()


def test_filter_map_keeps_matching_file(tmp_path):
    repo_map = (
        "src/cache.py\n"
        "  def get_cache() -- line 1\n"
        "src/unrelated.py\n"
        "  def do_thing() -- line 1\n"
    )
    result = filter_map(repo_map, "fix the cache lookup")
    assert "cache.py" in result
    assert "unrelated.py" not in result


def test_filter_map_keeps_file_with_matching_symbol(tmp_path):
    repo_map = (
        "src/utils.py\n"
        "  def compute_checksum() -- line 5\n"
        "src/loader.py\n"
        "  def read_file() -- line 3\n"
    )
    result = filter_map(repo_map, "update checksum logic")
    assert "utils.py" in result
    assert "loader.py" not in result


def test_filter_map_returns_original_when_no_match():
    repo_map = "src/foo.py\n  def bar() -- line 1\n"
    result = filter_map(repo_map, "xyzzy quux zzzz")
    assert result == repo_map


def test_filter_map_returns_original_for_empty_task():
    repo_map = "src/foo.py\n  def bar() -- line 1\n"
    result = filter_map(repo_map, "")
    assert result == repo_map


def test_filter_map_returns_original_for_all_stopword_task():
    repo_map = "src/foo.py\n  def bar() -- line 1\n"
    result = filter_map(repo_map, "add to the fix")
    assert result == repo_map


def test_filter_map_keeps_all_symbols_of_matching_file():
    repo_map = (
        "src/cache.py\n"
        "  def get_cache() -- line 1\n"
        "  def set_cache() -- line 10\n"
        "  def clear_cache() -- line 20\n"
    )
    result = filter_map(repo_map, "cache invalidation")
    assert "get_cache" in result
    assert "set_cache" in result
    assert "clear_cache" in result


def test_filter_map_multiple_matches():
    repo_map = (
        "src/context.py\n"
        "  def format_context() -- line 5\n"
        "src/cached_context.py\n"
        "  def get_cached_context() -- line 10\n"
        "src/repo_map.py\n"
        "  def build_repo_map() -- line 1\n"
    )
    result = filter_map(repo_map, "context injection caching")
    assert "context.py" in result
    assert "cached_context.py" in result
    assert "repo_map.py" not in result
