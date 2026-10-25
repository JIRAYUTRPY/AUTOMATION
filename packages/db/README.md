# @automation/db

Plain-SQL migrations in `migrations/`, applied in filename order. Not yet wired to an ORM or to
the apps: ORM choice (Drizzle vs Prisma) is deferred until dependencies can be installed.

Notes:
- Run `PRAGMA foreign_keys = ON` on every SQLite connection or cascades will not fire.
- Deleting a project cascades to every DB row below it. Artifact **files** on disk are not
  removed by the database; the application must delete them (FR-01).
