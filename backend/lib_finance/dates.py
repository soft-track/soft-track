"""The day, as finance reads it."""

from datetime import date

from lib_softtrack.tables import utcnow


def today() -> date:
    """Today in UTC: the day a record takes effect, a claim is checked
    against, a period is read on. The instance's day, not the viewer's."""
    return utcnow().date()
