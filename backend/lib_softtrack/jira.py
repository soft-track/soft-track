"""Reading a Jira export.

Pure parsing and mapping -- nothing here touches the database, which is what
makes a dry run trustworthy: the same function produces the preview and the
thing that is then written.

The one piece of real Jira knowledge in here is how its CSV export handles
multi-valued fields, and it is the detail that breaks naive importers. Jira
does not put a list in one cell. It **repeats the column**:

    Summary,Labels,Labels,Comment,Comment
    Fix login,backend,urgent,"...","..."

`csv.DictReader` maps a row to a dict, so every repeat but the last is lost --
an issue with four labels and six comments silently imports with one of each.
`_rows` reads the header positionally instead and groups repeats into lists.
"""

import csv
import io
import json
from datetime import datetime
from typing import Any, Iterable, Optional

from lib_softtrack.models.imports import ParsedComment, ParsedIssue
from lib_softtrack.tables import IssuePriority, StatusCategory

#: Jira's default workflow statuses, plus the ones teams most often add,
#: mapped to what they *mean*. Matched case-insensitively after stripping, so
#: "In Progress" and "in progress" both land.
#:
#: Categories rather than statuses, because the parser has no team in front of
#: it and therefore no board to name a column on. The importer resolves one of
#: these to an actual column, preferring a status the team already calls by
#: the same name -- see `_status_for` in importer.py.
STATUS_MAP: dict[str, StatusCategory] = {
    "backlog": StatusCategory.backlog,
    "to do": StatusCategory.unstarted,
    "todo": StatusCategory.unstarted,
    "open": StatusCategory.unstarted,
    "selected for development": StatusCategory.unstarted,
    "in progress": StatusCategory.started,
    "in development": StatusCategory.started,
    "in review": StatusCategory.started,
    "code review": StatusCategory.started,
    "in qa": StatusCategory.started,
    "review": StatusCategory.started,
    "done": StatusCategory.done,
    "closed": StatusCategory.done,
    "resolved": StatusCategory.done,
    "complete": StatusCategory.done,
    "completed": StatusCategory.done,
    "cancelled": StatusCategory.cancelled,
    "canceled": StatusCategory.cancelled,
    "won't do": StatusCategory.cancelled,
    "wont do": StatusCategory.cancelled,
    "duplicate": StatusCategory.cancelled,
    "rejected": StatusCategory.cancelled,
}

PRIORITY_MAP: dict[str, IssuePriority] = {
    "highest": IssuePriority.urgent,
    "blocker": IssuePriority.urgent,
    "critical": IssuePriority.urgent,
    "urgent": IssuePriority.urgent,
    "high": IssuePriority.high,
    "major": IssuePriority.high,
    "medium": IssuePriority.medium,
    "normal": IssuePriority.medium,
    "low": IssuePriority.low,
    "minor": IssuePriority.low,
    "lowest": IssuePriority.low,
    "trivial": IssuePriority.low,
}

#: An unmapped status becomes backlog rather than being dropped. Losing an
#: issue is far worse than putting it in the wrong column, and the report says
#: which statuses fell back so they can be fixed in bulk afterwards.
STATUS_FALLBACK = StatusCategory.backlog
PRIORITY_FALLBACK = IssuePriority.no_priority

_LABEL_HEADERS = {"labels", "label"}
_COMMENT_HEADERS = {"comment", "comments"}


class JiraParseError(ValueError):
    """The file could not be read as a Jira export."""


def map_status(raw: Optional[str]) -> tuple[StatusCategory, Optional[str]]:
    """Return the mapped status, and the raw value if it had no mapping."""
    if not raw:
        return STATUS_FALLBACK, None
    mapped = STATUS_MAP.get(raw.strip().lower())
    return (mapped, None) if mapped else (STATUS_FALLBACK, raw.strip())


