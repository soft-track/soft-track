"""Export the FastAPI app's OpenAPI schema to openapi.json without starting a server.

Run with:  python export_openapi.py

The frontend's Orval codegen (frontend/orval.config.ts) reads this file directly,
so re-run this (and `npm run generate:api` in frontend/) any time backend routes,
schemas, or models change.
"""

import json

from main import app

if __name__ == "__main__":
    with open("openapi.json", "w") as f:
        json.dump(app.openapi(), f, indent=2)
    print("Wrote openapi.json")
