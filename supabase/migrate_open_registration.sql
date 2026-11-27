-- ============================================================
-- 既有資料庫升級：開放註冊，Email 驗證完成即可「唯讀」使用（免管理者核準）（可重複執行）
-- 在 SQL Editor 執行一次即可。
--
-- 變更內容：
--   1) 角色 pending(待核准) 改為 disabled(停用)；新註冊者預設 viewer(唯讀)
--   2) app_role()：信箱未驗證者一律視為無權限（資料庫層把關）
--   3) profiles 不再開放給所有使用者瀏覽（只能看自己；管理者看全部），避免洩漏他人 email
--   4) 新增 admin_contacts()：讓唯讀使用者知道要聯繫哪位管理者申請編輯權限
--
-- 注意：既有的 pending（待核准）帳號會一律轉為 viewer(唯讀)。
--       若其中有你刻意封鎖的帳號，執行後請到「使用者管理」把它改為「停用」。
-- ============================================================

-- 1) 角色
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;
update public.profiles set role = 'viewer' where role = 'pending';
alter table public.profiles add constraint profiles_role_check check (role in ('disabled','viewer','editor','admin'));
alter table public.profiles alter column role set default 'viewer';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- （選用）只允許特定網域註冊：在這裡加入
  --   if new.email not like '%@your-company.com' then raise exception '此網域不允許註冊'; end if;
  insert into public.profiles(id, email, display_name, role)
  values (new.id, new.email, split_part(new.email,'@',1),
          case when not exists (select 1 from public.profiles) then 'admin' else 'viewer' end);
  return new;
end $$;

-- 2) 信箱未驗證 → 無權限
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid() and u.email_confirmed_at is not null
  ), 'none')
$$;

-- 3) profiles 只開放給本人與管理者
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_role() = 'admin');

-- 4) 申請編輯權限的聯繫窗口
create or replace function public.admin_contacts()
returns table(email text) language sql stable security definer set search_path = public as $$
  select p.email from public.profiles p
  where p.role = 'admin' and public.app_role() in ('viewer','editor','admin')
  order by p.created_at
$$;
revoke execute on function public.admin_contacts() from public, anon;
grant execute on function public.admin_contacts() to authenticated;
