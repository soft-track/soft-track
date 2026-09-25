"""The order keys behind manual card order (issue #88, part 2)."""

import itertools
import random

import pytest

from lib_utils.ranking import RankError, key_between, keys_in_order, validate


def test_the_first_key_is_the_middle():
    assert key_between(None, None) == "a0"


def test_known_values_from_the_reference_implementation():
    """rocicorp/fractional-indexing's own test cases."""
    cases = [
        ("a0", None, "a1"),
        ("a1", None, "a2"),
        (None, "a0", "Zz"),
        (None, "Zz", "Zy"),
        ("a0", "a1", "a0V"),
        ("a1", "a2", "a1V"),
        ("a0V", "a1", "a0l"),
        ("Zz", "a0", "ZzV"),
        ("Zz", "a1", "a0"),
        (None, "Y00", "Xzzz"),
        ("bzz", None, "c000"),
        ("a0", "a0V", "a0G"),
        ("a0", "a0G", "a08"),
        ("b125", "b129", "b127"),
        ("a0", "a1V", "a1"),
        ("Zz", "a01", "a0"),
        (None, "a0V", "a0"),
        (None, "b999", "b99"),
    ]
    for a, b, expected in cases:
        assert key_between(a, b) == expected, (a, b)


def test_a_key_between_two_others_sorts_between_them():
    rng = random.Random(88)
    keys = [key_between(None, None)]
    for _ in range(2000):
        i = rng.randrange(len(keys) + 1)
        a = keys[i - 1] if i > 0 else None
        b = keys[i] if i < len(keys) else None
        key = key_between(a, b)
        assert (a is None or a < key) and (b is None or key < b)
        keys.insert(i, key)
    assert keys == sorted(keys)
    assert len(set(keys)) == len(keys)


def test_adding_at_the_top_again_and_again_stays_short():
    """New issues always go on top of their column. Logarithmic growth is
    what makes that affordable: a naive midpoint scheme would reach a
    thousand characters here."""
    key = "a0"
    for _ in range(10_000):
        key = key_between(None, key)
    assert len(key) <= 4


def test_numbering_a_list_afresh_is_short_and_in_order():
    keys = list(itertools.islice(keys_in_order(), 5000))
    assert keys == sorted(keys)
    assert max(len(key) for key in keys) <= 4


@pytest.mark.parametrize(
    "a,b", [("a1", "a0"), ("a0", "a0"), ("", None), ("a00", None), ("x", None)]
)
def test_bad_or_out_of_order_keys_are_refused(a, b):
    with pytest.raises(RankError):
        key_between(a, b)


def test_validate_refuses_a_trailing_zero_fraction():
    with pytest.raises(RankError):
        validate("a0V0")
