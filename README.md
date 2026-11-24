# 界面管理系統（ICD Management）

高雄捷運黃線 YT01 界面控制文件（ICD）管理系統。純靜態前端（GitHub Pages）＋ Supabase（Auth + Postgres + RLS）。**必須登入才能使用**，且權限由資料庫 RLS 強制執行（不是只有前端隱藏）。

## 功能
- 登入 / 申請帳號 / 忘記密碼（Supabase Auth，Email + 密碼）
- 角色：`pending` 待核准（無任何資料權限）→ `viewer` 唯讀 → `editor` 可編輯 → `admin` 可刪除、管理使用者。**第一位註冊者自動成為 admin**
- 總覽儀表板：狀態統計、各類別分佈、版次分佈、外部界面矩陣（O/I/S/P/F）、逾期待處理、90 天內預計完成
- ICD 列表（外部-YT主導 104 筆 / 外部-YT從屬 80 筆 / 內部 8 筆）：搜尋、狀態/對口/風險/逾期篩選、排序、匯出 CSV
- ICD 詳細：全部欄位、版次紀錄（A/B/C/D/E/F/0/0A 發起與回覆日）、往來文件、異動紀錄（稽核）
- 新增 / 編輯 / 刪除 ICD、版次、往來文件（依角色）
- 往來文件總表、使用者角色管理

## 多專案
側邊欄可切換專案、新增專案（編輯者以上）、專案設定（改名；刪除僅管理者，需輸入代號確認）。每個專案有自己的 ICD、版次、往來文件與代碼表；「本標代碼」（如 YT1、YT2）用來判斷主導/從屬方向。目前所有已核准使用者可看到所有專案。
既有資料庫請執行 `supabase/migrate_multi_project.sql` 升級（現有資料歸入 YT01）。

## 部署步驟
### 1. Supabase
1. 建立專案。SQL Editor 依序執行：`supabase/schema.sql` → `seed_1_icds.sql` → `seed_2_revisions_correspondence.sql` → `seed_3_enable_audit.sql`
2. Authentication → Sign In / Providers → Email：建議 **關閉「Allow new users to sign up」** 並由 Authentication → Users 邀請/建立帳號（即使開啟註冊，新帳號也只是 `pending`，讀不到資料）。
3. Authentication → URL Configuration：Site URL 設為你的 GitHub Pages 網址（`https://<帳號>.github.io/<repo>/`），並加入 Redirect URLs。
4. **先自己註冊／建立第一個帳號**（自動成為 admin），之後在「使用者管理」核准其他人。
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
