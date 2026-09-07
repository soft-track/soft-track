#!/usr/bin/env bash
# End-to-end smoke test against a running SoftTrack API.
#
# Usage:
#   uvicorn app.main:app --port 8000 &
#   ./smoke_test.sh
#
# Exercises: register -> login -> create team -> create project ->
# create label -> create issue -> patch issue status -> add comment ->
# list issues -> get issue -> attach a file -> delete the issue.
# Exits non-zero on the first failed assertion.

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
EMAIL="smoke-$(date +%s)@softtrack.dev"
PASSWORD="password123"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

echo "== health check =="
health=$(curl -sf "$BASE_URL/health")
[ "$(echo "$health" | jq -r .status)" = "ok" ] && pass "GET /health" || fail "GET /health"

echo "== register =="
register_resp=$(curl -sf -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"full_name\":\"Smoke Test\"}")
TOKEN=$(echo "$register_resp" | jq -r .access_token)
[ "$TOKEN" != "null" ] && [ -n "$TOKEN" ] && pass "POST /auth/register returned a token" || fail "register did not return a token"

AUTH_HEADER="Authorization: Bearer $TOKEN"

echo "== auth/me =="
me_resp=$(curl -sf "$BASE_URL/auth/me" -H "$AUTH_HEADER")
[ "$(echo "$me_resp" | jq -r .email)" = "$EMAIL" ] && pass "GET /auth/me matches registered email" || fail "GET /auth/me mismatch"

echo "== create team =="
TEAM_KEY="S$((RANDOM % 9000 + 1000))"
team_resp=$(curl -sf -X POST "$BASE_URL/teams" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Team\",\"key\":\"$TEAM_KEY\",\"description\":\"smoke test team\"}")
TEAM_ID=$(echo "$team_resp" | jq -r .id)
[ "$TEAM_ID" != "null" ] && pass "POST /teams created team $TEAM_ID ($TEAM_KEY)" || fail "team creation failed"

echo "== create project =="
project_resp=$(curl -sf -X POST "$BASE_URL/teams/$TEAM_ID/projects" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"name":"Smoke Project","description":"","color":"#6366f1"}')
PROJECT_ID=$(echo "$project_resp" | jq -r .id)
[ "$PROJECT_ID" != "null" ] && pass "POST /teams/$TEAM_ID/projects created project $PROJECT_ID" || fail "project creation failed"

echo "== create label =="
label_resp=$(curl -sf -X POST "$BASE_URL/teams/$TEAM_ID/labels" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"name":"Bug","color":"#ef4444"}')
LABEL_ID=$(echo "$label_resp" | jq -r .id)
[ "$LABEL_ID" != "null" ] && pass "POST /teams/$TEAM_ID/labels created label $LABEL_ID" || fail "label creation failed"

echo "== create issue =="
issue_resp=$(curl -sf -X POST "$BASE_URL/teams/$TEAM_ID/issues" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d "{\"title\":\"Smoke issue\",\"description\":\"created by smoke_test.sh\",\"project_id\":$PROJECT_ID,\"status\":\"todo\",\"priority\":\"high\",\"label_ids\":[$LABEL_ID]}")
ISSUE_ID=$(echo "$issue_resp" | jq -r .id)
IDENTIFIER=$(echo "$issue_resp" | jq -r .identifier)
[ "$IDENTIFIER" = "$TEAM_KEY-1" ] && pass "POST issue got identifier $IDENTIFIER" || fail "expected identifier $TEAM_KEY-1, got $IDENTIFIER"
[ "$(echo "$issue_resp" | jq -r '.labels | length')" = "1" ] && pass "issue has 1 label attached" || fail "issue label attachment failed"

echo "== patch issue status =="
patch_resp=$(curl -sf -X PATCH "$BASE_URL/issues/$ISSUE_ID" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}')
[ "$(echo "$patch_resp" | jq -r .status)" = "in_progress" ] && pass "PATCH /issues/$ISSUE_ID moved to in_progress" || fail "status patch failed"

echo "== add comment =="
comment_resp=$(curl -sf -X POST "$BASE_URL/issues/$ISSUE_ID/comments" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"body":"Looks good to me."}')
[ "$(echo "$comment_resp" | jq -r .body)" = "Looks good to me." ] && pass "POST comment stored correctly" || fail "comment body mismatch"

