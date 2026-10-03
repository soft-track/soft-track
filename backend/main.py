import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware

from app_finance.budgets import router as budgets_router
from app_finance.compensation import router as compensation_router
from app_finance.currencies import router as currencies_router
from app_finance.expenses import finance as expense_claims_router
from app_finance.expenses import router as expenses_router
from app_finance.payroll import router as payroll_router
from app_finance.reimbursements import router as reimbursements_router
from app_finance.reports import router as finance_reports_router
from app_identity.admin import router as admin_router
from app_identity.departments import router as departments_router
from app_identity.identity import router as identity_router
from app_identity.oauth import router as oauth_router
from app_identity.people import router as people_router
from lib_identity.identity import warm_password_hasher
from lib_softtrack import outside, realtime, trash
from lib_softtrack.deleting import trash_loop
from lib_softtrack.digest import digest_loop
from lib_softtrack.outbound import webhook_loop
from lib_utils.viewer import ViewerScope
from app_softtrack.attachments import router as attachments_router
from app_softtrack.automations import router as automations_router
from app_softtrack.comments import router as comments_router
from app_softtrack.custom_fields import router as custom_fields_router
from app_softtrack.sprints import router as sprints_router
from app_softtrack.events import router as events_router
from app_softtrack.imports import router as imports_router
from app_softtrack.integrations import router as integrations_router
from app_softtrack.invites import router as invites_router
from app_softtrack.tickets import router as tickets_router
from app_softtrack.labels import router as labels_router
from app_softtrack.notifications import router as notifications_router
from app_softtrack.outbound import router as outbound_router
from app_softtrack.projects import router as projects_router
from app_softtrack.reports import router as reports_router
from app_softtrack.search import router as search_router
from app_softtrack.statuses import router as statuses_router
from app_softtrack.teams import router as teams_router
from app_softtrack.templates import router as templates_router
from app_softtrack.trash import router as trash_router
from app_softtrack.webhooks import router as webhooks_router
from app_softtrack.worklogs import router as worklogs_router
from app_softtrack.workload import router as workload_router
from app_softtrack.views import router as views_router
from lib_utils.errors import ApiError, ApiErrorBody, ErrorCode, api_error_handler
from web import init_db, settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown. Replaces the deprecated @app.on_event hooks."""
    init_db()
    # Pay for the decoy hash now rather than on the first sign-in attempt at
    # an unknown address, which would otherwise be measurably slower than
    # every one after it -- a one-shot version of the oracle we just closed.
    warm_password_hasher()

    # The digest only runs where there is somewhere to send it. On an instance
    # with no SMTP host the in-app inbox is the whole feature, and starting a
    # loop that can only ever drop its output would be noise in the logs and
    # a wakeup every quarter of an hour for nothing.
    digest: asyncio.Task | None = None
    if settings.email_delivery_configured:
        digest = asyncio.create_task(digest_loop())
        # "uvicorn.error" rather than a module logger: uvicorn configures its
        # own loggers and leaves the root alone, so an INFO line anywhere else
        # is swallowed by the last-resort handler's WARNING threshold. This is
        # the one line that tells an operator their SMTP settings took effect,
        # so it has to actually appear.
        logging.getLogger("uvicorn.error").info(
            "Notification digests every %s minutes via %s",
            settings.digest_interval_minutes,
            settings.smtp_host,
        )

    # Outbound webhooks (#91): the outbox is sent from here, off any request.
    webhooks: asyncio.Task | None = None
    if settings.webhook_delivery:
        webhooks = asyncio.create_task(webhook_loop())

    # The trash (#323) is purged of what has been there long enough.
    purging: asyncio.Task | None = None
    if settings.trash_purging:
        purging = asyncio.create_task(trash_loop())

    yield

    if digest is not None:
        digest.cancel()
    if webhooks is not None:
        webhooks.cancel()
    if purging is not None:
        purging.cancel()


# Real-time nudges (#103) are published from the ORM's own commit events, so
# they are switched on once, here, for every session the app opens.
realtime.install()
# And the trash (#323) is kept out of every query the same way.
trash.install()
# And an account from outside sees only its epics (#243), the same way again.
outside.install()

app = FastAPI(
    title=settings.app_name,
    description="An open-source, self-hostable ticket tracker inspired by Linear.",
    version="0.1.0",
    lifespan=lifespan,
)

# Errors raised with a code keep FastAPI's body and add the code to it (#86).
app.add_exception_handler(ApiError, api_error_handler)


def _openapi_with_error_codes():
    """The schema, plus the error body and its codes.

    No route declares the error body as a response -- every route would have
    to, and they would say the same thing -- so it is added here once. That
    is what puts `ErrorCode` in the generated frontend client as a type.
    """
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )
    extra = ApiErrorBody.model_json_schema(ref_template="#/components/schemas/{model}")
    components = schema.setdefault("components", {}).setdefault("schemas", {})
    components.update(extra.pop("$defs", {}))
    components["ApiErrorBody"] = extra
    assert "ErrorCode" in components, ErrorCode
    app.openapi_schema = schema
    return schema


app.openapi = _openapi_with_error_codes

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Who is asking, for the people in a response (#317): see lib_utils/viewer.py.
app.add_middleware(ViewerScope)


app.include_router(identity_router)
app.include_router(oauth_router)
app.include_router(admin_router)
app.include_router(departments_router)
app.include_router(people_router)
app.include_router(teams_router)
app.include_router(invites_router)
app.include_router(projects_router)
app.include_router(labels_router)
app.include_router(tickets_router)
app.include_router(comments_router)
app.include_router(attachments_router)
app.include_router(sprints_router)
app.include_router(reports_router)
app.include_router(imports_router)
app.include_router(search_router)
app.include_router(notifications_router)
app.include_router(views_router)
app.include_router(templates_router)
app.include_router(trash_router)
app.include_router(custom_fields_router)
app.include_router(worklogs_router)
app.include_router(workload_router)
app.include_router(events_router)
app.include_router(statuses_router)
app.include_router(automations_router)
app.include_router(integrations_router)
app.include_router(webhooks_router)
app.include_router(outbound_router)
app.include_router(currencies_router)
app.include_router(compensation_router)
app.include_router(payroll_router)
app.include_router(expenses_router)
app.include_router(expense_claims_router)
app.include_router(reimbursements_router)
app.include_router(budgets_router)
app.include_router(finance_reports_router)


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}
