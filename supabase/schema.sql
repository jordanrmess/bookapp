create extension if not exists "pgcrypto";

create table if not exists public.shelves (
  id uuid primary key default gen_random_uuid(),
  anonymous_key text not null,
  shelf_name text not null check (shelf_name in ('wantToRead', 'currentlyReading', 'booksRead')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (anonymous_key, shelf_name)
);

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  shelf_id uuid not null references public.shelves(id) on delete cascade,
  source_title text not null,
  source_author text,
  title text,
  authors text,
  cover_url text,
  pages integer,
  release_year integer,
  description text,
  rating double precision,
  slug text,
  created_at timestamptz not null default now()
);

create index if not exists shelves_anonymous_key_idx on public.shelves (anonymous_key);
create index if not exists books_shelf_id_idx on public.books (shelf_id);

alter table public.shelves enable row level security;
alter table public.books enable row level security;

drop policy if exists shelves_select_all on public.shelves;
drop policy if exists shelves_insert_basic on public.shelves;
drop policy if exists shelves_update_all on public.shelves;
drop policy if exists shelves_delete_all on public.shelves;

create policy shelves_select_all
on public.shelves
for select
to anon, authenticated
using (true);

create policy shelves_insert_basic
on public.shelves
for insert
to anon, authenticated
with check (
  anonymous_key is not null
  and length(trim(anonymous_key)) > 0
  and shelf_name in ('wantToRead', 'currentlyReading', 'booksRead')
);

create policy shelves_update_all
on public.shelves
for update
to anon, authenticated
using (true)
with check (
  anonymous_key is not null
  and length(trim(anonymous_key)) > 0
  and shelf_name in ('wantToRead', 'currentlyReading', 'booksRead')
);

create policy shelves_delete_all
on public.shelves
for delete
to anon, authenticated
using (true);

drop policy if exists books_select_linked on public.books;
drop policy if exists books_insert_linked on public.books;
drop policy if exists books_update_linked on public.books;
drop policy if exists books_delete_linked on public.books;

create policy books_select_linked
on public.books
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.shelves s
    where s.id = books.shelf_id
  )
);

create policy books_insert_linked
on public.books
for insert
to anon, authenticated
with check (
  exists (
    select 1
    from public.shelves s
    where s.id = books.shelf_id
  )
);

create policy books_update_linked
on public.books
for update
to anon, authenticated
using (
  exists (
    select 1
    from public.shelves s
    where s.id = books.shelf_id
  )
)
with check (
  exists (
    select 1
    from public.shelves s
    where s.id = books.shelf_id
  )
);

create policy books_delete_linked
on public.books
for delete
to anon, authenticated
using (
  exists (
    select 1
    from public.shelves s
    where s.id = books.shelf_id
  )
);

-- Keep existing environments aligned with the app's shelf keys.
-- `create table if not exists` does not update constraints on existing tables.
alter table public.shelves
  drop constraint if exists shelves_shelf_name_check;

alter table public.shelves
  add constraint shelves_shelf_name_check
  check (shelf_name in ('wantToRead', 'currentlyReading', 'booksRead'));

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.shelves;
create trigger set_updated_at
before update on public.shelves
for each row
execute function public.update_updated_at_column();
