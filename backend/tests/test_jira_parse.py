"""Reading a Jira export (issue #11).

Pure parsing, no database. The fixtures here are the shapes Jira actually
produces, which are stranger than they look.
"""

import json

import pytest

from lib_softtrack.jira import (
    JiraParseError,
    map_priority,
    map_status,
    parse,
    parse_csv,
)
from lib_softtrack.tables import IssuePriority, IssueStatus

# --- the repeated-column trap -------------------------------------------


def test_repeated_columns_keep_every_value():
    """Jira does not put a list in one cell -- it repeats the column.

    csv.DictReader keeps only the last of each, so an issue with four labels
    and two comments imports with one of each. This is the single most
    damaging thing a naive Jira importer gets wrong.
    """
    csv = (
        "Issue key,Summary,Labels,Labels,Labels,Comment,Comment\n"
        "PROJ-1,Fix login,backend,urgent,security,"
        '"12/Mar/24 9:00 AM;ada@x.com;First thought",'
        '"13/Mar/24 9:00 AM;grace@x.com;Second thought"\n'
    )
    issue = parse_csv(csv)[0]

    assert issue.labels == ["backend", "urgent", "security"]
    assert [c.body for c in issue.comments] == ["First thought", "Second thought"]


def test_a_comment_body_may_contain_semicolons():
    """Splitting on every `;` truncates any comment that mentions a time or
    lists things."""
    csv = (
        "Summary,Comment\n"
        'Fix,"12/Mar/24 9:00 AM;ada@x.com;Deploy at 9;30; then check logs"\n'
    )
    comment = parse_csv(csv)[0].comments[0]
    assert comment.body == "Deploy at 9;30; then check logs"
    assert comment.author == "ada@x.com"


def test_empty_repeats_are_not_imported_as_blank_labels():
    csv = "Summary,Labels,Labels,Labels\nFix,backend,,\n"
    assert parse_csv(csv)[0].labels == ["backend"]


# --- fields -------------------------------------------------------------


def test_core_fields_are_read():
    csv = (
        "Issue key,Summary,Description,Status,Priority,Assignee,Reporter,Created\n"
        "PROJ-7,Fix login,It breaks,In Progress,High,ada@x.com,grace@x.com,"
        "14/Mar/24 3:07 PM\n"
    )
    issue = parse_csv(csv)[0]

    assert issue.external_key == "PROJ-7"
    assert issue.title == "Fix login"
    assert issue.description == "It breaks"
    assert issue.status is IssueStatus.in_progress
    assert issue.priority is IssuePriority.high
    assert issue.assignee == "ada@x.com"
    assert issue.reporter == "grace@x.com"
    assert issue.created_at is not None and issue.created_at.year == 2024


def test_headers_are_matched_case_insensitively():
    assert parse_csv("SUMMARY,STATUS\nFix,Done\n")[0].status is IssueStatus.done


def test_an_epic_becomes_a_project():
    csv = "Summary,Custom field (Epic Link)\nFix,Checkout revamp\n"
    assert parse_csv(csv)[0].epic == "Checkout revamp"


def test_rows_without_a_summary_are_skipped():
    csv = "Issue key,Summary\nPROJ-1,Fix\nPROJ-2,\n"
    assert len(parse_csv(csv)) == 1


def test_blank_rows_are_skipped():
    assert len(parse_csv("Summary\nFix\n\n\n")) == 1


# --- mapping ------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("To Do", IssueStatus.todo),
        ("in progress", IssueStatus.in_progress),
        ("Code Review", IssueStatus.in_review),
        ("Done", IssueStatus.done),
        ("Won't Do", IssueStatus.cancelled),
    ],
)
def test_known_statuses_map(raw, expected):
    assert map_status(raw)[0] is expected


def test_an_unknown_status_falls_back_and_is_reported():
    """Losing an issue is far worse than putting it in the wrong column."""
    status, unmapped = map_status("Awaiting Legal Sign-off")
    assert status is IssueStatus.backlog
    assert unmapped == "Awaiting Legal Sign-off"


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Highest", IssuePriority.urgent),
        ("Blocker", IssuePriority.urgent),
        ("Medium", IssuePriority.medium),
        ("Lowest", IssuePriority.low),
    ],
)
def test_known_priorities_map(raw, expected):
    assert map_priority(raw)[0] is expected


def test_a_missing_priority_is_not_reported_as_unmapped():
    """An absent value is not a mapping failure, and reporting it as one
    would bury the ones that matter."""
    priority, unmapped = map_priority("")
    assert priority is IssuePriority.no_priority
    assert unmapped is None


# --- JSON ---------------------------------------------------------------


def test_json_issues_are_read():
    payload = json.dumps(
        {
            "issues": [
                {
                    "key": "PROJ-9",
                    "fields": {
                        "summary": "Fix login",
                        "status": {"name": "Done"},
                        "priority": {"name": "High"},
                        "assignee": {"emailAddress": "ada@x.com"},
                        "labels": ["backend", "urgent"],
                    },
                }
            ]
        }
    )
    issue = parse("export.json", payload)[0]
    assert issue.external_key == "PROJ-9"
    assert issue.status is IssueStatus.done
    assert issue.assignee == "ada@x.com"
    assert issue.labels == ["backend", "urgent"]


def test_json_nested_under_projects_is_read():
    payload = json.dumps(
        {"projects": [{"key": "PROJ", "issues": [{"fields": {"summary": "Fix"}}]}]}
    )
    assert parse("export.json", payload)[0].title == "Fix"


def test_a_bare_json_list_is_read():
    assert parse("export.json", json.dumps([{"summary": "Fix"}]))[0].title == "Fix"


def test_rich_text_descriptions_are_flattened_to_words():
    """Jira Cloud returns rich text as a document tree. Storing the tree would
    put a JSON blob in the description."""
    payload = json.dumps(
        [
            {
                "summary": "Fix",
                "description": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "The login breaks."}],
                        }
                    ],
                },
            }
        ]
    )
    assert parse("export.json", payload)[0].description == "The login breaks."


def test_an_email_is_preferred_over_a_display_name():
    """Email is the only identifier that is actually stable."""
    payload = json.dumps(
        [
            {
                "summary": "Fix",
                "assignee": {"displayName": "Ada", "emailAddress": "ada@x.com"},
            }
        ]
    )
    assert parse("export.json", payload)[0].assignee == "ada@x.com"


# --- refusals -----------------------------------------------------------


def test_a_file_that_is_not_an_issue_export_says_so():
    with pytest.raises(JiraParseError, match="Summary"):
        parse_csv("Board,Column\nMain,To Do\n")


def test_an_empty_file_is_refused():
    with pytest.raises(JiraParseError, match="empty"):
        parse_csv("")


def test_invalid_json_is_refused_with_the_reason():
    with pytest.raises(JiraParseError, match="not valid JSON"):
        parse("export.json", "{oops")


def test_the_format_is_sniffed_when_the_name_does_not_say():
    assert parse("export", '[{"summary": "Fix"}]')[0].title == "Fix"
    assert parse("export", "Summary\nFix\n")[0].title == "Fix"


def test_an_unreadable_date_does_not_fail_the_import():
    """The issue still imports; it just carries today's timestamps."""
    issue = parse_csv("Summary,Created\nFix,sometime last Tuesday\n")[0]
    assert issue.title == "Fix"
    assert issue.created_at is None
