# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the server

```bash
cd server
node server.js
# or, in production via PM2:
pm2 start ecosystem.config.js
```

The server runs on port `5000` by default (`process.env.PORT`). The client is served as static files from `../client` — there is no build step. Open any `.html` file directly via the dev server or `http://localhost:5000`.

## Required environment variables (`server/.env`)

```
DATABASE_URL=postgres://...
DATABASE_SSL=true
GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
PORT=5000
```

`client/firebase-config.js` (gitignored) must also exist — copy from `client/firebase-config.example.js`.

## Architecture

**No build step.** The frontend is plain HTML/CSS/JS files in `client/`. `server/server.js` serves them as static files. All pages are self-contained `.html` files with inline `<script>` blocks.

**Two databases in parallel:**
- **PostgreSQL** (via `pg` pool) — all records, revisions, admin actions. Accessed through `server/models/db.js` which exports `{ pool, query }`. Use `db.query()` for simple queries and `db.pool.connect()` for transactions.
- **Firebase Firestore** — user accounts, profiles, bios, auth. User identity (UID → username) is resolved in `requireAuth` by looking up Firestore on every authenticated request.

**Auth flow:**
1. Client gets a Firebase ID token and sends it as `Authorization: Bearer <token>`.
2. `requireAuth` middleware verifies it with Firebase Admin SDK, fetches the user's Firestore doc to resolve their `username`, and attaches `req.user = { uid, email, username, isAdmin, role }`.
3. `requireAdmin` wraps `requireAuth` and additionally checks `req.user.isAdmin === true` (Firebase custom claim) or `req.user.role === 'admin'` (Firestore field).

**PostgreSQL schema key tables:**
- `submissions` — primary records table. Geometry stored as PostGIS `Point(4326)`. Fields: `caption, source, photographer, photo_url, geom, status, year, month, day, estimated, location, notes, deleted, user_id, location_confidence, direction`.
- `submission_revisions` — full-snapshot revision history. `revision_number = 0` is the original state; subsequent numbers are edits. Always stores full field snapshots, not diffs.
- `admin_actions` — audit log for approve/reject/delete actions.
- `status` values: `'pending'`, `'approved'`, `'rejected'`. Soft-delete via `deleted = TRUE`.

**Geospatial:** PostGIS is required. Coordinates read out as `ST_X(geom) AS lng, ST_Y(geom) AS lat`. Written as `ST_SetSRID(ST_MakePoint($lng, $lat), 4326)` — note longitude is first in `ST_MakePoint`.

**Photo storage:** DigitalOcean Spaces (S3-compatible). Upload logic is in `server/middleware/upload.js` and `server/services/spaces.js`. Photos are never re-uploaded on edit — `photo_url` is immutable after submission.

**Route layout:**
- `POST /api/submissions/submit` — new record (requireAuth + multer upload)
- `POST /api/submissions/:id/edit` — edit record, auto-creates revision 0 snapshot on first edit
- `GET /api/submissions/approved` — all public records
- `GET /api/submissions/:id/revisions` — revision history
- `GET /api/submissions/recent-activity` — combined submissions + edits feed
- `GET/POST /api/user/*` — user profiles (mix of Firestore + Postgres)
- `GET /api/admin/actions` — admin audit log

**`direction` field:** Integer 0–359 (camera bearing, 0 = North). Optional; `null` when not set. Validated server-side as `>= 0 && <= 359`. Snaps to cardinal directions (0/90/180/270) within 5° on the client compass dial.

**`location_confidence`:** Enum `'exact' | 'high' | 'mid' | 'low'`. Validated server-side via `VALID_CONFIDENCE` Set.
