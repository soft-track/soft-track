"""Application-wide plumbing: settings, the database engine, and the request session.

Mirrors the role `web.py` plays in the Educare backend -- everything that is
neither routing (`app_*`) nor business logic (`lib_*`) lives here.
"""

from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings
from sqlalchemy import inspect
from sqlmodel import Session, create_engine

# Published in this repository, so anyone can sign a token with it. Fine for
# local development, never acceptable on a host anyone else can reach.
DEV_SECRET_KEY = "dev-secret-key-change-me-in-production"


class Settings(BaseSettings):
    app_name: str = "SoftTrack"
    environment: str = "development"
    database_url: str = "sqlite:///./softtrack.db"
    secret_key: str = DEV_SECRET_KEY
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    class Config:
        env_file = ".env"

    @model_validator(mode="after")
    def _refuse_the_published_secret_in_production(self) -> "Settings":
        """Fail at startup rather than serve forgeable tokens.

        The default signing key is in this repository, so a deployment that
        never set SECRET_KEY can have any user's JWT forged by anyone who has
        read the source. Refusing to boot is noisy; the alternative is a
        service that looks healthy and is not.
        """
        if self.environment != "development" and self.secret_key == DEV_SECRET_KEY:
            raise ValueError(
                "SECRET_KEY is still the published development default while "
                f"ENVIRONMENT={self.environment!r}. Generate one with:\n"
                '  python -c "import secrets; print(secrets.token_urlsafe(48))"\n'
                "and set SECRET_KEY, or set ENVIRONMENT=development if this is "
                "a local machine."
            )
        return self


settings = Settings()

# SQLite needs check_same_thread disabled to be used across FastAPI's threadpool.
connect_args = {"check_same_thread": False} if "sqlite" in settings.database_url else {}
engine = create_engine(settings.database_url, echo=False, connect_args=connect_args)


# The first Alembic revision. Its output is exactly the schema that
# SQLModel.metadata.create_all used to produce, which is what lets an
# install that predates Alembic be adopted rather than rebuilt.
_BASELINE_REVISION = "e2b56dbe1777"


def _alembic_config():
    from alembic.config import Config

    here = Path(__file__).parent
    config = Config(str(here / "alembic.ini"))
    config.set_main_option("script_location", str(here / "alembic"))
    return config


def init_db() -> None:
    """Bring the database schema up to date.

    Runs `alembic upgrade head`, with one piece of care for existing installs.
    A database created before Alembic has all the tables but no
    `alembic_version` row, so a plain upgrade would try to CREATE TABLE over
    live tables and fail on boot. Detect that and stamp the baseline first, so
    upgrading SoftTrack adopts the existing database instead of breaking it.
    """
    from alembic import command

    config = _alembic_config()
    table_names = set(inspect(engine).get_table_names())

    if "alembic_version" not in table_names and "user" in table_names:
        # Pre-Alembic install: record that it is already at the baseline, then
        # let the upgrade below apply anything newer.
        command.stamp(config, _BASELINE_REVISION)

    command.upgrade(config, "head")


def get_session():
    """FastAPI dependency yielding a request-scoped database session."""
    with Session(engine) as session:
        yield session
