-- ============================================================
-- 既有資料庫升級：加入「多專案」支援（可重複執行）
-- 在 SQL Editor 執行一次即可；現有資料會歸入專案 YT01
-- ============================================================
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,          -- 專案代號，例如 YT01
  name text not null,                 -- 專案名稱
  my_code text not null,              -- 本標在 ICD 編碼中的代號，例如 YT1（用來判斷主導/從屬方向）
  description text,
  created_at timestamptz not null default now(),
  created_by text
);

insert into public.projects(code, name, my_code)
select 'YT01', '高雄都會區大眾捷運系統都會線(黃線) YT01標軌道統包工程', 'YT1'
where not exists (select 1 from public.projects);

-- ICD 主表
alter table public.icds add column if not exists project_id uuid references public.projects(id) on delete cascade;
update public.icds set project_id = (select id from public.projects order by created_at limit 1) where project_id is null;
alter table public.icds alter column project_id set not null;
alter table public.icds drop constraint if exists icds_code_key;
alter table public.icds drop constraint if exists icds_project_code_key;
alter table public.icds add constraint icds_project_code_key unique (project_id, code);
create index if not exists icds_project_idx on public.icds(project_id);

-- 代碼表
alter table public.party_codes add column if not exists project_id uuid references public.projects(id) on delete cascade;
update public.party_codes set project_id = (select id from public.projects order by created_at limit 1) where project_id is null;
alter table public.party_codes alter column project_id set not null;
alter table public.party_codes drop constraint if exists party_codes_pkey;
alter table public.party_codes add primary key (project_id, code);

-- 未指定專案時（例如 seed 匯入）預設歸入第一個專案
create or replace function public.set_default_project()
returns trigger language plpgsql as $$
begin
  if new.project_id is null then
    new.project_id := (select id from public.projects order by created_at limit 1);
  end if;
  return new;
end $$;
drop trigger if exists icds_default_project on public.icds;
create trigger icds_default_project before insert on public.icds for each row execute function public.set_default_project();
drop trigger if exists party_codes_default_project on public.party_codes;
create trigger party_codes_default_project before insert on public.party_codes for each row execute function public.set_default_project();

-- RLS：已核准使用者可讀；editor/admin 可新增、修改；admin 可刪除
alter table public.projects enable row level security;
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated using (public.app_role() in ('viewer','editor','admin'));
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated with check (public.app_role() in ('editor','admin'));
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated using (public.app_role() in ('editor','admin')) with check (public.app_role() in ('editor','admin'));
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete to authenticated using (public.app_role() = 'admin');

revoke all on public.projects from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
