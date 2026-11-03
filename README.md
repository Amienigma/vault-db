# Vault DB
Run: `docker compose up --build` then open http://localhost:8080 and drop CSV/JSON/JSONL files.
Flow: UI -> nginx -> Rust API (store + hash + register file) -> Scala worker (parse) -> Haskell guard (clean/validate)
-> PostgreSQL JSONB -> R/plumber (stats). Cloud: `cd infra && terraform init && terraform apply -var db_password=...`
-> PostgreSQL JSONB -> R/plumber (stats). Cloud: `cd infra && terraform init && terraform apply -var db_password=...`

## Live on Vercel
`vercel/` is a serverless port of the same pipeline (upload → hash/dedupe → parse → clean/validate → store → stats),
backed by a private Vercel Blob store. Same UI, same `/api/files`, `/api/records`, `/api/upload`, `/stats` endpoints.
Vercel project root directory: `vercel`. Uploads are capped at ~4.5 MB per request on Vercel.
The full Docker stack (Rust, Scala, Haskell, R, PostgreSQL) above is unchanged for local or AWS use.
