# 界面管理系統（ICD Management）

高雄捷運黃線 YT01 界面控制文件（ICD）管理系統。純靜態前端（GitHub Pages）＋ Supabase（Auth + Postgres + RLS）。**必須登入才能使用**，且權限由資料庫 RLS 強制執行（不是只有前端隱藏）。

## 功能
- 登入 / 註冊 / 忘記密碼 / 重寄驗證信（Supabase Auth，Email + 密碼）
- **開放註冊：Email 驗證完成即可以「唯讀」身分使用，不需管理者核準。** 信箱未驗證者，資料庫一律視為無權限。
- 角色：`viewer` 唯讀（新註冊者預設）→ `editor` 可編輯 → `admin` 可刪除、管理使用者；`disabled` 停用（封鎖個別帳號）。唯讀使用者頁面上方會顯示提示與管理者信箱，需要編輯權限時請他們聯繫管理者，由管理者在「使用者管理」改為「編輯者」。**第一位註冊者自動成為 admin**
- 總覽儀表板：狀態統計、各類別分佈、版次分佈、外部界面矩陣（O/I/S/P/F）、各對口單位圓餅圖（數量佔比＋各單位的狀態、最新版次、回覆情形、主導從屬可勾選並列（左右或上下））、逾期待處理、90 天內預計完成
- ICD 列表（外部-YT主導 104 筆 / 外部-YT從屬 80 筆 / 內部 8 筆）：搜尋、狀態/對口/風險/逾期篩選、排序、匯出 CSV
- ICD 詳細：全部欄位、版次紀錄（A/B/C/D/E/F/0/0A 發起與回覆日）、往來文件、異動紀錄（稽核）
- 新增 / 編輯 / 刪除 ICD、版次、往來文件（依角色）
- 往來文件總表、使用者角色管理

## 往來文件 → ICD 狀態連動
新增/編輯往來文件時，系統會自動：
- 同步該版次的「版次紀錄」（發起日、回覆日）
- 更新 ICD 的版次、最新進版日期、回覆狀態（有回覆日＝已回覆；否則未回覆，預計回覆日＝發文日+30 天，已逾期則為逾期回覆）
- 建議並可更新 ICD 狀態：0/0A 版已回覆＝SIGNED（並填入簽署日）；0/0A 版未回覆＝WAIT SIGN；A~F 版往來＝IN PROGRESS。表單中可改選或選「不變更」
- 刪除往來文件會重算版次/回覆欄位（不變更狀態）

## 多專案
側邊欄可切換專案、新增專案（編輯者以上）、專案設定（改名；刪除僅管理者，需輸入代號確認）。每個專案有自己的 ICD、版次、往來文件與代碼表；「本標代碼」（如 YT1、YT2）用來判斷主導/從屬方向。目前所有已驗證信箱的使用者（至少唯讀）都可看到所有專案。
既有資料庫請執行 `supabase/migrate_multi_project.sql` 升級（現有資料歸入 YT01）。

## 既有資料庫升級：開放註冊（免核準）
舊版是「新註冊者待核准」。要改成「Email 驗證後即唯讀」，在 SQL Editor 執行一次 `supabase/migrate_open_registration.sql`（可重複執行）。注意：原本待核准的帳號會一律轉為「唯讀」；若其中有你刻意封鎖的，請到「使用者管理」改為「停用」。

## 部署步驟
### 1. Supabase
1. 建立專案。SQL Editor 依序執行：`supabase/schema.sql` → `seed_1_icds.sql` → `seed_2_revisions_correspondence.sql` → `seed_3_enable_audit.sql`
2. Authentication → Sign In / Providers → Email：保持開啟「Allow new users to sign up」與 **「Confirm email」**（Email 驗證是開放註冊的唯一關卡）。即使誤關「Confirm email」，資料庫也會擋下未驗證的信箱，但建議保持開啟。Supabase 內建寄信服務有嚴格的寄信額度，註冊人數多時請在 Authentication → SMTP Settings 設定自己的 SMTP。
   - 若只想讓特定單位註冊（例如公司信箱網域），可在 `handle_new_user()` 開頭加入網域檢查，範例見 `supabase/migrate_open_registration.sql`。
3. Authentication → URL Configuration：**Site URL 改成你的 GitHub Pages 網址**（`https://<帳號>.github.io/<repo>/`，預設值 `http://localhost:3000` 會讓註冊確認信、重設密碼信的連結都跑到 localhost），並在 Redirect URLs 加入同一網址與 `https://<帳號>.github.io/<repo>/**`。接著把同一網址填入 `js/config.js` 的 `SITE_URL`（在本機測試時也能讓信件連到正式網站）。
4. **先自己註冊第一個帳號並完成 Email 驗證**（自動成為 admin）。之後其他人自行註冊、驗證後即可唯讀使用；有人要求編輯權限時，到「使用者管理」把他的角色改為「編輯者」。
   - 若目前沒有任何管理者（例如第一位註冊者不是你），到 Supabase SQL Editor 執行 `supabase/approve_admin.sql`，把指定 email 直接設為管理者。
5. Project Settings → API 複製 `Project URL` 與 `anon public key`。

### 2. 前端
1. 編輯 `js/config.js` 填入 URL 與 anon key（anon key 是公開金鑰，**絕不可放 service_role key**）。
2. 推到 GitHub，Settings → Pages → Source 選 **GitHub Actions**；推送到 `main` 即自動部署（只發佈 `index.html`、`css/`、`js/`）。
3. `supabase/seed_*.sql` 含專案資料，已在 `.gitignore`；若要放進 repo 請用私有 repo。

## 資料對應
| 來源 Excel 工作表 | 資料表 |
|---|---|
| 外部ICD(YT主導)／外部ICD (YT從屬)／內部ICD | `icds`（`category` = ext_led / ext_party / internal） |
| 各表的 A~F、0、0A 版發起/回覆日 | `icd_revisions` |
| ICD作業狀況 | `icd_correspondence` |
| Legend and Note、矩陣表代碼 | `party_codes` |
| ICD-YM01-YT01_20241113.xlsx（舊版 38 筆 RST/PSY/SIG 等） | 與 V1 編碼完全重複，僅把 V1 缺漏的欄位（需求書章節、送審文件、風險、階段…）合併補入 |

矩陣表與進度圖是由 `icds` 即時統計，不另存。
