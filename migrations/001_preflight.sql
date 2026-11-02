CREATE TABLE IF NOT EXISTS missions (
  tenant_id text NOT NULL, id text NOT NULL,
  source_application text NOT NULL, subject_type text NOT NULL, subject_id text NOT NULL,
  source_version integer NOT NULL CHECK (source_version > 0), workflow_type text NOT NULL,
  workflow_version text NOT NULL, priority text NOT NULL, status text NOT NULL,
  input jsonb NOT NULL, constraints jsonb NOT NULL, input_hash text NOT NULL,
  correlation_id text NOT NULL, error_code text, revision integer NOT NULL DEFAULT 1,
  reserved_cost_usd numeric NOT NULL DEFAULT 0 CHECK(reserved_cost_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,source_application,subject_type,subject_id,source_version,workflow_type,workflow_version),
  CHECK (status IN ('received','planning','ready','running','waiting_input','waiting_dependency','review_ready','completed','failed','cancelled','superseded'))
);
CREATE INDEX IF NOT EXISTS missions_listing ON missions(tenant_id,source_application,created_at DESC);
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, mission_id text NOT NULL,
  key text NOT NULL, kind text NOT NULL, dependencies text[] NOT NULL DEFAULT '{}',
  status text NOT NULL, attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL,
  run_revision integer NOT NULL DEFAULT 1, attempt_token uuid, lease_until timestamptz,
  error_code text, started_at timestamptz, finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,mission_id) REFERENCES missions(tenant_id,id),
  UNIQUE (tenant_id,mission_id,key),
  CHECK(status IN ('waiting_dependency','ready','running','waiting_input','completed','failed','cancelled'))
);
CREATE TABLE IF NOT EXISTS results (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, mission_id text NOT NULL, task_id uuid NOT NULL REFERENCES tasks(id),
  kind text NOT NULL, output jsonb NOT NULL, provenance jsonb NOT NULL,
  version integer NOT NULL, obsolete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,mission_id) REFERENCES missions(tenant_id,id),
  UNIQUE (task_id,version)
);
CREATE TABLE IF NOT EXISTS review_proposals (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, mission_id text NOT NULL,
  type text NOT NULL, risk text NOT NULL, status text NOT NULL DEFAULT 'prepared',
  version integer NOT NULL DEFAULT 1, data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,mission_id) REFERENCES missions(tenant_id,id),
  UNIQUE(tenant_id,mission_id)
);
CREATE TABLE IF NOT EXISTS mission_events (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, mission_id text NOT NULL,
  action text NOT NULL, actor text NOT NULL, correlation_id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,mission_id) REFERENCES missions(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS inbound_events (
  tenant_id text NOT NULL, source_application text NOT NULL, event_id text NOT NULL,
  input_hash text NOT NULL, mission_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,source_application,event_id),
  FOREIGN KEY(tenant_id,mission_id) REFERENCES missions(tenant_id,id)
);
-- Transactional outbox only bridges persisted task intent to pg-boss; pg-boss owns delivery/retries.
CREATE TABLE IF NOT EXISTS task_outbox (
  id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), run_revision integer NOT NULL,
  tenant_id text NOT NULL, mission_id text NOT NULL, dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(task_id,run_revision)
);
CREATE INDEX IF NOT EXISTS outbox_pending ON task_outbox(created_at) WHERE dispatched_at IS NULL;
CREATE TABLE IF NOT EXISTS proposal_batches (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, source_application text NOT NULL,
  name text NOT NULL, version integer NOT NULL DEFAULT 1, criteria jsonb NOT NULL,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS batch_members (
  batch_id uuid NOT NULL REFERENCES proposal_batches(id), proposal_id uuid NOT NULL REFERENCES review_proposals(id),
  proposal_version integer NOT NULL, source_version integer NOT NULL, excluded boolean NOT NULL DEFAULT false,
  PRIMARY KEY(batch_id,proposal_id)
);
CREATE TABLE IF NOT EXISTS briefing_checkpoints (
  tenant_id text NOT NULL, subject text NOT NULL, last_viewed_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,subject)
);
CREATE TABLE IF NOT EXISTS access_audit (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, actor text NOT NULL,
  source_applications text[] NOT NULL, action text NOT NULL, object_id text,
  correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS source_versions (
  tenant_id text NOT NULL, source_application text NOT NULL, subject_type text NOT NULL, subject_id text NOT NULL,
  version integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,source_application,subject_type,subject_id)
);
CREATE TABLE IF NOT EXISTS source_notifications (
  tenant_id text NOT NULL, source_application text NOT NULL, event_id text NOT NULL,
  input_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,source_application,event_id)
);
