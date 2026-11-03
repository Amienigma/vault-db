CREATE TABLE files(
  id bigserial PRIMARY KEY, name text NOT NULL, path text NOT NULL,
  sha256 text UNIQUE NOT NULL, size_bytes bigint, status text NOT NULL DEFAULT 'pending',
  rows_loaded int DEFAULT 0, rejected int DEFAULT 0, error text, uploaded_at timestamptz DEFAULT now());
CREATE TABLE records(
  id bigserial PRIMARY KEY, file_id bigint REFERENCES files(id) ON DELETE CASCADE,
  data jsonb NOT NULL, created_at timestamptz DEFAULT now());
CREATE INDEX records_gin ON records USING gin(data jsonb_path_ops);
