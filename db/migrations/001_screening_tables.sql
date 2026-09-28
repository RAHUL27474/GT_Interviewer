CREATE TABLE IF NOT EXISTS candidates (
  id text PRIMARY KEY,
  email text NOT NULL,
  job_id text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  data jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS candidates_email_job_idx ON candidates (email, job_id);
CREATE INDEX IF NOT EXISTS candidates_status_created_idx ON candidates (status, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  active boolean NOT NULL,
  data jsonb NOT NULL
);