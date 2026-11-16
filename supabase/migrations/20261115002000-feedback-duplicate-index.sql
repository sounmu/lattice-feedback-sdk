begin;

-- redirect_feedback_duplicates looks up every child by project and original.
-- The foreign key indexes the referenced (project_key, id), not these child rows.
-- Originals have no duplicate_of and need no entry in this index.
create index feedback_project_duplicate_index
  on public.feedback (project_key, duplicate_of)
  where duplicate_of is not null;

commit;
