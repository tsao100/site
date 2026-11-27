-- ============================================================
-- 界面管理系統 Supabase Schema
-- 在 Supabase Dashboard → SQL Editor 依序執行：
--   1) schema.sql  2) seed_1_icds.sql  3) seed_2_revisions_correspondence.sql
-- ============================================================

-- ---------- 使用者與角色 ----------
-- role: viewer(唯讀；新註冊者 Email 驗證完成後的預設角色，免管理者核準) / editor(可編輯) / admin(管理者)
--       disabled(停用；管理者可封鎖個別帳號，無任何資料權限)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'viewer' check (role in ('disabled','viewer','editor','admin')),
  created_at timestamptz not null default now()
);

-- 新使用者註冊時自動建立 profile（預設唯讀）；第一位註冊者自動成為 admin
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, display_name, role)
  values (new.id, new.email, split_part(new.email,'@',1),
          case when not exists (select 1 from public.profiles) then 'admin' else 'viewer' end);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 目前使用者的角色。信箱尚未完成驗證者一律視為 'none'（讀不到任何資料），
-- 不論 Supabase 的「Confirm email」設定為何，都由資料庫把關。
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid() and u.email_confirmed_at is not null
  ), 'none')
$$;

-- 唯讀使用者要申請編輯權限時，需要知道該聯繫誰：只回傳管理者的 email，且僅限已驗證的使用者呼叫。
create or replace function public.admin_contacts()
returns table(email text) language sql stable security definer set search_path = public as $$
  select p.email from public.profiles p
  where p.role = 'admin' and public.app_role() in ('viewer','editor','admin')
  order by p.created_at
$$;

-- ---------- 專案 ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  my_code text not null,
  description text,
  created_at timestamptz not null default now(),
  created_by text
);
insert into public.projects(code, name, my_code)
select 'YT01', '高雄都會區大眾捷運系統都會線(黃線) YT01標軌道統包工程', 'YT1'
where not exists (select 1 from public.projects);

create or replace function public.set_default_project()
returns trigger language plpgsql as $$
begin
  if new.project_id is null then
    new.project_id := (select id from public.projects order by created_at limit 1);
  end if;
  return new;
end $$;

-- ---------- 代碼表 ----------
create table if not exists public.party_codes (
  project_id uuid not null references public.projects(id) on delete cascade,
  code text,
  name_zh text,
  name_en text,
  kind text check (kind in ('internal','external')),
  primary key (project_id, code)
);
drop trigger if exists party_codes_default_project on public.party_codes;
create trigger party_codes_default_project before insert on public.party_codes for each row execute function public.set_default_project();

-- ---------- ICD 主表 ----------
create table if not exists public.icds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null check (category in ('ext_led','ext_party','internal')),
  item_no int,
  leader text,
  party text,
  code text not null,
  revision text,
  title text,
  description text,
  interface_type text,
  requirement_ref text,
  er_content text,
  expected_start date,
  expected_end date,
  actual_start date,
  signed_date date,
  related_submittal text,
  risk_related text check (risk_related in ('Y','N')),
  status text check (status in ('OPEN','IN PROGRESS','WAIT SIGN','SIGNED','FROZEN','PENDING')),
  correspondence text,
  phase text,
  pending_start text,
  plan_sign_3m text,
  plan_issue_month text,
  remark text,
  latest_revision_date date,
  latest_revision text,
  reply_status text,
  expected_reply_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (project_id, code)
);
drop trigger if exists icds_default_project on public.icds;
create trigger icds_default_project before insert on public.icds for each row execute function public.set_default_project();
create index if not exists icds_category_idx on public.icds(category);
create index if not exists icds_status_idx on public.icds(status);

