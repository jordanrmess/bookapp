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
