create table if not exists public.zundamon_question_reviews (
  question_id smallint primary key,
  reviewed boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint zundamon_review_question_id_range check (question_id between 1 and 165),
  constraint zundamon_reviewed_rows_are_complete check (reviewed)
);

alter table public.zundamon_question_reviews enable row level security;

revoke all on table public.zundamon_question_reviews from anon, authenticated;

comment on table public.zundamon_question_reviews is
  'Shared admin review-completion state for Zundamon nanikiru questions. Access is only through its Edge Function.';
