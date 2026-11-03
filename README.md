# Vault DB
Run: `docker compose up --build` then open http://localhost:8080 and drop CSV/JSON/JSONL files.
Flow: UI -> nginx -> Rust API (store + hash + register file) -> Scala worker (parse) -> Haskell guard (clean/validate)
-> PostgreSQL JSONB -> R/plumber (stats). Cloud: `cd infra && terraform init && terraform apply -var db_password=...`