echo "== list issues (filtered by status) =="
list_resp=$(curl -sf "$BASE_URL/teams/$TEAM_ID/issues?status=in_progress" -H "$AUTH_HEADER")
# Collections are paginated: {"items": [...], "total": n, "limit": n, "offset": n}
[ "$(echo "$list_resp" | jq '.items | length')" = "1" ] && pass "GET issues filtered by status returns 1 issue" || fail "status filter returned wrong count"
[ "$(echo "$list_resp" | jq -r '.total')" = "1" ] && pass "the page reports total=1 for the filter" || fail "total did not match the filter"

echo "== pagination =="
page_resp=$(curl -sf "$BASE_URL/teams/$TEAM_ID/issues?limit=1&offset=0" -H "$AUTH_HEADER")
[ "$(echo "$page_resp" | jq -r '.limit')" = "1" ] && pass "limit is echoed in the envelope" || fail "limit not echoed"
capped=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/teams/$TEAM_ID/issues?limit=201" -H "$AUTH_HEADER")
[ "$capped" = "422" ] && pass "a limit above the maximum is rejected" || fail "limit cap not enforced (got $capped)"

echo "== comments are paginated too =="
comments_resp=$(curl -sf "$BASE_URL/issues/$ISSUE_ID/comments" -H "$AUTH_HEADER")
[ "$(echo "$comments_resp" | jq '.items | length')" = "1" ] && pass "GET comments returns the comment" || fail "comment list wrong"

echo "== get single issue =="
get_resp=$(curl -sf "$BASE_URL/issues/$ISSUE_ID" -H "$AUTH_HEADER")
[ "$(echo "$get_resp" | jq -r .title)" = "Smoke issue" ] && pass "GET /issues/$ISSUE_ID returns correct title" || fail "get issue mismatch"

echo "== attach a file =="
# A real PNG header, because the API checks that an image is the image it
# claims to be rather than trusting the upload's content type.
PNG_FILE=$(mktemp /tmp/softtrack-smoke-XXXXXX.png)
trap 'rm -f "$PNG_FILE"' EXIT
printf '\211PNG\r\n\032\n' > "$PNG_FILE"
head -c 64 /dev/zero >> "$PNG_FILE"

attach_resp=$(curl -sf -X POST "$BASE_URL/issues/$ISSUE_ID/attachments" \
  -H "$AUTH_HEADER" -F "file=@$PNG_FILE;type=image/png")
ATTACHMENT_ID=$(echo "$attach_resp" | jq -r .id)
[ "$ATTACHMENT_ID" != "null" ] && pass "POST attachment created $ATTACHMENT_ID" || fail "attachment upload failed"
[ "$(echo "$attach_resp" | jq -r .content_type)" = "image/png" ] && pass "served type derived from the name" || fail "content type wrong"

echo "== download it back =="
downloaded=$(mktemp)
content_type=$(curl -sf -o "$downloaded" -w "%{content_type}" \
  "$BASE_URL/attachments/$ATTACHMENT_ID/content" -H "$AUTH_HEADER")
cmp -s "$PNG_FILE" "$downloaded" && pass "the bytes come back unchanged" || fail "downloaded bytes differ"
[ "${content_type%%;*}" = "image/png" ] && pass "GET content is served as image/png" || fail "served as $content_type"
rm -f "$downloaded"

echo "== a type that is not on the allowlist =="
BAD_FILE=$(mktemp /tmp/softtrack-smoke-XXXXXX.html)
echo '<script>alert(1)</script>' > "$BAD_FILE"
bad_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/issues/$ISSUE_ID/attachments" \
  -H "$AUTH_HEADER" -F "file=@$BAD_FILE;type=image/png")
rm -f "$BAD_FILE"
[ "$bad_code" = "415" ] && pass "an .html upload is refused with 415" || fail "expected 415, got $bad_code"

echo "== deleting an issue that has a label, a comment and an attachment =="
del_code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/issues/$ISSUE_ID" -H "$AUTH_HEADER")
[ "$del_code" = "204" ] && pass "DELETE removes the issue and its dependent rows" || fail "delete returned $del_code"

gone_code=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/attachments/$ATTACHMENT_ID/content" -H "$AUTH_HEADER")
[ "$gone_code" = "404" ] && pass "the attachment went with the issue" || fail "attachment still readable ($gone_code)"


echo ""
echo "All smoke tests passed."
