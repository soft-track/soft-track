from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app_identity.identity import router as identity_router
from lib_identity.identity import warm_password_hasher
from app_softtrack.comments import router as comments_router
from app_softtrack.cycles import router as cycles_router
from app_softtrack.issues import router as issues_router
from app_softtrack.labels import router as labels_router
from app_softtrack.projects import router as projects_router
from app_softtrack.search import router as search_router
from app_softtrack.teams import router as teams_router
from web import init_db, settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown. Replaces the deprecated @app.on_event hooks."""
    init_db()
    # Pay for the decoy hash now rather than on the first sign-in attempt at
    # an unknown address, which would otherwise be measurably slower than
    # every one after it -- a one-shot version of the oracle we just closed.
    warm_password_hasher()
    yield


app = FastAPI(
    title=settings.app_name,
    description="An open-source, self-hostable issue tracker inspired by Linear.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(identity_router)
app.include_router(teams_router)
app.include_router(projects_router)
app.include_router(labels_router)
app.include_router(issues_router)
app.include_router(comments_router)
app.include_router(cycles_router)
app.include_router(search_router)


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}
