"""Order keys that let one item move between two others by writing one row.

This is the fractional-indexing scheme -- a Python port of the algorithm in
rocicorp/fractional-indexing (MIT), itself after David Greenspan's
"Implementing Fractional Indexing". A key is a string; keys compare as plain
strings; and between any two there is always another. So moving a card only
ever rewrites the card, never its column.

A key is an *integer part* followed by a *fraction*. The integer part's first
character says how long it is (`a0` is zero, `a1` one, `b10` sixty-two, `Zz`
minus one), which is what makes repeatedly adding at either end cost only
logarithmic growth: a thousand new issues at the top of a column produce keys
three characters long, not a thousand. Only repeated insertion into the *same*
gap lengthens the fraction.

Keys must compare by code point. SQLite's default collation does; on
Postgres the column is declared `COLLATE "C"` for the same reason -- a
locale collation would sort `a0` and `Zz` case-insensitively, and the order
would be wrong.
"""

from typing import Iterator, Optional

DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
_ZERO = DIGITS[0]
INTEGER_ZERO = "a0"
_SMALLEST_INTEGER = "A" + _ZERO * 26


class RankError(ValueError):
    """A key that is malformed, or two that are not in order."""


def _midpoint(a: str, b: Optional[str]) -> str:
    """A fraction strictly between `a` and `b` (None meaning "one")."""
    if b is not None and a >= b:
        raise RankError(f"{a!r} is not before {b!r}")
    if a.endswith(_ZERO) or (b is not None and b.endswith(_ZERO)):
        raise RankError("a fraction may not end in zero")
    if b is not None:
        n = 0
        while (a[n] if n < len(a) else _ZERO) == b[n]:
            n += 1
        if n > 0:
            return b[:n] + _midpoint(a[n:], b[n:])
    digit_a = DIGITS.index(a[0]) if a else 0
    digit_b = DIGITS.index(b[0]) if b is not None else len(DIGITS)
    if digit_b - digit_a > 1:
        return DIGITS[(digit_a + digit_b + 1) // 2]
    if b is not None and len(b) > 1:
        return b[:1]
    return DIGITS[digit_a] + _midpoint(a[1:], None)


def _integer_length(head: str) -> int:
    if "a" <= head <= "z":
        return ord(head) - ord("a") + 2
    if "A" <= head <= "Z":
        return ord("Z") - ord(head) + 2
    raise RankError(f"invalid key head {head!r}")


def _integer_part(key: str) -> str:
    length = _integer_length(key[0])
    if length > len(key):
        raise RankError(f"invalid key {key!r}")
    return key[:length]


def validate(key: str) -> None:
    if not key:
        raise RankError("empty key")
    if key == _SMALLEST_INTEGER:
        raise RankError("the smallest integer is not a valid key")
    fraction = key[len(_integer_part(key)) :]
    if fraction.endswith(_ZERO):
        raise RankError(f"invalid key {key!r}")


def _increment(integer: str) -> Optional[str]:
    head, digits = integer[0], list(integer[1:])
    carry = True
    for i in range(len(digits) - 1, -1, -1):
        value = DIGITS.index(digits[i]) + 1
        if value == len(DIGITS):
            digits[i] = _ZERO
        else:
            digits[i] = DIGITS[value]
            carry = False
            break
    if not carry:
        return head + "".join(digits)
    if head == "Z":
        return "a" + _ZERO
    if head == "z":
        return None
    new_head = chr(ord(head) + 1)
    if new_head > "a":
        digits.append(_ZERO)
    else:
        digits.pop()
    return new_head + "".join(digits)


def _decrement(integer: str) -> Optional[str]:
    head, digits = integer[0], list(integer[1:])
    borrow = True
    for i in range(len(digits) - 1, -1, -1):
        value = DIGITS.index(digits[i]) - 1
        if value == -1:
            digits[i] = DIGITS[-1]
        else:
            digits[i] = DIGITS[value]
            borrow = False
            break
    if not borrow:
        return head + "".join(digits)
    if head == "a":
        return "Z" + DIGITS[-1]
    if head == "A":
        return None
    new_head = chr(ord(head) - 1)
    if new_head < "Z":
        digits.append(DIGITS[-1])
    else:
        digits.pop()
    return new_head + "".join(digits)


def key_between(a: Optional[str], b: Optional[str]) -> str:
    """A key strictly after `a` and before `b`. None means "no bound"."""
    if a is not None:
        validate(a)
    if b is not None:
        validate(b)
    if a is not None and b is not None and a >= b:
        raise RankError(f"{a!r} is not before {b!r}")

    if a is None:
        if b is None:
            return INTEGER_ZERO
        integer_b = _integer_part(b)
        fraction_b = b[len(integer_b) :]
        if integer_b == _SMALLEST_INTEGER:
            return integer_b + _midpoint("", fraction_b)
        if integer_b < b:
            return integer_b
        smaller = _decrement(integer_b)
        if smaller is None:
            raise RankError("cannot go below the smallest key")
        return smaller

    if b is None:
        integer_a = _integer_part(a)
        fraction_a = a[len(integer_a) :]
        larger = _increment(integer_a)
        return integer_a + _midpoint(fraction_a, None) if larger is None else larger

    integer_a = _integer_part(a)
    fraction_a = a[len(integer_a) :]
    integer_b = _integer_part(b)
    fraction_b = b[len(integer_b) :]
    if integer_a == integer_b:
        return integer_a + _midpoint(fraction_a, fraction_b)
    larger = _increment(integer_a)
    if larger is None:
        raise RankError("cannot go above the largest key")
    if larger < b:
        return larger
    return integer_a + _midpoint(fraction_a, None)


def keys_in_order(start: Optional[str] = None) -> Iterator[str]:
    """Keys ascending from just after `start` -- for numbering a list afresh."""
    key = start
    while True:
        key = key_between(key, None)
        yield key
