# ADR-0037: Encrypted backups on free infrastructure (proposed destination)

Status: **Proposed.** The scripts and the restore drill are built and tested. The **daily schedule is not switched on**, because the founder asked for the storage destination and security design to be approved first (question 8, 28 November 2026).

Date: 2026-11-28

## Context

The founder approved encrypted backups using existing infrastructure and free services, with these rules:

- no subscription;
- no unencrypted dump, personal information or production secret in GitHub;
- encryption keys kept apart from the backup files;
- not relying only on storage inside the same database project;
- a complete restoration drill.

Facts that shape the choice:

- **Supabase Free** has a 500 MB database limit and 1 GB of file storage. It offers no point-in-time recovery. Its built-in backups are not something to rely on for a free project, so JAYS needs its own.
- **Database size:** the pilot database is expected to stay well under 500 MB. A compressed `pg_dump` (custom format) is usually a fraction of that, roughly 10 to 30 MB for a few hundred MB of data.
- **GitHub Free, private repositories:** 2,000 Actions minutes a month. Workflow artifacts share 500 MB of storage and are kept at most 90 days. Release assets can be up to 2 GB per file, and can be deleted. Git history keeps every committed file forever, unless history is rewritten.
- **`infra/backup`** already has `backup.sh` (pg_dump, encrypted, with a checksum), `restore.sh` (refuses a non-empty target) and `drill.sh` (backup, restore, then compare). The drill runs in CI on every change.

## Options compared

| Option                                                                       | Confidentiality                                                             | Retention and quota                                                                                             | Access                                                                                                | Recovery availability                                                                   | Same project as the database? | Verdict                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| **A. Dedicated private GitHub repository, backups as release assets**        | Good with public-key encryption (below). GitHub only ever holds ciphertext. | Each release asset can be up to 2 GB. Old releases are deleted by the retention step, so history does not grow. | Repository admins only (the founder). Workflows need a fine-grained token limited to that repository. | High: GitHub is independent of Supabase and Vercel.                                     | No                            | **Recommended primary**                                                |
| B. Same repository as the code, committed files                              | Ciphertext only, but in git history forever                                 | History grows with every backup and cannot be pruned without rewriting history                                  | Everyone with code access                                                                             | High                                                                                    | No                            | Rejected: mixes code and data access, and retention cannot be enforced |
| C. GitHub Actions artifacts                                                  | Ciphertext only                                                             | At most 90 days; 500 MB shared quota on Free                                                                    | Repository readers                                                                                    | Medium: they expire automatically                                                       | No                            | Acceptable only as a short-lived copy                                  |
| D. Supabase private storage (same project)                                   | Ciphertext                                                                  | Counts against 1 GB                                                                                             | Service role                                                                                          | **Fails together with the database project**                                            | **Yes**                       | Rejected as the only copy (founder rule)                               |
| E. Supabase storage of the _other_ free project                              | Ciphertext                                                                  | Counts against that project's 1 GB                                                                              | Service role of the other project                                                                     | Medium. Mixes staging and production, and both projects belong to one Supabase account. | Same account                  | Not recommended                                                        |
| **F. Encrypted offline copy** (founder's computer or an encrypted USB drive) | Excellent if kept encrypted                                                 | Founder-managed                                                                                                 | Founder only                                                                                          | Depends on the founder; manual                                                          | No                            | **Recommended secondary**: a monthly copy                              |

## Proposed design (to be approved)

1. **Encryption with a public key (`age`).** The backup job holds only an `age` **public** key (`BACKUP_AGE_RECIPIENT`). It can encrypt, but can never decrypt.
   - The **private key** is generated once on the founder's computer and stored in the founder's password manager, plus one offline copy. It is never put in GitHub, Vercel or Supabase.
   - So even if GitHub or the backup job were compromised, the backups stay unreadable.
   - The symmetric `openssl` passphrase mode stays available for self-hosting.
2. **Where:** a new private repository, for example `Elevationaddi/jays-backups`. It is free and separate from the code repository, and only the founder has access. Each run uploads `jays-<timestamp>.dump.age` and its `.sha256` as assets of a dated release.
3. **When:** daily at 02:30 Dubai time, from a scheduled GitHub Actions workflow. A run takes about 2 minutes, so roughly 60 of the 2,000 free minutes a month.
4. **Retention:** 7 daily, 4 weekly (Sundays) and 3 monthly (the 1st) copies, about 14 files. At pilot size that is a few hundred MB at most. Older releases are deleted by the same workflow.
5. **Secrets the workflow needs:**
   - `BACKUP_DATABASE_URL`: the production **direct** connection, with a database role that can only read (`pg_dump`);
   - `BACKUP_AGE_RECIPIENT`: the public key, which is not secret;
   - a token that can write releases to the backup repository only.
6. **Offline copy:** on the 1st of each month, the founder downloads the newest monthly asset to their computer or an encrypted USB drive.
7. **Monitoring:** a failed run emails the repository owner (GitHub's own notification). The admin console's operations page will show the date of the last backup once the workflow reports it.
8. **Restore:** `restore.sh <file.dump.age>` with `BACKUP_AGE_IDENTITY_FILE` pointing at the private key, into an **empty** database. It refuses a database that has tables.
9. **What is never stored:** unencrypted dumps, the private key, `.env` files or any credential. Backups contain personal information, which is why they are always encrypted before they leave the job.

What still needs approval:

- the destination (A plus F);
- creating the private repository;
- the founder generating the key pair.

Then the workflow template (`infra/backup/github-actions-backup.example.yml`) is copied into the backup repository and switched on.

## Restoration drill

- **Automated:** `infra/backup/drill.sh` runs in CI on every change, now in **both** modes (`age` and `openssl`). It:
  1. migrates a database and loads the seed data;
  2. backs it up encrypted;
  3. restores into a new empty database;
  4. compares the exact row count of every table;
  5. checks that the migrations match, that the ledger is balanced, and that the append-only triggers are present.
- **Run on 28 November 2026** in the development environment, against PostgreSQL 16 with all 20 migrations and the demonstration data. Result: passed (89 tables compared, ledger balanced). It is recorded in IMPLEMENTATION_STATUS.md.
- **Still to do on real infrastructure:** a drill from a real staging backup (Supabase to GitHub release, then a restore into a fresh database), once the destination is approved. It must use the `pg_dump` and `pg_restore` versions matching Supabase's PostgreSQL major version.

## Consequences

- No subscription. GitHub Free and the founder's own storage are enough at pilot size.
- Recovery does not depend on Supabase, Vercel or the code repository.
- Losing the private key means losing every backup, so the key needs two safe copies.
- Point-in-time recovery is not available. The worst case loses up to 24 hours of data. That matters for a commercial launch and is listed as a launch consideration.
