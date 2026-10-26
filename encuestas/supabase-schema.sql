-- Run this once in the Supabase SQL Editor, then replace the UUID below
-- with the Auth user ID of the sole administrator.
create table if not exists public.survey_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  title text not null check (length(title) between 1 and 200),
  description text not null default '' check (length(description) <= 2000),
  questions jsonb not null check (
    case
      when jsonb_typeof(questions) = 'array'
        then jsonb_array_length(questions) between 1 and 100
      else false
    end
  ),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  answers jsonb not null check (
    jsonb_typeof(answers) = 'object'
    and pg_column_size(answers) <= 65536
  ),
  consent boolean not null check (consent),
  submitted_at timestamptz not null default now()
);

create or replace function public.validate_survey_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  survey_questions jsonb;
  question jsonb;
  question_id text;
  question_type text;
  answer jsonb;
  option_value jsonb;
begin
  select questions into survey_questions
  from public.surveys
  where id = new.survey_id and is_published;

  if not found then
    raise exception 'This survey is not accepting responses';
  end if;

  if jsonb_typeof(new.answers) <> 'object' then
    raise exception 'Answers must be a JSON object';
  end if;

  for question in select value from jsonb_array_elements(survey_questions) as q(value)
  loop
    question_id := question ->> 'id';
    question_type := question ->> 'tipo';
    if not (new.answers ? question_id) then
      if coalesce(question ->> 'requerida', 'false') = 'true' then
        raise exception 'A required question is unanswered';
      end if;
      continue;
    end if;
    answer := new.answers -> question_id;
    if coalesce(question ->> 'requerida', 'false') = 'true'
      and (answer = '""'::jsonb or answer = '[]'::jsonb) then
      raise exception 'A required question is unanswered';
    end if;
    if coalesce(question ->> 'requerida', 'false') = 'true'
      and jsonb_typeof(answer) = 'string'
      and length(btrim(answer #>> '{}')) = 0 then
      raise exception 'A required question is unanswered';
    end if;

    if question_type = 'unica' then
      if jsonb_typeof(answer) <> 'string'
        or not (coalesce(question -> 'opciones', '[]'::jsonb) ? (answer #>> '{}')) then
        raise exception 'Invalid single-choice answer';
      end if;
    elsif question_type = 'multiple' then
      if jsonb_typeof(answer) <> 'array' then
        raise exception 'Invalid multiple-choice answer';
      end if;
      for option_value in select value from jsonb_array_elements(answer) as a(value)
      loop
        if jsonb_typeof(option_value) <> 'string'
          or not (coalesce(question -> 'opciones', '[]'::jsonb) ? (option_value #>> '{}')) then
          raise exception 'Invalid multiple-choice option';
        end if;
      end loop;
    elsif question_type in ('escala', 'nps', 'numero') then
      if jsonb_typeof(answer) <> 'number' then
        raise exception 'Invalid numeric answer';
      end if;
      if question_type in ('escala', 'nps')
        and ((answer #>> '{}')::numeric < (question ->> 'min')::numeric
          or (answer #>> '{}')::numeric > (question ->> 'max')::numeric) then
        raise exception 'Numeric answer is outside the allowed range';
      end if;
      if question_type = 'nps'
        and ((answer #>> '{}')::numeric < 0 or (answer #>> '{}')::numeric > 10) then
        raise exception 'NPS answers must be between 0 and 10';
      end if;
    elsif question_type in ('texto', 'texto_largo') then
      if jsonb_typeof(answer) <> 'string' or length(answer #>> '{}') > 5000 then
        raise exception 'Invalid text answer';
      end if;
    else
      raise exception 'Unsupported question type';
    end if;
  end loop;

  for question_id in select jsonb_object_keys(new.answers)
  loop
    if not exists (
      select 1 from jsonb_array_elements(survey_questions) as q(value)
      where q.value ->> 'id' = question_id
    ) then
      raise exception 'Answer contains an unknown question';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists validate_survey_response_before_insert on public.survey_responses;
create trigger validate_survey_response_before_insert
  before insert on public.survey_responses
  for each row execute function public.validate_survey_response();
revoke all on function public.validate_survey_response() from public, anon, authenticated;

create or replace function public.prevent_survey_question_changes_with_responses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.questions is distinct from old.questions
    and exists (
      select 1 from public.survey_responses
      where survey_id = old.id
    ) then
    raise exception 'Questions cannot be changed after responses have been collected; create a new survey instead';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_survey_question_changes_with_responses on public.surveys;
create trigger prevent_survey_question_changes_with_responses
  before update on public.surveys
  for each row execute function public.prevent_survey_question_changes_with_responses();
revoke all on function public.prevent_survey_question_changes_with_responses() from public, anon, authenticated;

create index if not exists surveys_public_id_idx on public.surveys(public_id);
create index if not exists responses_survey_submitted_idx
  on public.survey_responses(survey_id, submitted_at);

create or replace function public.is_survey_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.survey_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_survey_admin() from public, anon;
grant execute on function public.is_survey_admin() to authenticated;

create or replace function public.get_public_survey(p_public_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', id,
    'public_id', public_id,
    'title', title,
    'description', description,
    'questions', questions
  )
  from public.surveys
  where public_id = p_public_id and is_published;
$$;

create or replace function public.can_accept_survey_response(p_survey_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.surveys
    where id = p_survey_id and is_published
  );
$$;

revoke all on function public.get_public_survey(uuid) from public;
revoke all on function public.can_accept_survey_response(uuid) from public;
grant execute on function public.get_public_survey(uuid) to anon, authenticated;
grant execute on function public.can_accept_survey_response(uuid) to anon, authenticated;

alter table public.survey_admins enable row level security;
alter table public.surveys enable row level security;
alter table public.survey_responses enable row level security;

revoke all on public.survey_admins from anon, authenticated;
revoke all on public.surveys from anon, authenticated;
revoke all on public.survey_responses from anon, authenticated;

grant select on public.surveys to authenticated;
grant insert, update, delete on public.surveys to authenticated;
grant insert (survey_id, answers, consent) on public.survey_responses to anon, authenticated;
grant select, delete on public.survey_responses to authenticated;

drop policy if exists "Admin can read all surveys" on public.surveys;
drop policy if exists "Public can read published surveys" on public.surveys;
create policy "Admin can read all surveys"
  on public.surveys for select
  to authenticated
  using ((select public.is_survey_admin()));

drop policy if exists "Admin can create surveys" on public.surveys;
create policy "Admin can create surveys"
  on public.surveys for insert
  to authenticated
  with check (
    (select public.is_survey_admin())
    and created_by = (select auth.uid())
  );

drop policy if exists "Admin can update surveys" on public.surveys;
create policy "Admin can update surveys"
  on public.surveys for update
  to authenticated
  using ((select public.is_survey_admin()))
  with check (
    (select public.is_survey_admin())
    and created_by = (select auth.uid())
  );

drop policy if exists "Admin can delete surveys" on public.surveys;
create policy "Admin can delete surveys"
  on public.surveys for delete
  to authenticated
  using ((select public.is_survey_admin()));

drop policy if exists "Public can submit consented responses" on public.survey_responses;
create policy "Public can submit consented responses"
  on public.survey_responses for insert
  to anon, authenticated
  with check (
    consent
    and (select public.can_accept_survey_response(survey_id))
  );

drop policy if exists "Admin can read responses" on public.survey_responses;
create policy "Admin can read responses"
  on public.survey_responses for select
  to authenticated
  using ((select public.is_survey_admin()));

drop policy if exists "Admin can delete responses" on public.survey_responses;
create policy "Admin can delete responses"
  on public.survey_responses for delete
  to authenticated
  using ((select public.is_survey_admin()));

-- After creating the admin in Supabase Authentication, replace the UUID and run:
-- insert into public.survey_admins (user_id)
-- values ('00000000-0000-0000-0000-000000000000');
