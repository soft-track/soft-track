"""HTTP byte ranges (RFC 9110 section 14), the one shape SoftTrack serves.

Only a single range is honoured. That covers what anything here asks for --
"the first megabyte", for a preview (#101) -- and a multi-range request may
legitimately be answered with the whole body instead, which is what a
request this cannot parse gets.
"""

import re
from typing import Optional

from lib_utils.errors import ErrorCode, api_error

_SINGLE = re.compile(r"^bytes=(\d*)-(\d*)$")


def parse_range(header: Optional[str], size: int) -> Optional[tuple[int, int]]:
    """The `(start, end)` a Range header asks for, inclusive, or None for all.

    None -- serve everything -- for no header, one this does not understand,
    or several ranges. A range that starts past the end is a 416, which is
    the one answer the spec requires rather than permits.
    """
    if not header:
        return None
    match = _SINGLE.match(header.strip())
    if not match:
        return None
    first, last = match.groups()
    if not first and not last:
        return None

    if not first:
        # A suffix range: the last N bytes.
        length = int(last)
        if length == 0:
            raise _unsatisfiable(size)
        return max(size - length, 0), size - 1

    start = int(first)
    if start >= size:
        raise _unsatisfiable(size)
    end = min(int(last), size - 1) if last else size - 1
    if end < start:
        return None
    return start, end


def _unsatisfiable(size: int):
    return api_error(
        status_code=416,
        code=ErrorCode.range_not_satisfiable,
        detail="That range is outside the file.",
        headers={"Content-Range": f"bytes */{size}"},
    )
