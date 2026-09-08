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

    # --- Accounts -------------------------------------------------------
    #: False locks the instance to invitations: /auth/register only accepts a
    #: registration whose email has a live invite waiting for it. The switch
    #: an internal instance wants on day one, when the sign-up form is
    #: otherwise reachable by anyone who can route to the host.
    open_registration: bool = True
    #: How long an invitation link stays usable. Long enough to survive a
    #: holiday, short enough that a link found in an old inbox is dead.
    invite_expire_days: int = 7

    # --- Attachments ---------------------------------------------------
    #: "local" (files under attachment_dir) or "s3" (any S3-compatible
    #: store). See lib_softtrack/storage.py.
    attachment_storage: str = "local"
    attachment_dir: str = "./attachments"
    #: Per file. Generous enough for a screen recording of a bug, small
    #: enough that one upload cannot fill a disk.
    attachment_max_bytes: int = 25 * 1024 * 1024
    attachment_s3_bucket: str = ""
    #: Set for MinIO, Ceph, R2 and the like; leave blank for AWS.
    attachment_s3_endpoint_url: str = ""
    attachment_s3_region: str = ""
    attachment_s3_prefix: str = ""

    # --- Integrations ---------------------------------------------------
    #: Where *this API* is reachable from the internet, used to build the
    #: webhook URLs shown on the integrations page. Distinct from
    #: `app_base_url` above, which is the frontend: GitHub posts to the API
    #: directly and never loads the browser app.
    #:
    #: Worth getting right rather than leaving: a webhook URL pointing at
    #: localhost is one that silently never fires, and the failure looks like
    #: "the integration does not work" rather than "the URL was wrong".
    api_base_url: str = "http://localhost:8000"

    # --- Notifications --------------------------------------------------
    #: Where this instance is reachable, used to build the issue links in a
    #: digest email. A mail whose links point at localhost is worse than no
    #: mail, so leaving this wrong is worth noticing.
    app_base_url: str = "http://localhost:5173"
    #: Blank disables email delivery entirely: no digest loop starts, and the
    #: per-user switch is hidden rather than offering something that cannot
    #: happen. Everything else about notifications works without it.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    #: STARTTLS on the port above. Set false only for a local relay.
    smtp_use_tls: bool = True
    email_from: str = "softtrack@localhost"
    #: How often the digest loop wakes up.
    digest_interval_minutes: int = 15
    #: How long a notification waits before it can be emailed. This is what
    #: makes it a digest rather than a mail per event: someone triaging a
    #: dozen issues generates one mail, not twelve.
    digest_delay_minutes: int = 10

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

    @model_validator(mode="after")
    def _require_a_bucket_for_s3_attachments(self) -> "Settings":
        """Fail at startup rather than on the first upload.

        A misconfigured store is not discovered until someone attaches a file,
        which in practice is days after the deploy and by then looks like a
        bug in the feature rather than a missing setting.
        """
        if self.attachment_storage == "s3" and not self.attachment_s3_bucket:
            raise ValueError("ATTACHMENT_STORAGE=s3 needs ATTACHMENT_S3_BUCKET set.")
        if self.attachment_storage not in ("local", "s3"):
            raise ValueError(
                f"ATTACHMENT_STORAGE={self.attachment_storage!r} is not one of "
                "'local' or 's3'."
            )
        return self

    @property
    def email_delivery_configured(self) -> bool:
        return bool(self.smtp_host)


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
