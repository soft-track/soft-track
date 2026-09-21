"""The startup guard on the signing key.

The default SECRET_KEY is published in this repository, so a deployment that
never set one can have any user's JWT forged by anyone who reads the source.
The app refuses to boot in that combination rather than serving forgeable
tokens while looking healthy.
"""

import pytest
from pydantic import ValidationError

from web import DEV_SECRET_KEY, Settings


def test_the_development_default_is_allowed_in_development():
    settings = Settings(environment="development", secret_key=DEV_SECRET_KEY)
    assert settings.secret_key == DEV_SECRET_KEY


@pytest.mark.parametrize("environment", ["production", "staging"])
def test_the_development_default_is_refused_outside_development(environment):
    with pytest.raises(ValidationError) as exc:
        Settings(environment=environment, secret_key=DEV_SECRET_KEY)
    message = str(exc.value)
    # the error has to say what to do, not just that something is wrong
    assert "SECRET_KEY" in message
    assert "secrets.token_urlsafe" in message


def test_a_real_secret_is_accepted_in_production():
    settings = Settings(environment="production", secret_key="a-real-secret-value")
    assert settings.environment == "production"


def test_the_guard_only_rejects_the_published_default():
    """A secret that merely looks similar must still be accepted."""
    settings = Settings(
        environment="production", secret_key=DEV_SECRET_KEY + "-but-changed"
    )
    assert settings.secret_key != DEV_SECRET_KEY


@pytest.mark.parametrize("environment", ["demo", "development"])
def test_the_seeded_demo_password_may_be_shown_where_it_is_seeded(environment):
    """Both environments are seeded by seed.py with the same account."""
    settings = Settings(environment=environment, secret_key="a-real-secret-value")
    assert settings.demo_credentials_are_public is True


@pytest.mark.parametrize("environment", ["production", "staging"])
def test_the_seeded_demo_password_is_not_shown_on_a_real_instance(environment):
    settings = Settings(environment=environment, secret_key="a-real-secret-value")
    assert settings.demo_credentials_are_public is False
