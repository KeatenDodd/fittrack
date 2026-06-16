-- ============================================================================
--  Workout + Nutrition Tracker — Schema
--  PostgreSQL 14+
--  Canonical storage rules:
--    * nutrient amounts stored PER 100 base units (g or ml), USDA-style
--    * weights/measurements store their own unit so users can mix lb/kg, in/cm
--    * all timestamps are TIMESTAMPTZ
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Users / Auth
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50)  UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),  -- unused: accounts are passwordless local profiles
  display_name  VARCHAR(100),
  sex           VARCHAR(10),  -- 'male' | 'female' | null; gates female-health features
  ingest_key    VARCHAR(64) UNIQUE,  -- per-user key so a phone automation can push activity
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Refresh tokens (so we can revoke a phone without forcing re-login everywhere)
CREATE TABLE refresh_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  device     VARCHAR(100),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ----------------------------------------------------------------------------
--  Exercise catalog  (system defaults: created_by IS NULL; custom: per-user)
-- ----------------------------------------------------------------------------
CREATE TABLE exercises (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(150) NOT NULL,
  category     VARCHAR(50),   -- strength | cardio | mobility | bodyweight
  muscle_group VARCHAR(50),   -- chest | back | legs | shoulders | arms | core | full_body
  equipment    VARCHAR(50),   -- barbell | dumbbell | machine | cable | bodyweight | kettlebell | band
  is_custom    BOOLEAN      NOT NULL DEFAULT false,
  created_by   INTEGER      REFERENCES users(id) ON DELETE CASCADE,  -- NULL = system
  notes        TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_exercises_owner ON exercises(created_by);
CREATE INDEX idx_exercises_name  ON exercises(lower(name));

-- ----------------------------------------------------------------------------
--  Workout templates  (reusable blueprints)
-- ----------------------------------------------------------------------------
CREATE TABLE workout_templates (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(150) NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE template_exercises (
  id                  SERIAL PRIMARY KEY,
  template_id         INTEGER     NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
  exercise_id         INTEGER     NOT NULL REFERENCES exercises(id),
  order_index         INTEGER     NOT NULL DEFAULT 0,
  target_sets         INTEGER,
  target_reps         INTEGER,
  target_weight       NUMERIC(7,2),
  target_rest_seconds INTEGER,
  notes               TEXT
);
CREATE INDEX idx_template_exercises_tpl ON template_exercises(template_id);

-- ----------------------------------------------------------------------------
--  Programs / mesocycles  (progressive-overload training blocks)
--    A program has training days; each day has exercises with a rep range and
--    a current working weight that the double-progression engine advances. The
--    last week can auto-deload. Position is tracked by current_week/day_index.
-- ----------------------------------------------------------------------------
CREATE TABLE programs (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              VARCHAR(150) NOT NULL,
  weeks             INTEGER     NOT NULL DEFAULT 5,   -- includes the deload week
  deload_enabled    BOOLEAN     NOT NULL DEFAULT true,
  current_week      INTEGER     NOT NULL DEFAULT 1,
  current_day_index INTEGER     NOT NULL DEFAULT 0,
  active            BOOLEAN     NOT NULL DEFAULT true, -- false once completed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_programs_user ON programs(user_id);

CREATE TABLE program_days (
  id          SERIAL PRIMARY KEY,
  program_id  INTEGER     NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  order_index INTEGER     NOT NULL DEFAULT 0,
  name        VARCHAR(100) NOT NULL
);
CREATE INDEX idx_program_days_prog ON program_days(program_id);

CREATE TABLE program_exercises (
  id               SERIAL PRIMARY KEY,
  program_day_id   INTEGER     NOT NULL REFERENCES program_days(id) ON DELETE CASCADE,
  exercise_id      INTEGER     NOT NULL REFERENCES exercises(id),
  order_index      INTEGER     NOT NULL DEFAULT 0,
  target_sets      INTEGER     NOT NULL DEFAULT 3,
  rep_low          INTEGER     NOT NULL DEFAULT 8,
  rep_high         INTEGER     NOT NULL DEFAULT 12,
  current_weight   NUMERIC(7,2),               -- working weight, advanced by progression
  weight_increment NUMERIC(6,2) NOT NULL DEFAULT 5,
  rest_seconds     INTEGER
);
CREATE INDEX idx_program_exercises_day ON program_exercises(program_day_id);

-- ----------------------------------------------------------------------------
--  Workout sessions  (what actually happened)
-- ----------------------------------------------------------------------------
CREATE TABLE workout_sessions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id INTEGER     REFERENCES workout_templates(id) ON DELETE SET NULL,
  program_id    INTEGER   REFERENCES programs(id) ON DELETE SET NULL,
  program_day_id INTEGER  REFERENCES program_days(id) ON DELETE SET NULL,
  program_week  INTEGER,
  name        VARCHAR(150),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  notes       TEXT
);
CREATE INDEX idx_sessions_user_date ON workout_sessions(user_id, started_at DESC);

CREATE TABLE session_exercises (
  id          SERIAL PRIMARY KEY,
  session_id  INTEGER     NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id INTEGER     NOT NULL REFERENCES exercises(id),
  order_index INTEGER     NOT NULL DEFAULT 0,
  -- targets copied from the program when this is a program workout (for display
  -- + progression); null for free workouts
  target_sets    INTEGER,
  target_rep_low INTEGER,
  target_rep_high INTEGER,
  target_weight  NUMERIC(7,2),
  superset_group INTEGER,   -- exercises sharing a group are performed as a superset
  notes       TEXT
);
CREATE INDEX idx_session_exercises_sess ON session_exercises(session_id);

CREATE TABLE exercise_sets (
  id                  SERIAL PRIMARY KEY,
  session_exercise_id INTEGER     NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
  set_number          INTEGER     NOT NULL,
  weight              NUMERIC(7,2),
  reps                INTEGER,
  rest_seconds        INTEGER,
  rpe                 NUMERIC(3,1),   -- rate of perceived exertion (optional)
  is_completed        BOOLEAN     NOT NULL DEFAULT true,
  is_warmup           BOOLEAN     NOT NULL DEFAULT false,
  set_type            VARCHAR(10) NOT NULL DEFAULT 'normal',  -- normal | warmup | myo | drop
  notes               TEXT,
  performed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sets_session_exercise ON exercise_sets(session_exercise_id);

-- ----------------------------------------------------------------------------
--  Body weight + measurements
-- ----------------------------------------------------------------------------
CREATE TABLE body_weight_logs (
  id        SERIAL PRIMARY KEY,
  user_id   INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weight    NUMERIC(6,2) NOT NULL,
  unit      VARCHAR(5)  NOT NULL DEFAULT 'lb',  -- lb | kg
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes     TEXT
);
CREATE INDEX idx_weight_user_date ON body_weight_logs(user_id, logged_at DESC);

CREATE TABLE measurement_types (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(50) UNIQUE NOT NULL,  -- chest, waist, left_bicep, body_fat_pct ...
  default_unit VARCHAR(10) NOT NULL DEFAULT 'in'
);

CREATE TABLE body_measurement_logs (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measurement_type_id INTEGER     NOT NULL REFERENCES measurement_types(id),
  value               NUMERIC(7,2) NOT NULL,
  unit                VARCHAR(10) NOT NULL DEFAULT 'in',
  logged_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes               TEXT
);
CREATE INDEX idx_measure_user_date ON body_measurement_logs(user_id, logged_at DESC);

-- ----------------------------------------------------------------------------
--  Daily activity  (steps + calories burned, e.g. pushed from a Zepp watch via
--  Apple Health / Health Connect, or entered by hand). One row per day.
-- ----------------------------------------------------------------------------
CREATE TABLE activity_logs (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day             DATE        NOT NULL,
  steps           INTEGER,
  calories_burned NUMERIC(7,1),
  source          VARCHAR(30),                 -- manual | apple_health | health_connect | ...
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);
CREATE INDEX idx_activity_user_day ON activity_logs(user_id, day DESC);

-- ----------------------------------------------------------------------------
--  Nutrition  (Cronometer-style normalized nutrient model)
-- ----------------------------------------------------------------------------
CREATE TABLE nutrients (
  id         SERIAL PRIMARY KEY,
  key        VARCHAR(40) UNIQUE NOT NULL,  -- energy_kcal, protein_g, sodium_mg ...
  name       VARCHAR(80) NOT NULL,
  unit       VARCHAR(10) NOT NULL,         -- kcal | g | mg | mcg
  category   VARCHAR(30),                  -- macro | lipid | mineral | vitamin
  sort_order INTEGER     NOT NULL DEFAULT 0
);

CREATE TABLE foods (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  brand        VARCHAR(150),
  barcode      VARCHAR(50),
  source       VARCHAR(20)  NOT NULL DEFAULT 'custom',  -- usda | off | custom | import
  source_ref   VARCHAR(100),            -- USDA fdcId / OFF code
  base_unit    VARCHAR(5)   NOT NULL DEFAULT 'g',       -- g | ml  (what "per 100" means)
  serving_size NUMERIC(8,2),            -- a convenient default serving, in base_unit
  serving_desc VARCHAR(60),             -- "1 scoop", "1 medium banana"
  created_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_foods_barcode ON foods(barcode);
CREATE INDEX idx_foods_name    ON foods(lower(name));

-- nutrient amounts per 100 base units of the food
CREATE TABLE food_nutrients (
  food_id     INTEGER      NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  nutrient_id INTEGER      NOT NULL REFERENCES nutrients(id) ON DELETE CASCADE,
  amount      NUMERIC(12,4) NOT NULL,
  PRIMARY KEY (food_id, nutrient_id)
);

CREATE TABLE food_log (
  id        SERIAL PRIMARY KEY,
  user_id   INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_id   INTEGER     NOT NULL REFERENCES foods(id),
  meal_type VARCHAR(20),                 -- breakfast | lunch | dinner | snack
  quantity  NUMERIC(8,2) NOT NULL,       -- amount consumed, in `unit`
  unit      VARCHAR(20)  NOT NULL DEFAULT 'g',
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_foodlog_user_date ON food_log(user_id, logged_at DESC);

CREATE TABLE nutrition_goals (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nutrient_id INTEGER      NOT NULL REFERENCES nutrients(id),
  target      NUMERIC(12,4) NOT NULL,
  UNIQUE (user_id, nutrient_id)
);

-- ----------------------------------------------------------------------------
--  Menstrual cycle tracking (shown only for profiles with sex = 'female')
--  One row per logged day; period starts / predictions are derived from these.
-- ----------------------------------------------------------------------------
CREATE TABLE cycle_logs (
  id        SERIAL PRIMARY KEY,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date      DATE    NOT NULL,
  flow      VARCHAR(10),   -- spotting | light | medium | heavy | null (no bleed)
  symptoms  TEXT,          -- comma-separated tags (cramps, headache, …)
  mood      VARCHAR(20),
  notes     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);
CREATE INDEX idx_cycle_user_date ON cycle_logs(user_id, date);

-- ----------------------------------------------------------------------------
--  Progress photos (body shots, tagged by date + angle) and exercise media
--  (set videos). Files live on disk under /uploads; the DB holds the path.
-- ----------------------------------------------------------------------------
CREATE TABLE progress_photos (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  taken_on   DATE    NOT NULL,
  angle      VARCHAR(20),   -- front | side | back | other
  file_path  VARCHAR(255) NOT NULL,
  mime       VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_progress_user_date ON progress_photos(user_id, taken_on DESC);

CREATE TABLE exercise_media (
  id         SERIAL PRIMARY KEY,
  session_exercise_id INTEGER NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
  file_path  VARCHAR(255) NOT NULL,
  mime       VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_exmedia_se ON exercise_media(session_exercise_id);

-- ----------------------------------------------------------------------------
--  updated_at trigger helper
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_touch       BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_templates_touch   BEFORE UPDATE ON workout_templates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
