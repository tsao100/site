-- 把指定 email 設為管理者（在 Supabase SQL Editor 執行；請先把 email 改成對方註冊用的信箱）。
-- 該帳號必須已完成 Email 驗證，否則仍無法使用。
update public.profiles set role = 'admin' where email = 'you@example.com';