def map_priority(raw: Optional[str]) -> tuple[IssuePriority, Optional[str]]:
    if not raw:
        return PRIORITY_FALLBACK, None
    mapped = PRIORITY_MAP.get(raw.strip().lower())
    return (mapped, None) if mapped else (PRIORITY_FALLBACK, raw.strip())


def _parse_datetime(raw: Optional[str]) -> Optional[datetime]:
    """Jira exports dates in several shapes depending on account settings."""
    if not raw:
        return None
    text = raw.strip()
    for pattern in (
        "%d/%b/%y %I:%M %p",  # 14/Mar/24 3:07 PM  -- Jira Cloud CSV default
        "%d/%b/%Y %I:%M %p",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        # A date we cannot read is not worth failing an import over; the
        # issue still imports, it just carries today's timestamps.
        return None


def _rows(text: str) -> list[dict[str, list[str]]]:
    """Parse CSV, keeping every value of a repeated column.

    Returns each row as {header: [values]} -- always a list, so callers never
    have to care whether a given export repeated the column or not.
    """
    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        raise JiraParseError("The file is empty.")

    keys = [column.strip().lower() for column in header]
    rows = []
    for record in reader:
        if not any(cell.strip() for cell in record):
            continue
        grouped: dict[str, list[str]] = {}
        for key, value in zip(keys, record):
            if value is None or not value.strip():
                continue
            grouped.setdefault(key, []).append(value.strip())
        rows.append(grouped)
    return rows


def _first(row: dict[str, list[str]], *names: str) -> Optional[str]:
    for name in names:
        values = row.get(name)
        if values:
            return values[0]
    return None


def _all(row: dict[str, list[str]], names: Iterable[str]) -> list[str]:
    collected: list[str] = []
    for name in names:
        collected.extend(row.get(name, []))
    return collected


def parse_csv(text: str) -> list[ParsedIssue]:
    rows = _rows(text)
    if not rows:
        raise JiraParseError("The file has a header but no issues.")

    if not any("summary" in row for row in rows):
        raise JiraParseError(
            "No 'Summary' column found. This does not look like a Jira issue "
            "export -- check you exported issues rather than a board or a filter."
        )

    issues = []
    for row in rows:
        summary = _first(row, "summary")
        if not summary:
            continue

        status, unmapped_status = map_status(_first(row, "status"))
        priority, unmapped_priority = map_priority(_first(row, "priority"))

        issues.append(
            ParsedIssue(
                external_key=_first(row, "issue key", "key"),
                title=summary,
                description=_first(row, "description"),
                status=status,
                priority=priority,
                raw_status=unmapped_status,
                raw_priority=unmapped_priority,
                assignee=_first(row, "assignee"),
                reporter=_first(row, "reporter", "creator"),
                labels=_all(row, _LABEL_HEADERS),
                epic=_first(
                    row,
                    "custom field (epic link)",
                    "epic link",
                    "epic name",
                    "parent summary",
                    "parent",
                ),
                created_at=_parse_datetime(_first(row, "created")),
                updated_at=_parse_datetime(_first(row, "updated")),
                comments=[
                    _parse_csv_comment(value) for value in _all(row, _COMMENT_HEADERS)
                ],
            )
        )
    return issues


def _parse_csv_comment(value: str) -> ParsedComment:
    """Jira packs a comment into one cell as `date;author;body`.

    The body itself can contain semicolons, so only the first two separators
    are treated as structure -- splitting on every one truncates every comment
    that mentions a time or a list.
    """
    parts = value.split(";", 2)
    if len(parts) == 3:
        when, author, body = parts
        return ParsedComment(
            body=body.strip(),
            author=author.strip() or None,
            created_at=_parse_datetime(when),
        )
    return ParsedComment(body=value.strip())


def parse_json(text: str) -> list[ParsedIssue]:
    try:
        data: Any = json.loads(text)
    except json.JSONDecodeError as error:
        raise JiraParseError(f"That is not valid JSON: {error.msg}.")

    # Jira's own export nests issues under projects; a filter export is a bare
    # list; and some tools wrap them in {"issues": [...]}. Accept all three.
    if isinstance(data, dict) and "projects" in data:
        raw_issues = [
            issue
            for project in data.get("projects") or []
            for issue in project.get("issues") or []
        ]
    elif isinstance(data, dict) and "issues" in data:
        raw_issues = data.get("issues") or []
    elif isinstance(data, list):
        raw_issues = data
    else:
        raise JiraParseError(
            "Expected a list of issues, or an object with 'issues' or 'projects'."
        )

    issues = []
    for raw in raw_issues:
        if not isinstance(raw, dict):
            continue
        fields = raw.get("fields") if isinstance(raw.get("fields"), dict) else raw
        summary = fields.get("summary") or fields.get("title")
        if not summary:
            continue

        status, unmapped_status = map_status(_name_of(fields.get("status")))
        priority, unmapped_priority = map_priority(_name_of(fields.get("priority")))

        issues.append(
            ParsedIssue(
                external_key=raw.get("key") or fields.get("key"),
                title=str(summary),
                description=_text_of(fields.get("description")),
                status=status,
                priority=priority,
                raw_status=unmapped_status,
                raw_priority=unmapped_priority,
                assignee=_person(fields.get("assignee")),
                reporter=_person(fields.get("reporter") or fields.get("creator")),
                labels=[str(label) for label in (fields.get("labels") or [])],
                epic=_name_of(fields.get("epic")) or fields.get("epicLink"),
                created_at=_parse_datetime(fields.get("created")),
                updated_at=_parse_datetime(fields.get("updated")),
                comments=_json_comments(
                    fields.get("comment") or fields.get("comments")
                ),
            )
        )
    return issues


def _name_of(value: Any) -> Optional[str]:
    if isinstance(value, dict):
        return value.get("name") or value.get("value")
    return str(value) if value else None


def _person(value: Any) -> Optional[str]:
    """Prefer an email address, since that is what users are matched on."""
    if isinstance(value, dict):
        return (
            value.get("emailAddress")
            or value.get("email")
            or value.get("displayName")
            or value.get("name")
        )
    return str(value) if value else None


def _text_of(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    # Jira Cloud's newer API returns rich text as an Atlassian Document
    # Format tree. Flattening the text nodes keeps the words rather than
    # importing a JSON blob as the description.
    if isinstance(value, dict):
        collected: list[str] = []

        def walk(node: Any) -> None:
            if isinstance(node, dict):
                if node.get("type") == "text" and node.get("text"):
                    collected.append(node["text"])
                for child in node.get("content") or []:
                    walk(child)
                if node.get("type") in {"paragraph", "heading"}:
                    collected.append("\n\n")
            elif isinstance(node, list):
                for child in node:
                    walk(child)

        walk(value)
        return "".join(collected).strip() or None
    return str(value)


def _json_comments(value: Any) -> list[ParsedComment]:
    if isinstance(value, dict):
        value = value.get("comments") or []
    if not isinstance(value, list):
        return []

    comments = []
    for raw in value:
        if isinstance(raw, str):
            comments.append(ParsedComment(body=raw))
            continue
        if not isinstance(raw, dict):
            continue
        body = _text_of(raw.get("body")) or raw.get("text")
        if not body:
            continue
        comments.append(
            ParsedComment(
                body=body,
                author=_person(raw.get("author")),
                created_at=_parse_datetime(raw.get("created")),
            )
        )
    return comments


def parse(filename: str, text: str) -> list[ParsedIssue]:
    """Parse by extension, falling back to sniffing the content."""
    lowered = (filename or "").lower()
    if lowered.endswith(".json"):
        return parse_json(text)
    if lowered.endswith(".csv"):
        return parse_csv(text)
    return parse_json(text) if text.lstrip()[:1] in "[{" else parse_csv(text)