-- ---------- 版次紀錄（A/B/C/0/0A 版的發起日與從屬方回覆日） ----------
create table if not exists public.icd_revisions (
  id uuid primary key default gen_random_uuid(),
  icd_id uuid not null references public.icds(id) on delete cascade,
  revision text not null,
  issued_date date,
  reply_date date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists icd_revisions_icd_idx on public.icd_revisions(icd_id);

-- ---------- 往來文件紀錄 ----------
create table if not exists public.icd_correspondence (
  id uuid primary key default gen_random_uuid(),
  icd_id uuid not null references public.icds(id) on delete cascade,
  logged_date date,
  direction text,
  revision text,
  doc_ref text,
  remark text,
  reply_date date,
  reply_doc_ref text,
  reply_remark text,
  created_at timestamptz not null default now()
);
create index if not exists icd_corr_icd_idx on public.icd_correspondence(icd_id);

-- ---------- 異動紀錄 ----------
create table if not exists public.icd_audit (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id uuid,
  icd_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  actor uuid,
  actor_email text,
  created_at timestamptz not null default now()
);
create index if not exists icd_audit_icd_idx on public.icd_audit(icd_id, created_at desc);

create or replace function public.touch_icd()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select email from public.profiles where id = auth.uid()), new.updated_by);
  return new;
end $$;
drop trigger if exists icds_touch on public.icds;
create trigger icds_touch before update on public.icds for each row execute function public.touch_icd();

create or replace function public.log_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
  iid uuid;
begin
  iid := case when tg_table_name = 'icds' then (rec->>'id')::uuid else (rec->>'icd_id')::uuid end;
  insert into public.icd_audit(table_name,row_id,icd_id,action,old_data,new_data,actor,actor_email)
  values (tg_table_name,(rec->>'id')::uuid,iid,tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          auth.uid(),(select email from public.profiles where id = auth.uid()));
  return coalesce(new, old);
end $$;

-- 稽核觸發器在 seed 匯入後才掛上（seed_3_enable_audit.sql），避免匯入資料灌爆異動紀錄

-- ---------- Row Level Security ----------
alter table public.profiles          enable row level security;
alter table public.projects          enable row level security;
alter table public.party_codes       enable row level security;
alter table public.icds              enable row level security;
alter table public.icd_revisions     enable row level security;
alter table public.icd_correspondence enable row level security;
alter table public.icd_audit         enable row level security;

-- profiles：一般使用者只能看自己的資料；管理者可看全部名單、修改角色/刪除
-- （開放註冊後不再讓所有人看到使用者名單，避免洩漏他人 email）
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_role() = 'admin');
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.app_role() = 'admin' and id <> auth.uid());

-- 資料表：viewer 以上可讀；editor 以上可寫；admin 可刪 ICD
do $$
declare t text;
begin
  foreach t in array array['projects','party_codes','icds','icd_revisions','icd_correspondence'] loop
    execute format('drop policy if exists %I on public.%I', t||'_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.app_role() in (''viewer'',''editor'',''admin''))', t||'_select', t);
    execute format('drop policy if exists %I on public.%I', t||'_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.app_role() in (''editor'',''admin''))', t||'_insert', t);
    execute format('drop policy if exists %I on public.%I', t||'_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.app_role() in (''editor'',''admin'')) with check (public.app_role() in (''editor'',''admin''))', t||'_update', t);
  end loop;
end $$;

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete to authenticated using (public.app_role() = 'admin');

drop policy if exists icds_delete on public.icds;
create policy icds_delete on public.icds for delete to authenticated using (public.app_role() = 'admin');
drop policy if exists icd_revisions_delete on public.icd_revisions;
create policy icd_revisions_delete on public.icd_revisions for delete to authenticated using (public.app_role() in ('editor','admin'));
drop policy if exists icd_correspondence_delete on public.icd_correspondence;
create policy icd_correspondence_delete on public.icd_correspondence for delete to authenticated using (public.app_role() in ('editor','admin'));
drop policy if exists party_codes_delete on public.party_codes;
create policy party_codes_delete on public.party_codes for delete to authenticated using (public.app_role() = 'admin');

drop policy if exists icd_audit_select on public.icd_audit;
create policy icd_audit_select on public.icd_audit for select to authenticated
  using (public.app_role() in ('viewer','editor','admin'));

-- 未登入（anon）角色完全不開放
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
grant execute on function public.app_role() to authenticated;
grant execute on function public.admin_contacts() to authenticated;

-- 明確授權給登入使用者（部分專案不會自動授權；實際存取仍由 RLS 控管）
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
