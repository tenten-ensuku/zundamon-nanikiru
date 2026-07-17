alter table public.zundamon_question_overrides
  add column if not exists question_data jsonb not null default '{}'::jsonb;

alter table public.zundamon_question_overrides
  drop constraint if exists zundamon_question_id_range,
  drop constraint if exists zundamon_correct_discards_count,
  drop constraint if exists zundamon_explanation_length;

alter table public.zundamon_question_overrides
  add constraint zundamon_question_id_range check (question_id between 1 and 9999),
  add constraint zundamon_correct_discards_count check (cardinality(correct_discards) between 0 and 14),
  add constraint zundamon_explanation_length check (char_length(explanation) <= 20000),
  add constraint zundamon_question_data_is_object check (jsonb_typeof(question_data) = 'object');

alter table public.zundamon_question_reviews
  drop constraint if exists zundamon_review_question_id_range;

alter table public.zundamon_question_reviews
  add constraint zundamon_review_question_id_range check (question_id between 1 and 9999);
