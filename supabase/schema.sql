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
  -- jsonb array of {qty: number|null, unit: string|null, name: string}
  ingredients jsonb not null default '[]',
  steps text[] not null default '{}',
  tags text[] not null default '{}',
  ai_generated boolean not null default false,
  -- {calories, protein, carbs, fat} for the WHOLE recipe (as stored, not per portion)
  nutrition jsonb
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

-- Migration: strukturierte Zutaten + Nährwerte. NUR auf einem bestehenden Projekt
-- ausführen, bei dem `recipes` schon existiert (NICHT zusammen mit dem `create table`
-- oben in einem frischen Setup laufen lassen — dort ist die Spalte bereits jsonb).
-- Bestehende Freitext-Zutaten werden verlustfrei in {qty: null, unit: null, name: "<Text>"}
-- überführt; nichts geht verloren, ist aber bis zum nächsten Bearbeiten unstrukturiert.
create or replace function _migrate_ingredients_to_jsonb(arr text[]) returns jsonb as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('qty', null, 'unit', null, 'name', x)),
    '[]'::jsonb
  )
  from unnest(arr) as x;
$$ language sql immutable;

alter table recipes alter column ingredients drop default;
alter table recipes alter column ingredients type jsonb using _migrate_ingredients_to_jsonb(ingredients);
alter table recipes alter column ingredients set default '[]'::jsonb;
drop function _migrate_ingredients_to_jsonb(text[]);
alter table recipes add column if not exists nutrition jsonb;
