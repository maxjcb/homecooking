-- Homecooking: Supabase-Schema
-- Manuell im Supabase SQL Editor ausführen. Nicht Teil der laufenden App.
-- Voraussetzung: Self-Signup in den Auth-Einstellungen deaktivieren und die
-- beiden Haushalts-Accounts manuell im Dashboard anlegen.

create table pantry_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  qty_type text not null default 'metric',
  qty numeric not null default 0,
  unit text,
  store text not null default 'pantry',
  mhd date,
  category text not null default 'Sonstiges'
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  time int,
  portions int,
  ingredients text[] not null default '{}',
  steps text[] not null default '{}',
  tags text[] not null default '{}',
  ai_generated boolean not null default false
);

create table grocery_items (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  checked boolean not null default false
);

create table profiles (
  person_num int primary key,
  name text not null,
  diet text
);

alter table pantry_items enable row level security;
alter table recipes enable row level security;
alter table grocery_items enable row level security;
alter table profiles enable row level security;

-- Daten werden haushaltsweit geteilt, keine Trennung nach Person:
-- jede authentifizierte Person darf alles lesen/schreiben.
create policy "authenticated full access" on pantry_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on recipes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on grocery_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on profiles
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Realtime für die vier Tabellen aktivieren (Dashboard: Database > Replication,
-- oder per SQL falls die Publication bereits existiert):
alter publication supabase_realtime add table pantry_items, recipes, grocery_items, profiles;

-- Initiale Profil-Zeilen (Platzhalter, im Settings-Tab der App editierbar):
insert into profiles (person_num, name, diet) values
  (1, 'Person 1', 'vegetarisch'),
  (2, 'Person 2', 'vegetarisch');
