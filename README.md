# File Uploader

A self-hosted file uploader with accounts, nested folders, and expiring share links. Server-rendered
Express app backed by PostgreSQL/Prisma, with files stored on local disk.

## Features

- **Accounts** — email + password registration and login (bcrypt hashing, Passport local strategy,
  database-backed sessions)
- **Nested folders** — create, rename, and delete folders; unlimited nesting with breadcrumbs
- **Uploads** — single-file uploads to the root or any folder, with extension allow-listing, magic-byte
  MIME verification, and a configurable size limit
- **File management** — browse, view details, download, and delete files (deletes the bytes on disk too)
- **Share links** — create a public, expiring link for any folder (1, 7, 10, or 30 days), browse and
  download through it, and revoke it at any time
- **Hardening** — CSRF protection, Helmet CSP, `httpOnly`/`SameSite`/`__Host-` session cookies, rate limits
  on register/login/upload/share, storage-key path traversal guards, and orphan-file cleanup

## Stack

| Layer    | Choice                                                        |
| -------- | ------------------------------------------------------------- |
| Runtime  | Node.js >= 20, TypeScript (ESM)                               |
| Server   | Express 5, EJS views, Multer                                  |
| Database | PostgreSQL via Prisma 6                                       |
| Auth     | Passport (local), express-session + Prisma session store      |
| Security | helmet, csrf-sync, express-rate-limit, bcrypt, zod, file-type |
| Styling  | Tailwind CSS 4 (CLI build)                                    |
| Tests    | Vitest + Supertest                                            |
| Deploy   | Railway (`railway.json`)                                      |

## Requirements

- Node.js >= 20
- PostgreSQL (local, or a managed instance)
- npm

## Getting started

```bash
git clone https://github.com/404soul24/File-Uploader.git
cd File-Uploader
npm install
cp .env.example .env
```

Create the database and apply migrations:

```bash
createdb file_uploader
npm run db:generate
npm run db:migrate
```

Start the dev server (TypeScript watcher + Tailwind watcher):

```bash
npm run dev
```

The app is served at <http://localhost:3000>. Register an account on `/auth/register`, then upload from
`/uploads`.

> A `SESSION_SECRET` of at least 32 characters is required in production. In development a built-in
> fallback secret is used if none is set — never rely on that outside local development.

## Environment variables

Copy `.env.example` to `.env`. All values are validated at boot by zod; the process exits with a list of
problems if anything is invalid.

| Variable                  | Default                                            | Description                                                               |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `NODE_ENV`                | `development`                                      | `development`, `test`, or `production`                                    |
| `PORT`                    | `3000`                                             | HTTP port                                                                 |
| `APP_URL`                 | `http://localhost:3000`                            | Absolute base URL used when building share links                          |
| `DATABASE_URL`            | —                                                  | PostgreSQL connection string (required)                                   |
| `SESSION_SECRET`          | —                                                  | >= 32 chars; required in production                                       |
| `UPLOAD_DIR`              | `./uploads`                                        | Root directory for stored files (resolved against the project root)       |
| `TEMP_UPLOAD_TTL_MINUTES` | `60`                                               | Age at which abandoned `.tmp` uploads are swept by the cleanup job        |
| `MAX_UPLOAD_SIZE_MB`      | `25`                                               | Per-file upload limit                                                     |
| `ALLOWED_MIME_TYPES`      | images, docs, archives, audio, video, `text/plain` | Comma-separated MIME allow-list                                           |
| `TRUST_PROXY`             | `false`                                            | Set `true` behind a reverse proxy (e.g. Railway) to trust `X-Forwarded-*` |

## Scripts

| Script                    | Purpose                                      |
| ------------------------- | -------------------------------------------- |
| `npm run dev`             | Dev server + Tailwind watch                  |
| `npm run build`           | Build CSS and compile TypeScript to `dist/`  |
| `npm start`               | Run the compiled server (`dist/server.js`)   |
| `npm test`                | Run the Vitest suite once                    |
| `npm run test:watch`      | Vitest in watch mode                         |
| `npm run typecheck`       | `tsc --noEmit`                               |
| `npm run lint`            | ESLint                                       |
| `npm run format`          | Prettier write                               |
| `npm run format:check`    | Prettier check                               |
| `npm run db:migrate`      | Create/apply a dev migration                 |
| `npm run db:deploy`       | Apply migrations in production               |
| `npm run db:studio`       | Prisma Studio                                |
| `npm run db:generate`     | Regenerate the Prisma client                 |
| `npm run storage:cleanup` | Delete orphaned files and stale temp uploads |

## How it works

### Storage layout

Uploads are streamed to `UPLOAD_DIR/.tmp` and only moved into their final location after validation:

```
uploads/
  .tmp/                      # in-flight uploads, swept by the cleanup script
  <userId>/root/<fileId>     # files at the account root
  <userId>/<folderId>/<fileId>
```

The database stores the `storageKey` (the relative path) rather than a client-supplied filename, and
every read resolves it through `resolveStoragePath` (`src/files/storage.ts`), which rejects absolute
paths, backslashes, and `.`/`..` segments before they can escape the upload root.

### Upload validation

`src/files/policy.ts` rejects a file unless all of the following hold:

1. It is not empty.
2. Its extension is on the built-in allow-list.
3. Magic-byte detection (`file-type`) returns a MIME type that is both in `ALLOWED_MIME_TYPES` and
   consistent with the extension.
4. Extension-less-detection text files decode as UTF-8 and do not begin with markup that could execute
   in a browser (HTML, SVG, script, XML).

### Share links

A share generates 32 random bytes, base64url-encodes them into the URL, and stores only the SHA-256
hash (`src/shares/service.ts`). A token is usable while it is unrevoked and `expiresAt` is in the future.
Public share responses are sent with `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and
`X-Robots-Tag: noindex`. Folder navigation through a share walks the parent chain and rejects anything
outside the shared subtree.

### Storage cleanup

`npm run storage:cleanup` removes stored files with no matching database row, temporary uploads older
than `TEMP_UPLOAD_TTL_MINUTES`, and directories left empty afterwards. Pass `--dry-run` to report counts
without deleting anything — useful as a scheduled job:

```bash
npm run storage:cleanup -- --dry-run
```

## Testing

```bash
npm test
```

Tests use Supertest against the Express app with an in-memory fake Prisma client
(`tests/helpers/test-database.ts`) and temp directories for uploads, so no live database is required.

## Deployment

`railway.json` is included: the build runs `npm run db:generate && npm run build`, `npm run db:deploy`
runs as a pre-deploy command, and `/health` is the healthcheck path.

Set at minimum `DATABASE_URL`, `SESSION_SECRET` (32+ chars), `APP_URL`, and `TRUST_PROXY=true` in the
Railway environment, and attach a persistent volume mounted at `UPLOAD_DIR` — otherwise uploaded files
are lost on redeploy.

## Project layout

```
src/
  app.ts               # Express app wiring, middleware, error handling
  server.ts            # HTTP server entrypoint
  auth/                # passport, sessions, CSRF, validation
  config/              # env parsing, Prisma client
  files/               # upload, policy, storage, download, cleanup
  folders/             # folder service and validation
  shares/              # share tokens and expiry
  routes/              # auth, folder, file, upload, share routers
  views/               # EJS templates
  scripts/             # maintenance scripts
prisma/                # schema and migrations
tests/                 # Vitest + Supertest suites
```

## License

UNLICENSED
