create table if not exists public.zundamon_question_overrides (
  question_id smallint primary key,
  correct_discards text[] not null,
  explanation text not null,
  updated_at timestamptz not null default now(),
  constraint zundamon_question_id_range check (question_id between 1 and 165),
  constraint zundamon_correct_discards_count check (cardinality(correct_discards) between 1 and 14),
  constraint zundamon_explanation_length check (char_length(btrim(explanation)) between 1 and 20000)
);

alter table public.zundamon_question_overrides enable row level security;

revoke all on table public.zundamon_question_overrides from anon, authenticated;

comment on table public.zundamon_question_overrides is
  'Shared correct-discard and explanation overrides for the Zundamon nanikiru app. Access is only through its Edge Function.';
