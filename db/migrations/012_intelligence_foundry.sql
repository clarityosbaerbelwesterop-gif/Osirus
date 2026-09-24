-- Intelligence Foundry: the Intelligence Plane's own schema.
--
-- Everything the Foundry learns, generates and decides lives here, apart from
-- tenant data. Only the system (osirus.is_system(), the scheduler and the
-- Foundry itself) writes; platform operators listed in
-- osirus_intel.operators may read, for the internal lab. No tenant user can
-- see a row: customer runs contribute anonymous operational metrics only,
-- never their content.
--
-- Additive: new schema, one new nullable-with-default column on runs, and
-- claim_next_stage re-created with product runs ordered before Foundry runs.
-- Code from before this migration keeps working against it.

CREATE SCHEMA IF NOT EXISTS osirus_intel;

GRANT USAGE ON SCHEMA osirus_intel TO osirus_app;

CREATE TABLE IF NOT EXISTS osirus_intel.operators (
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id),
  CONSTRAINT operators_user_id_fkey FOREIGN KEY (user_id) REFERENCES osirus.users(id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION osirus_intel.is_operator()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'osirus_intel', 'osirus', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM osirus_intel.operators o
     WHERE o.user_id = osirus.current_user_id()
  );
$function$;

GRANT EXECUTE ON FUNCTION osirus_intel.is_operator() TO osirus_app;
CREATE TABLE IF NOT EXISTS osirus_intel.settings (
  id smallint NOT NULL DEFAULT 1,
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  budgets jsonb NOT NULL DEFAULT '{}'::jsonb,
  foundry_model text NOT NULL DEFAULT 'deepseek-v4-pro-0813:free',
  product_model text,
  provider_pause jsonb,
  updated_by uuid,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT settings_singleton_check CHECK (id = 1)
);
CREATE TABLE IF NOT EXISTS osirus_intel.resource_ledger (
  day date NOT NULL,
  category text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (day, category),
  CONSTRAINT resource_ledger_category_check CHECK (category = ANY (ARRAY['model_calls'::text, 'tokens'::text, 'cost_usd'::text, 'sandbox_minutes'::text, 'chained_ticks'::text, 'trials'::text]))
);
CREATE TABLE IF NOT EXISTS osirus_intel.capabilities (
  id text NOT NULL,
  domain text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'unmeasured',
  verified_success_rate numeric,
  sample_count integer NOT NULL DEFAULT 0,
  failure_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferred jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  last_evaluated_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT capabilities_status_check CHECK (status = ANY (ARRAY['unmeasured'::text, 'weak'::text, 'developing'::text, 'strong'::text]))
);
CREATE TABLE IF NOT EXISTS osirus_intel.capability_dependencies (
  capability_id text NOT NULL,
  depends_on text NOT NULL,
  PRIMARY KEY (capability_id, depends_on),
  CONSTRAINT capability_dependencies_self_check CHECK (capability_id <> depends_on),
  CONSTRAINT capability_dependencies_capability_fkey FOREIGN KEY (capability_id) REFERENCES osirus_intel.capabilities(id) ON DELETE CASCADE,
  CONSTRAINT capability_dependencies_depends_on_fkey FOREIGN KEY (depends_on) REFERENCES osirus_intel.capabilities(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS osirus_intel.capability_gaps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  capability_id text NOT NULL,
  kind text NOT NULL,
  summary text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  support integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT capability_gaps_kind_check CHECK (kind = ANY (ARRAY['knowledge'::text, 'tool'::text, 'execution'::text, 'planning'::text, 'context'::text, 'memory'::text, 'model'::text, 'verification'::text])),
  CONSTRAINT capability_gaps_status_check CHECK (status = ANY (ARRAY['open'::text, 'investigating'::text, 'addressed'::text, 'dismissed'::text])),
  CONSTRAINT capability_gaps_unique_key UNIQUE (capability_id, kind, summary),
  CONSTRAINT capability_gaps_capability_fkey FOREIGN KEY (capability_id) REFERENCES osirus_intel.capabilities(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS osirus_intel.eval_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  suite text NOT NULL,
  capability_id text NOT NULL,
  partition text NOT NULL,
  difficulty jsonb NOT NULL DEFAULT '{}'::jsonb,
  difficulty_score numeric NOT NULL DEFAULT 0,
  spec jsonb NOT NULL,
  generator text NOT NULL,
  fingerprint text NOT NULL,
  parent_id uuid,
  label_verified boolean NOT NULL DEFAULT false,
  label_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT eval_tasks_partition_check CHECK (partition = ANY (ARRAY['train'::text, 'dev'::text, 'holdout'::text, 'adversarial'::text, 'fresh'::text])),
  CONSTRAINT eval_tasks_generator_check CHECK (generator = ANY (ARRAY['seed'::text, 'curriculum'::text, 'self_play'::text, 'red'::text, 'mutation'::text, 'replay'::text])),
  CONSTRAINT eval_tasks_fingerprint_key UNIQUE (fingerprint),
  CONSTRAINT eval_tasks_capability_fkey FOREIGN KEY (capability_id) REFERENCES osirus_intel.capabilities(id)
);
CREATE TABLE IF NOT EXISTS osirus_intel.strategies (
  id text NOT NULL,
  kind text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT strategies_kind_check CHECK (kind = ANY (ARRAY['coding'::text, 'research'::text, 'math_science'::text, 'thinking'::text, 'building'::text, 'general'::text]))
);
CREATE TABLE IF NOT EXISTS osirus_intel.strategy_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  strategy_id text NOT NULL,
  version integer NOT NULL,
  genome jsonb NOT NULL DEFAULT '{}'::jsonb,
  parent_id uuid,
  mutation jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  risk_class text NOT NULL DEFAULT 'low',
  model text,
  canary_percent integer NOT NULL DEFAULT 0,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT strategy_versions_status_check CHECK (status = ANY (ARRAY['draft'::text, 'experimental'::text, 'verified'::text, 'champion'::text, 'canary'::text, 'active'::text, 'degraded'::text, 'rejected'::text, 'deprecated'::text])),
  CONSTRAINT strategy_versions_risk_check CHECK (risk_class = ANY (ARRAY['low'::text, 'high'::text])),
  CONSTRAINT strategy_versions_canary_check CHECK (canary_percent BETWEEN 0 AND 100),
  CONSTRAINT strategy_versions_high_risk_product_check CHECK (risk_class = 'low' OR status <> ALL (ARRAY['canary'::text, 'active'::text])),
  CONSTRAINT strategy_versions_version_key UNIQUE (strategy_id, version),
  CONSTRAINT strategy_versions_strategy_fkey FOREIGN KEY (strategy_id) REFERENCES osirus_intel.strategies(id) ON DELETE CASCADE,
  CONSTRAINT strategy_versions_parent_fkey FOREIGN KEY (parent_id) REFERENCES osirus_intel.strategy_versions(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS osirus_intel.research_agenda (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  capability_id text NOT NULL,
  title text NOT NULL,
  rationale text NOT NULL DEFAULT '',
  score numeric NOT NULL DEFAULT 0,
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT research_agenda_status_check CHECK (status = ANY (ARRAY['open'::text, 'active'::text, 'parked'::text, 'done'::text])),
  CONSTRAINT research_agenda_title_key UNIQUE (capability_id, title),
  CONSTRAINT research_agenda_capability_fkey FOREIGN KEY (capability_id) REFERENCES osirus_intel.capabilities(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS osirus_intel.research_cycles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running',
  phase text NOT NULL DEFAULT 'measure',
  agenda_item_id uuid,
  capability_id text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  lease_owner text,
  lease_expires_at timestamp with time zone,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  PRIMARY KEY (id),
  CONSTRAINT research_cycles_status_check CHECK (status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'paused'::text])),
  CONSTRAINT research_cycles_agenda_fkey FOREIGN KEY (agenda_item_id) REFERENCES osirus_intel.research_agenda(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS osirus_intel.experiments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cycle_id uuid,
  capability_id text NOT NULL,
  strategy_id text NOT NULL,
  observation jsonb NOT NULL DEFAULT '{}'::jsonb,
  hypotheses jsonb NOT NULL DEFAULT '[]'::jsonb,
  design jsonb NOT NULL DEFAULT '{}'::jsonb,
  conclusion jsonb,
  status text NOT NULL DEFAULT 'designed',
  champion_version_id uuid NOT NULL,
  challenger_version_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  concluded_at timestamp with time zone,
  PRIMARY KEY (id),
  CONSTRAINT experiments_status_check CHECK (status = ANY (ARRAY['designed'::text, 'running'::text, 'concluded'::text, 'aborted'::text])),
  CONSTRAINT experiments_cycle_fkey FOREIGN KEY (cycle_id) REFERENCES osirus_intel.research_cycles(id) ON DELETE SET NULL,
  CONSTRAINT experiments_strategy_fkey FOREIGN KEY (strategy_id) REFERENCES osirus_intel.strategies(id),
  CONSTRAINT experiments_champion_fkey FOREIGN KEY (champion_version_id) REFERENCES osirus_intel.strategy_versions(id)
);
CREATE TABLE IF NOT EXISTS osirus_intel.experiment_trials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL,
  strategy_version_id uuid NOT NULL,
  eval_task_id uuid NOT NULL,
  partition text NOT NULL,
  replicate integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  run_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamp with time zone,
  result jsonb,
  experience_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  PRIMARY KEY (id),
  CONSTRAINT experiment_trials_status_check CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'skipped'::text])),
  CONSTRAINT experiment_trials_partition_check CHECK (partition = ANY (ARRAY['train'::text, 'dev'::text, 'holdout'::text, 'adversarial'::text, 'fresh'::text])),
  CONSTRAINT experiment_trials_unique_key UNIQUE (experiment_id, strategy_version_id, eval_task_id, replicate),
  CONSTRAINT experiment_trials_experiment_fkey FOREIGN KEY (experiment_id) REFERENCES osirus_intel.experiments(id) ON DELETE CASCADE,
  CONSTRAINT experiment_trials_version_fkey FOREIGN KEY (strategy_version_id) REFERENCES osirus_intel.strategy_versions(id),
  CONSTRAINT experiment_trials_task_fkey FOREIGN KEY (eval_task_id) REFERENCES osirus_intel.eval_tasks(id)
);
CREATE TABLE IF NOT EXISTS osirus_intel.promotion_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  strategy_version_id uuid NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  canary_percent integer,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT promotion_events_version_fkey FOREIGN KEY (strategy_version_id) REFERENCES osirus_intel.strategy_versions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS osirus_intel.experience (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source text NOT NULL,
  task_ref text,
  task_type text NOT NULL,
  capability_ids text[] NOT NULL DEFAULT '{}'::text[],
  difficulty numeric,
  strategy_version_id uuid,
  model text,
  skills text[] NOT NULL DEFAULT '{}'::text[],
  tools text[] NOT NULL DEFAULT '{}'::text[],
  trajectory jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text NOT NULL,
  failure_class text,
  repairs integer NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  tokens integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  confidence numeric,
  quality_score numeric NOT NULL DEFAULT 0,
  fingerprint text NOT NULL,
  partition text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT experience_source_check CHECK (source = ANY (ARRAY['trial'::text, 'product'::text, 'synthetic'::text, 'benchmark'::text, 'golden'::text, 'arena'::text, 'self_play'::text, 'red'::text, 'replay'::text, 'human_feedback'::text])),
  CONSTRAINT experience_outcome_check CHECK (outcome = ANY (ARRAY['verified_success'::text, 'success'::text, 'failure'::text, 'false_completion'::text, 'error'::text])),
  CONSTRAINT experience_version_fkey FOREIGN KEY (strategy_version_id) REFERENCES osirus_intel.strategy_versions(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS osirus_intel.learning_artifacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cycle_id uuid,
  kind text NOT NULL,
  capability_id text,
  task_pattern text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  support integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'proposed',
  fingerprint text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT learning_artifacts_kind_check CHECK (kind = ANY (ARRAY['strategic_memory'::text, 'procedural_memory'::text, 'causal_memory'::text, 'skill_candidate'::text, 'strategy_candidate'::text, 'eval_case'::text, 'curriculum_task'::text, 'training_example'::text, 'failure_pattern'::text, 'router_stat'::text])),
  CONSTRAINT learning_artifacts_status_check CHECK (status = ANY (ARRAY['proposed'::text, 'active'::text, 'superseded'::text, 'rejected'::text])),
  CONSTRAINT learning_artifacts_fingerprint_key UNIQUE (kind, fingerprint),
  CONSTRAINT learning_artifacts_cycle_fkey FOREIGN KEY (cycle_id) REFERENCES osirus_intel.research_cycles(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS osirus_intel.generation_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cycle_id uuid,
  kind text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  produced integer NOT NULL DEFAULT 0,
  verified integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT generation_runs_kind_check CHECK (kind = ANY (ARRAY['curriculum'::text, 'self_play'::text, 'red'::text, 'mutation'::text, 'dataset'::text, 'skill_evolution'::text])),
  CONSTRAINT generation_runs_cycle_fkey FOREIGN KEY (cycle_id) REFERENCES osirus_intel.research_cycles(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS osirus_intel.datasets (
  id text NOT NULL,
  format text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT datasets_format_check CHECK (format = ANY (ARRAY['instruction_answer'::text, 'task_plan'::text, 'trajectory'::text, 'failure_repair'::text, 'problem_solution'::text, 'repo_patch'::text, 'source_synthesis'::text]))
);
CREATE TABLE IF NOT EXISTS osirus_intel.dataset_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  dataset_id text NOT NULL,
  version integer NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  contamination jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT dataset_versions_version_key UNIQUE (dataset_id, version),
  CONSTRAINT dataset_versions_dataset_fkey FOREIGN KEY (dataset_id) REFERENCES osirus_intel.datasets(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS osirus_intel.dataset_examples (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  dataset_version_id uuid NOT NULL,
  partition text NOT NULL,
  input jsonb NOT NULL,
  output jsonb NOT NULL,
  experience_id uuid,
  fingerprint text NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT dataset_examples_partition_check CHECK (partition = ANY (ARRAY['train'::text, 'dev'::text, 'holdout'::text, 'adversarial'::text])),
  CONSTRAINT dataset_examples_version_fkey FOREIGN KEY (dataset_version_id) REFERENCES osirus_intel.dataset_versions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS osirus_intel.models (
  id text NOT NULL,
  provider text NOT NULL,
  model_id text NOT NULL,
  family text,
  modalities text[] NOT NULL DEFAULT ARRAY['text'::text],
  context_tokens integer,
  free boolean NOT NULL DEFAULT false,
  pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'listed',
  lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT models_status_check CHECK (status = ANY (ARRAY['listed'::text, 'candidate'::text, 'available'::text, 'unavailable'::text, 'retired'::text]))
);
CREATE TABLE IF NOT EXISTS osirus_intel.model_capability_stats (
  model_id text NOT NULL,
  capability_id text NOT NULL,
  trials integer NOT NULL DEFAULT 0,
  verified integer NOT NULL DEFAULT 0,
  mean_latency_ms numeric,
  mean_cost_usd numeric,
  champion boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, capability_id),
  CONSTRAINT model_capability_stats_model_fkey FOREIGN KEY (model_id) REFERENCES osirus_intel.models(id) ON DELETE CASCADE,
  CONSTRAINT model_capability_stats_capability_fkey FOREIGN KEY (capability_id) REFERENCES osirus_intel.capabilities(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS osirus_intel.training_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  job_type text NOT NULL,
  base_model text NOT NULL,
  dataset_version_id uuid,
  status text NOT NULL DEFAULT 'queued',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT training_runs_job_type_check CHECK (job_type = ANY (ARRAY['sft'::text, 'fine_tune'::text, 'lora'::text, 'qlora'::text, 'distillation'::text, 'preference'::text, 'rl'::text, 'verifier'::text])),
  CONSTRAINT training_runs_status_check CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])),
  CONSTRAINT training_runs_dataset_fkey FOREIGN KEY (dataset_version_id) REFERENCES osirus_intel.dataset_versions(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS osirus_intel.model_candidates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  base_model text NOT NULL,
  training_run_id uuid,
  lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'candidate',
  evaluation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT model_candidates_status_check CHECK (status = ANY (ARRAY['candidate'::text, 'evaluating'::text, 'champion'::text, 'rejected'::text])),
  CONSTRAINT model_candidates_training_fkey FOREIGN KEY (training_run_id) REFERENCES osirus_intel.training_runs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS experience_capability_idx
  ON osirus_intel.experience USING gin (capability_ids);

CREATE INDEX IF NOT EXISTS experience_created_idx
  ON osirus_intel.experience (created_at DESC);

CREATE INDEX IF NOT EXISTS experience_fingerprint_idx
  ON osirus_intel.experience (fingerprint);

CREATE INDEX IF NOT EXISTS eval_tasks_capability_idx
  ON osirus_intel.eval_tasks (capability_id, partition);

CREATE INDEX IF NOT EXISTS experiment_trials_pending_idx
  ON osirus_intel.experiment_trials (experiment_id, status);

CREATE INDEX IF NOT EXISTS experiment_trials_run_idx
  ON osirus_intel.experiment_trials (run_id);

CREATE INDEX IF NOT EXISTS strategy_versions_status_idx
  ON osirus_intel.strategy_versions (strategy_id, status);
-- Row-level security: the system writes, operators read, nobody else.
ALTER TABLE osirus_intel.operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.operators FORCE ROW LEVEL SECURITY;
CREATE POLICY operators_system ON osirus_intel.operators
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.settings FORCE ROW LEVEL SECURITY;
CREATE POLICY settings_read ON osirus_intel.settings
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY settings_write ON osirus_intel.settings
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.resource_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.resource_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY resource_ledger_read ON osirus_intel.resource_ledger
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY resource_ledger_write ON osirus_intel.resource_ledger
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY capabilities_read ON osirus_intel.capabilities
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY capabilities_write ON osirus_intel.capabilities
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.capability_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.capability_dependencies FORCE ROW LEVEL SECURITY;
CREATE POLICY capability_dependencies_read ON osirus_intel.capability_dependencies
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY capability_dependencies_write ON osirus_intel.capability_dependencies
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.capability_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.capability_gaps FORCE ROW LEVEL SECURITY;
CREATE POLICY capability_gaps_read ON osirus_intel.capability_gaps
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY capability_gaps_write ON osirus_intel.capability_gaps
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.eval_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.eval_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY eval_tasks_read ON osirus_intel.eval_tasks
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY eval_tasks_write ON osirus_intel.eval_tasks
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.strategies FORCE ROW LEVEL SECURITY;
CREATE POLICY strategies_read ON osirus_intel.strategies
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY strategies_write ON osirus_intel.strategies
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.strategy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.strategy_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY strategy_versions_read ON osirus_intel.strategy_versions
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY strategy_versions_write ON osirus_intel.strategy_versions
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.research_agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.research_agenda FORCE ROW LEVEL SECURITY;
CREATE POLICY research_agenda_read ON osirus_intel.research_agenda
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY research_agenda_write ON osirus_intel.research_agenda
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.research_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.research_cycles FORCE ROW LEVEL SECURITY;
CREATE POLICY research_cycles_read ON osirus_intel.research_cycles
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY research_cycles_write ON osirus_intel.research_cycles
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.experiments FORCE ROW LEVEL SECURITY;
CREATE POLICY experiments_read ON osirus_intel.experiments
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY experiments_write ON osirus_intel.experiments
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.experiment_trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.experiment_trials FORCE ROW LEVEL SECURITY;
CREATE POLICY experiment_trials_read ON osirus_intel.experiment_trials
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY experiment_trials_write ON osirus_intel.experiment_trials
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.promotion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.promotion_events FORCE ROW LEVEL SECURITY;
CREATE POLICY promotion_events_read ON osirus_intel.promotion_events
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY promotion_events_write ON osirus_intel.promotion_events
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.experience ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.experience FORCE ROW LEVEL SECURITY;
CREATE POLICY experience_read ON osirus_intel.experience
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY experience_write ON osirus_intel.experience
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.learning_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.learning_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_artifacts_read ON osirus_intel.learning_artifacts
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY learning_artifacts_write ON osirus_intel.learning_artifacts
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.generation_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY generation_runs_read ON osirus_intel.generation_runs
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY generation_runs_write ON osirus_intel.generation_runs
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.datasets FORCE ROW LEVEL SECURITY;
CREATE POLICY datasets_read ON osirus_intel.datasets
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY datasets_write ON osirus_intel.datasets
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.dataset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.dataset_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY dataset_versions_read ON osirus_intel.dataset_versions
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY dataset_versions_write ON osirus_intel.dataset_versions
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.dataset_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.dataset_examples FORCE ROW LEVEL SECURITY;
CREATE POLICY dataset_examples_read ON osirus_intel.dataset_examples
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY dataset_examples_write ON osirus_intel.dataset_examples
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.models ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.models FORCE ROW LEVEL SECURITY;
CREATE POLICY models_read ON osirus_intel.models
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY models_write ON osirus_intel.models
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.model_capability_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.model_capability_stats FORCE ROW LEVEL SECURITY;
CREATE POLICY model_capability_stats_read ON osirus_intel.model_capability_stats
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY model_capability_stats_write ON osirus_intel.model_capability_stats
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.training_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.training_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY training_runs_read ON osirus_intel.training_runs
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY training_runs_write ON osirus_intel.training_runs
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.model_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.model_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY model_candidates_read ON osirus_intel.model_candidates
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY model_candidates_write ON osirus_intel.model_candidates
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.operators TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.settings TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.resource_ledger TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.capabilities TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.capability_dependencies TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.capability_gaps TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.eval_tasks TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.strategies TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.strategy_versions TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.research_agenda TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.research_cycles TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.experiments TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.experiment_trials TO osirus_app;
GRANT SELECT, INSERT ON osirus_intel.promotion_events TO osirus_app;
GRANT SELECT, INSERT ON osirus_intel.experience TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.learning_artifacts TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.generation_runs TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.datasets TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.dataset_versions TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.dataset_examples TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.models TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.model_capability_stats TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.training_runs TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus_intel.model_candidates TO osirus_app;

-- Product work before Foundry work. Foundry trials are ordinary durable runs
-- in the Foundry's own workspace; they get priority -1 so a user's run is
-- always claimed first when both are waiting.
ALTER TABLE osirus.runs ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 0;

-- Identical to 009 except for the first ORDER BY key.
CREATE OR REPLACE FUNCTION osirus.claim_next_stage(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 60,
  p_run_id uuid DEFAULT NULL
)
RETURNS osirus.run_attempts
LANGUAGE plpgsql
AS $function$
DECLARE
  v_stage osirus.run_stages;
  v_attempt osirus.run_attempts;
  v_max_attempts integer;
  v_max_slices integer;
  v_attempt_number integer;
  v_last_status text;
  v_is_retry boolean;
BEGIN
  IF p_worker_id IS NULL OR length(p_worker_id) = 0 THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid_lease_seconds';
  END IF;

  -- Retire leases whose holder stopped heartbeating.
  UPDATE osirus.run_attempts a
     SET status = 'lost',
         completed_at = now(),
         failure_class = COALESCE(a.failure_class, 'lease_expired')
   WHERE a.status IN ('claimed', 'running')
     AND a.lease_expires_at IS NOT NULL
     AND a.lease_expires_at <= now()
     AND (p_run_id IS NULL OR a.run_id = p_run_id);

  -- A stage marked running with no live attempt behind it lost its worker.
  -- Send it back to blocked so it is claimable again.
  UPDATE osirus.run_stages s
     SET status = 'blocked'
   WHERE s.status = 'running'
     AND (p_run_id IS NULL OR s.run_id = p_run_id)
     AND NOT EXISTS (
       SELECT 1
         FROM osirus.run_attempts a
        WHERE a.stage_id = s.id
          AND a.status IN ('claimed', 'running')
     );

  SELECT s.*
    INTO v_stage
    FROM osirus.run_stages s
    JOIN osirus.runs r ON r.id = s.run_id
   WHERE s.status IN ('pending', 'blocked')
     AND (p_run_id IS NULL OR s.run_id = p_run_id)
     AND (s.runnable_after IS NULL OR s.runnable_after <= now())
     AND r.cancel_requested = false
     AND r.status NOT IN ('completed', 'failed', 'cancelled', 'cancelling')
     AND NOT EXISTS (
       SELECT 1
         FROM osirus.run_stage_dependencies d
         JOIN osirus.run_stages dep ON dep.id = d.depends_on_stage_id
        WHERE d.stage_id = s.id
          AND dep.status NOT IN ('completed', 'skipped')
     )
   ORDER BY r.priority DESC, s.runnable_after NULLS FIRST, s.run_id, s.ordinal
     FOR UPDATE OF s SKIP LOCKED
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_max_attempts := GREATEST(COALESCE((v_stage.retry_policy ->> 'maxAttempts')::integer, 1), 1);
  v_max_slices := GREATEST(COALESCE((v_stage.retry_policy ->> 'maxSlices')::integer, 64), 1);

  -- Slices are bounded independently of retries. A worker that keeps returning
  -- PROGRESS is making progress by contract, but nothing here trusts that
  -- contract to terminate on its own.
  IF v_stage.slice_count >= v_max_slices THEN
    UPDATE osirus.run_stages
       SET status = CASE WHEN failure_policy = 'skip_stage' THEN 'skipped' ELSE 'failed' END,
           completed_at = now()
     WHERE id = v_stage.id;
    RETURN NULL;
  END IF;

  -- Only a claim that follows a failed, lost or cancelled attempt is a retry.
  -- A claim that continues a stage which yielded mid-flight is not, or a stage
  -- allowed a single attempt could never resume after its first slice.
  SELECT a.status
    INTO v_last_status
    FROM osirus.run_attempts a
   WHERE a.stage_id = v_stage.id
   ORDER BY a.attempt_number DESC
   LIMIT 1;

  v_is_retry := v_last_status IS NULL
             OR v_last_status IN ('failed', 'lost', 'cancelled');

  -- Attempts are bounded here, not by the caller: a caller that forgets cannot
  -- produce an unbounded retry loop.
  IF v_is_retry AND v_stage.attempt_count >= v_max_attempts THEN
    UPDATE osirus.run_stages
       SET status = CASE WHEN failure_policy = 'skip_stage' THEN 'skipped' ELSE 'failed' END,
           completed_at = now()
     WHERE id = v_stage.id;
    RETURN NULL;
  END IF;

  -- Derive the attempt number from the attempts themselves, not from the
  -- denormalised counter. attempt_count is the retry ceiling; if the two ever
  -- disagree, trusting the counter produces a duplicate key against
  -- run_attempts_run_stage_attempt_key. Same MAX+1-under-lock shape as
  -- osirus.append_run_event.
  SELECT COALESCE(MAX(a.attempt_number), 0) + 1
    INTO v_attempt_number
    FROM osirus.run_attempts a
   WHERE a.stage_id = v_stage.id;

  INSERT INTO osirus.run_attempts (
    run_id, stage_id, attempt_number, worker_kind, status,
    lease_owner, lease_token, lease_expires_at, heartbeat_at, started_at
  )
  VALUES (
    v_stage.run_id, v_stage.id, v_attempt_number,
    COALESCE(v_stage.worker_kind, 'inline'), 'claimed',
    p_worker_id, gen_random_uuid(),
    now() + make_interval(secs => p_lease_seconds), now(), now()
  )
  RETURNING * INTO v_attempt;

  UPDATE osirus.run_stages
     SET status = 'running',
         attempt_count = v_stage.attempt_count + CASE WHEN v_is_retry THEN 1 ELSE 0 END,
         slice_count = v_stage.slice_count + 1,
         started_at = COALESCE(started_at, now())
   WHERE id = v_stage.id;

  RETURN v_attempt;
END;
$function$;
