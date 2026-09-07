"""A pagination envelope.

Returned instead of a bare array by the collections that can grow without
bound. `total` is the number of rows matching the filters, not the number in
`items`, so a UI can render "showing 50 of 1,204" and build page controls
without a second request.
"""

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")

# Defaults live here so the routers, the OpenAPI schema and the docs cannot
# drift apart. The maximum is a guard, not a suggestion: without it a caller
# can ask for the whole table and undo the point of paginating.
DEFAULT_LIMIT = 50
MAX_LIMIT = 200


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int
