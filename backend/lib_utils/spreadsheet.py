"""Writing CSV that is safe to open in a spreadsheet.

Every export shares these rules: a UTF-8 BOM, because Excel reads a file
without one in the machine's local codepage and mangles every non-ASCII name;
CRLF line endings; and text that could run as a formula made plain.
"""

#: What a spreadsheet takes a cell starting with to be a formula.
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

BOM = "\ufeff"


def safe_text(value: str) -> str:
    """Text somebody typed, made safe to open in a spreadsheet.

    Excel and Sheets run a cell starting with `=` (or `+`, `-`, `@`) as a
    formula, so a name like `=HYPERLINK(...)` would run in the reader's
    spreadsheet. A leading `'` makes the cell plain text again.
    """
    return f"'{value}" if value.startswith(FORMULA_PREFIXES) else value
