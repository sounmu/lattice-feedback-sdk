begin;

-- Triage outcomes: an admin can decline a feedback, or mark it as repeating an earlier one.
alter table public.feedback drop constraint feedback_status_check;
alter table public.feedback
  add constraint feedback_status_check check (status in ('open', 'in_progress', 'resolved', 'rejected', 'duplicate'));

alter table public.feedback add column duplicate_of uuid;

-- The link carries the project, so a feedback can only point to one of its own project.
alter table public.feedback add constraint feedback_project_id_unique unique (project_key, id);
alter table public.feedback
  add constraint feedback_duplicate_of_fkey foreign key (project_key, duplicate_of)
  references public.feedback (project_key, id);

-- A duplicate always names its original, nothing else does, and nothing repeats itself.
alter table public.feedback
  add constraint feedback_duplicate_of_check check ((status = 'duplicate') = (duplicate_of is not null) and duplicate_of <> id);

commit;
