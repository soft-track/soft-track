FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first: this layer is cached and only rebuilds when
# requirements.txt changes, not on every source edit.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Fallback for running this image on its own (`docker run`). docker compose
# overrides it to point at the Postgres service.
ENV DATABASE_URL=sqlite:////data/softtrack.db
# Attachment bytes live on the filesystem rather than in the database. Under
# /data so one volume mount keeps them, and so an image run without a volume
# still works instead of failing on the first upload.
ENV ATTACHMENT_DIR=/data/attachments
RUN mkdir -p /data/attachments

EXPOSE 8000

# seed.py is idempotent -- it returns early if the demo user already exists --
# so running it on every start is safe and gives a first-run database with
# demo data instead of an empty one.
CMD ["sh", "-c", "python seed.py && uvicorn main:app --host 0.0.0.0 --port 8000"]
