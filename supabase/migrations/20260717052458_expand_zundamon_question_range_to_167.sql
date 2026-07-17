alter table public.zundamon_question_overrides
  drop constraint if exists zundamon_question_id_range;

alter table public.zundamon_question_overrides
  add constraint zundamon_question_id_range
  check (question_id between 1 and 167);

alter table public.zundamon_question_reviews
  drop constraint if exists zundamon_review_question_id_range;

alter table public.zundamon_question_reviews
  add constraint zundamon_review_question_id_range
  check (question_id between 1 and 167);
