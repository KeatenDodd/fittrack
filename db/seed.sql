-- ============================================================================
--  Seed data — run AFTER schema.sql
--  Safe to re-run: uses ON CONFLICT guards on natural keys.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Nutrient catalog  (Cronometer-style core set)
-- ----------------------------------------------------------------------------
INSERT INTO nutrients (key, name, unit, category, sort_order) VALUES
  ('energy_kcal',   'Energy',          'kcal', 'macro',   10),
  ('protein_g',     'Protein',         'g',    'macro',   20),
  ('carbs_g',       'Carbohydrates',   'g',    'macro',   30),
  ('fiber_g',       'Fiber',           'g',    'macro',   31),
  ('sugar_g',       'Sugars',          'g',    'macro',   32),
  ('fat_g',         'Total Fat',       'g',    'macro',   40),
  ('sat_fat_g',     'Saturated Fat',   'g',    'lipid',   41),
  ('mono_fat_g',    'Monounsaturated', 'g',    'lipid',   42),
  ('poly_fat_g',    'Polyunsaturated', 'g',    'lipid',   43),
  ('trans_fat_g',   'Trans Fat',       'g',    'lipid',   44),
  ('cholesterol_mg','Cholesterol',     'mg',   'lipid',   45),
  ('water_g',       'Water',           'g',    'macro',   50),
  -- minerals
  ('sodium_mg',     'Sodium',          'mg',   'mineral', 100),
  ('potassium_mg',  'Potassium',       'mg',   'mineral', 101),
  ('calcium_mg',    'Calcium',         'mg',   'mineral', 102),
  ('iron_mg',       'Iron',            'mg',   'mineral', 103),
  ('magnesium_mg',  'Magnesium',       'mg',   'mineral', 104),
  ('zinc_mg',       'Zinc',            'mg',   'mineral', 105),
  ('phosphorus_mg', 'Phosphorus',      'mg',   'mineral', 106),
  -- vitamins
  ('vit_a_mcg',     'Vitamin A',       'mcg',  'vitamin', 200),
  ('vit_c_mg',      'Vitamin C',       'mg',   'vitamin', 201),
  ('vit_d_mcg',     'Vitamin D',       'mcg',  'vitamin', 202),
  ('vit_e_mg',      'Vitamin E',       'mg',   'vitamin', 203),
  ('vit_k_mcg',     'Vitamin K',       'mcg',  'vitamin', 204),
  ('b1_mg',         'Thiamin (B1)',    'mg',   'vitamin', 205),
  ('b2_mg',         'Riboflavin (B2)', 'mg',   'vitamin', 206),
  ('b3_mg',         'Niacin (B3)',     'mg',   'vitamin', 207),
  ('b6_mg',         'Vitamin B6',      'mg',   'vitamin', 208),
  ('b12_mcg',       'Vitamin B12',     'mcg',  'vitamin', 209),
  ('folate_mcg',    'Folate',          'mcg',  'vitamin', 210)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
--  Measurement types
-- ----------------------------------------------------------------------------
INSERT INTO measurement_types (name, default_unit) VALUES
  ('neck',          'in'),
  ('shoulders',     'in'),
  ('chest',         'in'),
  ('left_bicep',    'in'),
  ('right_bicep',   'in'),
  ('left_forearm',  'in'),
  ('right_forearm', 'in'),
  ('waist',         'in'),
  ('hips',          'in'),
  ('left_thigh',    'in'),
  ('right_thigh',   'in'),
  ('left_calf',     'in'),
  ('right_calf',    'in'),
  ('body_fat_pct',  '%')
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
--  Starter exercise catalog  (created_by NULL = shared system defaults)
-- ----------------------------------------------------------------------------
INSERT INTO exercises (name, category, muscle_group, equipment, is_custom, created_by) VALUES
  -- chest
  ('Barbell Bench Press',       'strength', 'chest',     'barbell',    false, NULL),
  ('Incline Dumbbell Press',    'strength', 'chest',     'dumbbell',   false, NULL),
  ('Cable Fly',                 'strength', 'chest',     'cable',      false, NULL),
  ('Push-Up',                   'bodyweight','chest',    'bodyweight', false, NULL),
  -- back
  ('Deadlift',                  'strength', 'back',      'barbell',    false, NULL),
  ('Bent-Over Row',             'strength', 'back',      'barbell',    false, NULL),
  ('Lat Pulldown',              'strength', 'back',      'cable',      false, NULL),
  ('Pull-Up',                   'bodyweight','back',     'bodyweight', false, NULL),
  ('Seated Cable Row',          'strength', 'back',      'cable',      false, NULL),
  -- legs
  ('Back Squat',                'strength', 'legs',      'barbell',    false, NULL),
  ('Front Squat',               'strength', 'legs',      'barbell',    false, NULL),
  ('Romanian Deadlift',         'strength', 'legs',      'barbell',    false, NULL),
  ('Leg Press',                 'strength', 'legs',      'machine',    false, NULL),
  ('Walking Lunge',             'strength', 'legs',      'dumbbell',   false, NULL),
  ('Leg Curl',                  'strength', 'legs',      'machine',    false, NULL),
  ('Leg Extension',             'strength', 'legs',      'machine',    false, NULL),
  ('Standing Calf Raise',       'strength', 'legs',      'machine',    false, NULL),
  -- shoulders
  ('Overhead Press',            'strength', 'shoulders', 'barbell',    false, NULL),
  ('Dumbbell Shoulder Press',   'strength', 'shoulders', 'dumbbell',   false, NULL),
  ('Lateral Raise',             'strength', 'shoulders', 'dumbbell',   false, NULL),
  ('Face Pull',                 'strength', 'shoulders', 'cable',      false, NULL),
  -- arms
  ('Barbell Curl',              'strength', 'arms',      'barbell',    false, NULL),
  ('Dumbbell Curl',             'strength', 'arms',      'dumbbell',   false, NULL),
  ('Hammer Curl',               'strength', 'arms',      'dumbbell',   false, NULL),
  ('Triceps Pushdown',          'strength', 'arms',      'cable',      false, NULL),
  ('Skullcrusher',              'strength', 'arms',      'barbell',    false, NULL),
  ('Dip',                       'bodyweight','arms',     'bodyweight', false, NULL),
  -- core
  ('Plank',                     'bodyweight','core',     'bodyweight', false, NULL),
  ('Hanging Leg Raise',         'bodyweight','core',     'bodyweight', false, NULL),
  ('Cable Crunch',              'strength', 'core',      'cable',      false, NULL),
  ('Russian Twist',             'bodyweight','core',     'bodyweight', false, NULL),
  -- cardio
  ('Treadmill Run',             'cardio',   'full_body', 'machine',    false, NULL),
  ('Stationary Bike',           'cardio',   'full_body', 'machine',    false, NULL),
  ('Rowing Machine',            'cardio',   'full_body', 'machine',    false, NULL),
  ('Kettlebell Swing',          'strength', 'full_body', 'kettlebell', false, NULL)
ON CONFLICT DO NOTHING;
