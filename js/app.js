/* 界面管理系統 — 前端（純靜態，部署於 GitHub Pages；資料與驗證由 Supabase 負責） */
(() => {
'use strict';

// ---------- 常數 ----------
const STATUSES = ['OPEN', 'IN PROGRESS', 'WAIT SIGN', 'SIGNED', 'FROZEN', 'PENDING'];
const STATUS_COLOR = { 'OPEN': '#64748b', 'IN PROGRESS': '#d97706', 'WAIT SIGN': '#7c3aed', 'SIGNED': '#15803d', 'FROZEN': '#0e7490', 'PENDING': '#9ca3af' };
const CATS = { ext_led: '外部 ICD · YT 主導', ext_party: '外部 ICD · YT 從屬', internal: '內部 ICD' };
const ROLES = { pending: '待核准', viewer: '唯讀', editor: '編輯者', admin: '管理者' };
const REV_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', '0', '0A'];
const ME = 'YT1'; // 本標代碼
const ACTIVE = s => s === 'OPEN' || s === 'IN PROGRESS' || s === 'WAIT SIGN';

const FIELDS = [
  { k: 'category', l: '類別', t: 'select', opts: Object.entries(CATS) },
  { k: 'code', l: 'ICD 編碼', t: 'text', req: true },
  { k: 'item_no', l: '項次', t: 'number' },
  { k: 'leader', l: '主導者', t: 'code' },
  { k: 'party', l: '從屬者', t: 'code' },
  { k: 'revision', l: '版次', t: 'text' },
  { k: 'status', l: '狀態', t: 'select', opts: STATUSES.map(s => [s, s]), blank: true },
  { k: 'interface_type', l: '界面型態', t: 'text' },
  { k: 'risk_related', l: '與風險/安全相關', t: 'select', opts: [['Y', 'Y'], ['N', 'N']], blank: true },
  { k: 'title', l: 'ICD 名稱', t: 'area', full: true },
  { k: 'description', l: '名稱敘述 / 需求', t: 'area', full: true },
  { k: 'requirement_ref', l: '機關需求書對應章節', t: 'area' },
  { k: 'er_content', l: 'ER 對應章節內容', t: 'area' },
  { k: 'related_submittal', l: '相關送審文件 / 編號', t: 'area' },
  { k: 'phase', l: '階段 Phase', t: 'text' },
  { k: 'expected_start', l: '預期開始日', t: 'date' },
  { k: 'expected_end', l: '預期完成日', t: 'date' },
  { k: 'actual_start', l: '實際開始日', t: 'date' },
  { k: 'signed_date', l: '完成簽署日', t: 'date' },
  { k: 'latest_revision', l: '最新進版版次', t: 'text' },
  { k: 'latest_revision_date', l: '最新進版日期', t: 'date' },
  { k: 'reply_status', l: '回覆狀態', t: 'select', opts: ['已回覆', '未回覆', '逾期回覆', '無版本'].map(s => [s, s]), blank: true },
  { k: 'expected_reply_date', l: '預計回覆日期', t: 'date' },
  { k: 'plan_sign_3m', l: '未來三個月預計簽署', t: 'text' },
  { k: 'plan_issue_month', l: '本月預計進版', t: 'text' },
  { k: 'pending_start', l: 'PENDING 預計啟動時間', t: 'text' },
  { k: 'correspondence', l: '往來文件', t: 'area' },
  { k: 'remark', l: '備註', t: 'area', full: true },
];

// ---------- 小工具 ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const show = (id, on = true) => $('#' + id).classList.toggle('hidden', !on);
const parseD = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const daysBetween = (a, b) => Math.round((a - b) / 86400000);
const partnerOf = i => (i.leader === ME ? i.party : i.leader) || '—';
const splitTitle = t => { const [a, ...r] = String(t || '').split('\n'); return [a, r.join(' ').trim()]; };
const statusKey = s => String(s || '').replace(/\s/g, '');
const badge = s => s ? `<span class="badge b-${statusKey(s)}">${esc(s)}</span>` : '<span class="muted">—</span>';
const dueOf = i => i.expected_reply_date || i.expected_end || null;
const isOverdue = i => ACTIVE(i.status) && (i.reply_status === '逾期回覆' || (i.reply_status !== '已回覆' && dueOf(i) && parseD(dueOf(i)) < today));
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 3200);
}
const errMsg = e => (e && (e.message || e.error_description)) || String(e);

// ---------- 狀態 ----------
const S = { sb: null, user: null, profile: null, recovery: false, loadedFor: null,
  icds: [], revs: [], corr: [], codes: [], filters: {}, sort: {} };
const canEdit = () => ['editor', 'admin'].includes(S.profile?.role);
const isAdmin = () => S.profile?.role === 'admin';

// ---------- 啟動 / 驗證 ----------
function showOnly(view) {
  ['auth-view', 'pending-view', 'recovery-view', 'app'].forEach(id => show(id, id === view));
  if (view !== 'app') { closeDrawer(); closeModal(); }
}

function boot() {
  const cfg = window.APP_CONFIG || {};
  showOnly('auth-view');
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT') || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.startsWith('YOUR-')) {
    setMsg('#auth-msg', '尚未設定 Supabase：請編輯 js/config.js 填入 SUPABASE_URL 與 SUPABASE_ANON_KEY。', 'err');
    $('#auth-submit').disabled = true; return;
  }
  S.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  S.sb.auth.onAuthStateChange((ev, sess) => {
    // 回呼內不可直接 await supabase 呼叫，改用 setTimeout 避免死鎖
    if (ev === 'PASSWORD_RECOVERY') { S.recovery = true; setTimeout(() => showOnly('recovery-view'), 0); return; }
    if (ev === 'TOKEN_REFRESHED' || ev === 'USER_UPDATED') return;
    setTimeout(() => handleSession(sess), 0);
  });
}

async function handleSession(sess) {
  if (S.recovery) return;
  if (!sess) { S.user = null; S.profile = null; S.loadedFor = null; S.icds = []; S.revs = []; S.corr = []; showOnly('auth-view'); return; }
  if (S.loadedFor === sess.user.id) return;
  S.user = sess.user;
  const { data: p, error } = await S.sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle();
  if (error || !p) { setMsg('#auth-msg', '讀取使用者資料失敗：' + errMsg(error || '找不到 profile（請確認已執行 schema.sql）'), 'err'); await S.sb.auth.signOut(); return; }
  S.profile = p;
  if (!['viewer', 'editor', 'admin'].includes(p.role)) { $('#pending-email').textContent = p.email; showOnly('pending-view'); return; }
  try { await loadAll(); } catch (e) { setMsg('#auth-msg', '載入資料失敗：' + errMsg(e), 'err'); await S.sb.auth.signOut(); return; }
  S.loadedFor = S.user.id;
  $('#whoami').innerHTML = `${esc(p.email)}<br><span class="tag">${ROLES[p.role]}</span>`;
  show('nav-admin', isAdmin());
  showOnly('app');
  route();
}

function setMsg(sel, text, cls = '') { const el = $(sel); el.textContent = text; el.className = 'msg ' + cls; }

let authMode = 'login';
function setAuthMode(m) {
  authMode = m;
  $('#auth-title').textContent = { login: '登入', register: '申請帳號', forgot: '重設密碼' }[m];
  $('#auth-submit').textContent = { login: '登入', register: '送出申請', forgot: '寄送重設連結' }[m];
  show('auth-pw-wrap', m !== 'forgot'); $('#auth-pw').required = m !== 'forgot';
  $('#auth-pw').autocomplete = m === 'register' ? 'new-password' : 'current-password';
  $('#link-register').textContent = m === 'register' ? '返回登入' : '申請帳號';
  setMsg('#auth-msg', '');
}

$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault(); if (!S.sb) return;
  const email = $('#auth-email').value.trim(), pw = $('#auth-pw').value;
  const btn = $('#auth-submit'); btn.disabled = true; setMsg('#auth-msg', '處理中…');
  try {
    if (authMode === 'login') {
      const { error } = await S.sb.auth.signInWithPassword({ email, password: pw });
      if (error) throw error; setMsg('#auth-msg', '');
    } else if (authMode === 'register') {
      const { data, error } = await S.sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      setMsg('#auth-msg', data.session ? '' : '申請已送出。若系統要求信箱驗證請先完成驗證；之後需由管理者核准才能使用。', 'ok');
    } else {
      const { error } = await S.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) throw error; setMsg('#auth-msg', '若此信箱已註冊，將收到重設密碼信件。', 'ok');
    }
  } catch (err) {
    const m = errMsg(err);
    setMsg('#auth-msg', /Invalid login/i.test(m) ? '帳號或密碼錯誤' : /not confirmed/i.test(m) ? '信箱尚未驗證，請先至信箱點擊驗證連結' : m, 'err');
  } finally { btn.disabled = false; }
});
$('#link-register').addEventListener('click', e => { e.preventDefault(); setAuthMode(authMode === 'register' ? 'login' : 'register'); });
$('#link-forgot').addEventListener('click', e => { e.preventDefault(); setAuthMode('forgot'); });
$('#recovery-form').addEventListener('submit', async e => {
  e.preventDefault();
  const { error } = await S.sb.auth.updateUser({ password: $('#recovery-pw').value });
  if (error) return setMsg('#recovery-msg', errMsg(error), 'err');
  S.recovery = false; history.replaceState(null, '', location.pathname);
  const { data } = await S.sb.auth.getSession(); handleSession(data.session);
});
const logout = async () => { await S.sb.auth.signOut(); location.hash = ''; };
$('#btn-logout').addEventListener('click', logout);
$('#pending-logout').addEventListener('click', logout);

// ---------- 資料存取 ----------
async function fetchAll(table, orders) {
  let out = [], from = 0; const step = 1000;
  for (;;) {
    let q = S.sb.from(table).select('*');
    orders.forEach(o => { q = q.order(o, { ascending: true, nullsFirst: false }); });
    const { data, error } = await q.range(from, from + step - 1);
    if (error) throw error;
    out = out.concat(data); if (data.length < step) break; from += step;
  }
  return out;
}
async function loadAll() {
  const [icds, revs, corr, codes] = await Promise.all([
    fetchAll('icds', ['category', 'item_no', 'code']), fetchAll('icd_revisions', ['issued_date']),
    fetchAll('icd_correspondence', ['logged_date']), fetchAll('party_codes', ['code'])]);
  Object.assign(S, { icds, revs, corr, codes });
}
const byId = id => S.icds.find(i => i.id === id);
const revsOf = id => S.revs.filter(r => r.icd_id === id).sort((a, b) => REV_ORDER.indexOf(a.revision) - REV_ORDER.indexOf(b.revision));
const corrOf = id => S.corr.filter(r => r.icd_id === id).sort((a, b) => (b.logged_date || '').localeCompare(a.logged_date || ''));

// ---------- 路由 ----------
const PAGES = { dashboard: '總覽儀表板', icds: '', log: '往來文件紀錄', admin: '使用者管理' };
function route() {
  if (!S.profile || !$('#app') || $('#app').classList.contains('hidden')) return;
  const [, page = 'dashboard', arg] = (location.hash || '#/dashboard').split('/');
  const p = PAGES[page] !== undefined ? page : 'dashboard';
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === p && (p !== 'icds' || a.dataset.cat === arg)));
  $('#page-actions').innerHTML = '';
  $('.side').classList.remove('open');
  const view = $('#view');
  if (p === 'dashboard') { $('#page-title').textContent = PAGES.dashboard; viewDashboard(view); }
  else if (p === 'icds') { const cat = CATS[arg] ? arg : 'ext_led'; $('#page-title').textContent = CATS[cat]; viewList(view, cat); }
  else if (p === 'log') { $('#page-title').textContent = PAGES.log; viewLog(view); }
  else if (p === 'admin') { if (!isAdmin()) { location.hash = '#/dashboard'; return; } $('#page-title').textContent = PAGES.admin; viewAdmin(view); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
$('#btn-menu').addEventListener('click', () => $('.side').classList.toggle('open'));

// ---------- 總覽 ----------
function viewDashboard(el) {
  const all = S.icds, cnt = s => all.filter(i => i.status === s).length;
  const overdue = all.filter(isOverdue).sort((a, b) => parseD(dueOf(a)) - parseD(dueOf(b)));
  const soon = all.filter(i => ACTIVE(i.status) && i.expected_end && parseD(i.expected_end) >= today && daysBetween(parseD(i.expected_end), today) <= 90)
    .sort((a, b) => a.expected_end.localeCompare(b.expected_end));

  const stats = [`<div class="card stat" style="--c:#0b5cab"><div class="n">${all.length}</div><div class="l">ICD 總數</div></div>`]
    .concat(STATUSES.map(s => `<div class="card stat" style="--c:${STATUS_COLOR[s]}"><div class="n">${cnt(s)}</div><div class="l">${s}</div></div>`))
    .concat(`<div class="card stat" style="--c:#c62828"><div class="n">${overdue.length}</div><div class="l">逾期待處理</div></div>`).join('');

  const bars = Object.entries(CATS).map(([c, name]) => {
    const rows = all.filter(i => i.category === c), tot = rows.length || 1;
    const seg = STATUSES.map(s => { const n = rows.filter(i => i.status === s).length; return n ? `<i title="${s}: ${n}" style="--c:${STATUS_COLOR[s]};width:${n / tot * 100}%"></i>` : ''; }).join('');
    return `<div class="bar-row"><span>${name.replace('外部 ICD · ', '外部·')}</span><div class="bar">${seg}</div><b>${rows.length}</b></div>`;
  }).join('');
  const legend = STATUSES.map(s => `<span class="badge b-${statusKey(s)}">${s}</span>`).join(' ');

  // 外部界面矩陣（對口單位 × 主導方向 × 狀態）
  const partners = [...new Set(all.filter(i => i.category !== 'internal').map(partnerOf))].filter(p => p !== '—').sort();
  const col = [['O', ['OPEN']], ['I', ['IN PROGRESS', 'WAIT SIGN']], ['S', ['SIGNED']], ['P', ['PENDING']], ['F', ['FROZEN']]];
  const cell = (rows, sts) => { const n = rows.filter(i => sts.includes(i.status)).length; return `<td class="${n ? '' : 'z'}">${n}</td>`; };
  const mxRows = partners.map(p => {
    const a = all.filter(i => i.category === 'ext_led' && i.party === p), b = all.filter(i => i.category === 'ext_party' && i.leader === p);
    return `<tr><td>${esc(p)}</td>${col.map(([, s], k) => cell(a, s).replace('<td', k === 0 ? '<td style="border-left:2px solid #dde3ea"' : '<td')).join('')}${col.map(([, s], k) => cell(b, s).replace('<td', k === 0 ? '<td style="border-left:2px solid #dde3ea"' : '<td')).join('')}<td style="border-left:2px solid #dde3ea"><b>${a.length + b.length}</b></td></tr>`;
  }).join('');
  const mxHead = col.map(([l]) => `<th>${l}</th>`).join('');

  const revCnt = {}; all.forEach(i => { if (i.latest_revision != null) revCnt[i.latest_revision] = (revCnt[i.latest_revision] || 0) + 1; });
  const ri = k => { const x = REV_ORDER.indexOf(k); return x < 0 ? 99 : x; };
  const revKeys = Object.keys(revCnt).sort((a, b) => ri(a) - ri(b) || a.localeCompare(b));
  const revMax = Math.max(1, ...Object.values(revCnt));
  const revBars = revKeys.map(k => `<div class="bar-row"><span>${esc(k)}${REV_ORDER.includes(k) ? ' 版' : ''}</span><div class="bar"><i style="--c:#0b5cab;width:${revCnt[k] / revMax * 100}%"></i></div><b>${revCnt[k]}</b></div>`).join('') || '<p class="muted">尚無資料</p>';

  const list = (rows, dateFn, empty) => rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>編碼</th><th>名稱</th><th>狀態</th><th>日期</th></tr></thead><tbody>${rows.slice(0, 12).map(i =>
    `<tr class="clickable" data-open="${i.id}"><td class="code">${esc(i.code)}</td><td>${esc(splitTitle(i.title)[0])}</td><td>${badge(i.status)}</td><td>${dateFn(i)}</td></tr>`).join('')}</tbody></table></div>${rows.length > 12 ? `<p class="muted">另有 ${rows.length - 12} 筆…</p>` : ''}` : `<p class="muted">${empty}</p>`;

  el.innerHTML = `
    <div class="grid g-cards">${stats}</div>
    <div class="grid g-2" style="margin-top:14px">
      <div class="card"><h3>各類別狀態分佈</h3>${bars}<div style="margin-top:10px">${legend}</div></div>
      <div class="card"><h3>最新進版版次分佈</h3>${revBars}</div>
      <div class="card" style="grid-column:1/-1"><h3>外部界面矩陣（O 開啟 · I 進行中 · S 已簽署 · P 待啟動 · F 凍結）</h3>
        <div class="tbl-wrap"><table class="mx"><thead><tr><th rowspan="2">對口單位</th><th colspan="5" style="border-left:2px solid #dde3ea">YT01 主導</th><th colspan="5" style="border-left:2px solid #dde3ea">對方主導（YT01 從屬）</th><th rowspan="2" style="border-left:2px solid #dde3ea">合計</th></tr><tr>${mxHead}${mxHead}</tr></thead><tbody>${mxRows}</tbody></table></div></div>
      <div class="card"><h3>逾期待處理（${overdue.length}）</h3>${list(overdue, i => { const d = dueOf(i); return d ? `${d}<br><span class="tag warn">逾 ${daysBetween(today, parseD(d))} 天</span>` : '<span class="tag warn">逾期回覆</span>'; }, '目前沒有逾期項目 🎉')}</div>
      <div class="card"><h3>90 天內預計完成（${soon.length}）</h3>${list(soon, i => `${i.expected_end}<br><span class="tag">剩 ${daysBetween(parseD(i.expected_end), today)} 天</span>`, '未來 90 天沒有預計完成項目')}</div>
    </div>`;
}

// ---------- ICD 列表 ----------
function viewList(el, cat) {
  const f = S.filters[cat] = S.filters[cat] || { q: '', status: '', partner: '', risk: '', overdue: false };
  const sort = S.sort[cat] = S.sort[cat] || { k: 'code', dir: 1 };
  const base = S.icds.filter(i => i.category === cat);
  const partners = [...new Set(base.map(partnerOf))].sort();
  const opt = (arr, cur) => arr.map(v => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');

  el.innerHTML = `
    <div class="toolbar">
      <label class="grow">搜尋<input id="f-q" placeholder="編碼 / 名稱 / 內容 / 備註" value="${esc(f.q)}"></label>
      <label class="f">狀態<select id="f-status"><option value="">全部</option>${opt(STATUSES, f.status)}</select></label>
      <label class="f">對口單位<select id="f-partner"><option value="">全部</option>${opt(partners, f.partner)}</select></label>
      <label class="f">風險相關<select id="f-risk"><option value="">全部</option>${opt(['Y', 'N'], f.risk)}</select></label>
      <label class="f" style="flex:0 0 auto;flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="f-over" style="width:auto" ${f.overdue ? 'checked' : ''}>僅看逾期</label>
      <span class="count" id="f-count"></span>
    </div>
    <div class="tbl-wrap"><table><thead><tr id="thead"></tr></thead><tbody id="tbody"></tbody></table></div>`;

  const cols = [['item_no', '#', 'num'], ['code', '編碼'], ['title', '名稱'], ['partner', '對口'], ['revision', '版次', 'num'], ['interface_type', '型態'], ['risk_related', '風險', 'num'], ['status', '狀態'], ['reply_status', '回覆'], ['due', '預計日'], ['latest_revision_date', '最新進版']];
  const sv = (i, k) => k === 'partner' ? partnerOf(i) : k === 'due' ? (dueOf(i) || '') : (i[k] ?? '');
  const draw = () => {
    let rows = base.filter(i => {
      if (f.status && i.status !== f.status) return false;
      if (f.partner && partnerOf(i) !== f.partner) return false;
      if (f.risk && i.risk_related !== f.risk) return false;
      if (f.overdue && !isOverdue(i)) return false;
      if (f.q) { const hay = [i.code, i.title, i.description, i.remark, i.related_submittal, i.requirement_ref].join(' ').toLowerCase(); if (!f.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false; }
      return true;
    });
    rows.sort((a, b) => { const x = sv(a, sort.k), y = sv(b, sort.k); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh-Hant', { numeric: true })) * sort.dir; });
    S.listRows = rows;
    $('#f-count').textContent = `${rows.length} / ${base.length} 筆`;
    $('#thead').innerHTML = cols.map(([k, l, c]) => `<th class="sort ${c || ''}" data-k="${k}">${l}${sort.k === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    $('#tbody').innerHTML = rows.map(i => { const [t1, t2] = splitTitle(i.title); return `<tr class="clickable" data-open="${i.id}">
      <td class="num">${i.item_no ?? ''}</td><td class="code">${esc(i.code)}</td>
      <td class="title-cell">${esc(t1)}${t2 ? `<small>${esc(t2)}</small>` : ''}</td><td>${esc(partnerOf(i))}</td><td class="num">${esc(i.revision ?? '')}</td>
      <td>${esc(i.interface_type ?? '')}</td><td class="num">${i.risk_related === 'Y' ? '<span class="tag risk">Y</span>' : esc(i.risk_related ?? '')}</td>
      <td>${badge(i.status)}${isOverdue(i) ? ' <span class="tag warn">逾期</span>' : ''}</td><td>${esc(i.reply_status ?? '')}</td>
      <td>${esc(dueOf(i) ?? '')}</td><td>${esc(i.latest_revision_date ?? '')}${i.latest_revision ? ` <span class="tag">${esc(i.latest_revision)}版</span>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:30px">沒有符合條件的 ICD</td></tr>`;
  };
  draw();
  $('#f-q').addEventListener('input', e => { f.q = e.target.value; draw(); });
  $('#f-status').addEventListener('change', e => { f.status = e.target.value; draw(); });
  $('#f-partner').addEventListener('change', e => { f.partner = e.target.value; draw(); });
  $('#f-risk').addEventListener('change', e => { f.risk = e.target.value; draw(); });
  $('#f-over').addEventListener('change', e => { f.overdue = e.target.checked; draw(); });
  $('#thead').addEventListener('click', e => { const th = e.target.closest('th[data-k]'); if (!th) return; const k = th.dataset.k; sort.dir = sort.k === k ? -sort.dir : 1; sort.k = k; draw(); });

  const act = $('#page-actions');
  act.innerHTML = `<button class="btn" id="btn-csv">匯出 CSV</button>${canEdit() ? '<button class="btn primary" id="btn-new">＋ 新增 ICD</button>' : ''}`;
  $('#btn-csv').onclick = () => exportCsv(S.listRows, `ICD_${cat}_${new Date().toISOString().slice(0, 10)}.csv`);
  if (canEdit()) $('#btn-new').onclick = () => openIcdForm(null, cat);
}

function exportCsv(rows, name) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [FIELDS.map(f => q(f.l)).join(',')].concat(rows.map(r => FIELDS.map(f => q(f.k === 'category' ? CATS[r.category] : r[f.k])).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// ---------- 往來文件列表 ----------
function viewLog(el) {
  const f = S.filters.log = S.filters.log || { q: '' };
  el.innerHTML = `<div class="toolbar"><label class="grow">搜尋<input id="l-q" placeholder="ICD 編碼 / 名稱 / 文號 / 備註" value="${esc(f.q)}"></label><span class="count" id="l-count"></span></div>
  <div class="tbl-wrap"><table><thead><tr><th>日期</th><th>ICD</th><th>方向</th><th>版次</th><th>發文文號</th><th>備註</th><th>回覆日</th><th>回覆文號</th><th>回覆備註</th></tr></thead><tbody id="l-body"></tbody></table></div>`;
  const draw = () => {
    const rows = S.corr.map(c => ({ c, i: byId(c.icd_id) })).filter(x => x.i).filter(({ c, i }) => !f.q || [i.code, i.title, c.doc_ref, c.remark, c.reply_doc_ref, c.reply_remark].join(' ').toLowerCase().includes(f.q.toLowerCase()))
      .sort((a, b) => (b.c.logged_date || '').localeCompare(a.c.logged_date || ''));
    $('#l-count').textContent = `${rows.length} 筆`;
    $('#l-body').innerHTML = rows.map(({ c, i }) => `<tr class="clickable" data-open="${i.id}"><td>${esc(c.logged_date ?? '')}</td><td><span class="code">${esc(i.code)}</span><br><small class="muted">${esc(splitTitle(i.title)[0])}</small></td><td>${esc(c.direction ?? '')}</td><td>${esc(c.revision ?? '')}</td><td>${esc(c.doc_ref ?? '')}</td><td>${esc(c.remark ?? '')}</td><td>${esc(c.reply_date ?? '')}</td><td>${esc(c.reply_doc_ref ?? '')}</td><td>${esc(c.reply_remark ?? '')}</td></tr>`).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:30px">沒有紀錄</td></tr>';
  };
  draw(); $('#l-q').addEventListener('input', e => { f.q = e.target.value; draw(); });
}

// ---------- 使用者管理 ----------
async function viewAdmin(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  const { data, error } = await S.sb.from('profiles').select('*').order('created_at');
  if (error) { el.innerHTML = `<p class="msg err">${esc(errMsg(error))}</p>`; return; }
  el.innerHTML = `<p class="muted">新註冊者預設為「待核准」，無法讀取任何資料；請在此指派角色。唯讀＝只能瀏覽；編輯者＝可新增/修改；管理者＝可刪除 ICD 並管理使用者。</p>
  <div class="tbl-wrap"><table><thead><tr><th>電子郵件</th><th>註冊時間</th><th>角色</th></tr></thead><tbody>${data.map(p => `<tr><td>${esc(p.email)}</td><td>${esc((p.created_at || '').slice(0, 10))}</td><td>
    <select data-uid="${p.id}" ${p.id === S.user.id ? 'disabled title="不可變更自己的角色"' : ''} style="max-width:160px">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`;
  el.onchange = async e => {
    const sel = e.target.closest('select[data-uid]'); if (!sel) return;
    const { error: er } = await S.sb.from('profiles').update({ role: sel.value }).eq('id', sel.dataset.uid);
    er ? toast('更新失敗：' + errMsg(er), true) : toast('角色已更新');
  };
}

// ---------- 詳細資料 Drawer ----------
function openDrawer(id) {
  const i = byId(id); if (!i) return;
  const revs = revsOf(id), corr = corrOf(id), ed = canEdit();
  const dd = FIELDS.filter(f => !['title', 'category'].includes(f.k) && i[f.k] != null && i[f.k] !== '').map(f => `<dt>${f.l}</dt><dd>${f.k === 'status' ? badge(i.status) : esc(i[f.k])}</dd>`).join('');
  const [t1, t2] = splitTitle(i.title);
  $('#drawer').innerHTML = `
    <div class="head"><div><div class="code muted">${esc(i.code)} · ${esc(CATS[i.category])}</div><h3>${esc(t1)}</h3>${t2 ? `<div class="muted">${esc(t2)}</div>` : ''}<div style="margin-top:6px">${badge(i.status)} ${isOverdue(i) ? '<span class="tag warn">逾期</span>' : ''}</div></div>
      <div style="display:flex;gap:6px;flex-shrink:0">${ed ? '<button class="btn small" data-act="edit">編輯</button>' : ''}${isAdmin() ? '<button class="btn small danger" data-act="del">刪除</button>' : ''}<button class="btn small" data-act="close">✕</button></div></div>
    <dl class="dl">${dd}</dl>
    <div class="sec"><h4>版次紀錄（發起 / 從屬方回覆）${ed ? '<button class="btn small" data-act="add-rev">＋ 新增版次</button>' : ''}</h4>
      ${revs.length ? `<table><thead><tr><th>版次</th><th>發起日期</th><th>回覆日期</th><th>備註</th><th></th></tr></thead><tbody>${revs.map(r => `<tr><td><b>${esc(r.revision)}</b></td><td>${esc(r.issued_date ?? '')}</td><td>${esc(r.reply_date ?? '')}</td><td>${esc(r.note ?? '')}</td><td>${ed ? `<button class="btn small" data-act="edit-rev" data-id="${r.id}">編輯</button> <button class="btn small danger" data-act="del-rev" data-id="${r.id}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">尚無版次紀錄</p>'}</div>
    <div class="sec"><h4>往來文件${ed ? '<button class="btn small" data-act="add-corr">＋ 新增往來</button>' : ''}</h4>
      ${corr.length ? `<table><thead><tr><th>日期</th><th>版次</th><th>發文</th><th>回覆</th><th></th></tr></thead><tbody>${corr.map(c => `<tr><td>${esc(c.logged_date ?? '')}</td><td>${esc(c.revision ?? '')}</td><td>${esc(c.doc_ref ?? '')}${c.remark ? `<br><small class="muted">${esc(c.remark)}</small>` : ''}</td><td>${esc(c.reply_date ?? '')} ${esc(c.reply_doc_ref ?? '')}${c.reply_remark ? `<br><small class="muted">${esc(c.reply_remark)}</small>` : ''}</td><td>${ed ? `<button class="btn small" data-act="edit-corr" data-id="${c.id}">編輯</button> <button class="btn small danger" data-act="del-corr" data-id="${c.id}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">尚無往來文件紀錄</p>'}</div>
    <div class="sec"><h4>異動紀錄</h4><ul class="audit" id="audit-list"><li>載入中…</li></ul>
      <p class="muted" style="font-size:12px">最後更新：${esc((i.updated_at || '').replace('T', ' ').slice(0, 16))} ${esc(i.updated_by ?? '')}</p></div>`;
  S.openId = id; show('drawer'); show('drawer-mask');
  loadAudit(id);
}
async function loadAudit(id) {
  const { data, error } = await S.sb.from('icd_audit').select('table_name,action,actor_email,created_at,old_data,new_data').eq('icd_id', id).order('created_at', { ascending: false }).limit(20);
  const ul = $('#audit-list'); if (!ul || S.openId !== id) return;
  if (error) { ul.innerHTML = `<li>${esc(errMsg(error))}</li>`; return; }
  const T = { icds: 'ICD', icd_revisions: '版次', icd_correspondence: '往來' }, A = { INSERT: '新增', UPDATE: '修改', DELETE: '刪除' };
  const diff = r => r.action !== 'UPDATE' ? '' : Object.keys(r.new_data || {}).filter(k => !['updated_at', 'updated_by'].includes(k) && JSON.stringify(r.new_data[k]) !== JSON.stringify(r.old_data?.[k])).join('、');
  ul.innerHTML = data.length ? data.map(r => `<li>${esc(r.created_at.replace('T', ' ').slice(0, 16))} · ${esc(r.actor_email ?? '系統')} ${A[r.action]}${T[r.table_name]}${diff(r) ? `（${esc(diff(r))}）` : ''}</li>`).join('') : '<li>尚無異動紀錄</li>';
}
function closeDrawer() { show('drawer', false); show('drawer-mask', false); S.openId = null; }
$('#drawer-mask').addEventListener('click', closeDrawer);

// ---------- 編輯表單 ----------
function closeModal() { show('modal', false); show('modal-mask', false); }
$('#modal-mask').addEventListener('click', closeModal);
function openModal(html) { $('#modal').innerHTML = html; show('modal'); show('modal-mask'); }
const inputFor = (f, v) => {
  const val = v ?? '', n = `name="${f.k}"`;
  if (f.t === 'area') return `<textarea ${n}>${esc(val)}</textarea>`;
  if (f.t === 'date') return `<input type="date" ${n} value="${esc(val)}">`;
  if (f.t === 'number') return `<input type="number" ${n} value="${esc(val)}">`;
  if (f.t === 'code') return `<input ${n} list="dl-codes" value="${esc(val)}">`;
  if (f.t === 'select') return `<select ${n}>${f.blank ? '<option value=""></option>' : ''}${f.opts.map(([k, l]) => `<option value="${esc(k)}" ${k === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `<input ${n} value="${esc(val)}" ${f.req ? 'required' : ''}>`;
};
const readForm = (form, fields) => { const o = {}; fields.forEach(f => { let v = form.elements[f.k]?.value ?? ''; v = v.trim(); o[f.k] = v === '' ? null : (f.t === 'number' ? Number(v) : v); }); return o; };

function openIcdForm(id, cat) {
  const i = id ? byId(id) : { category: cat || 'ext_led', leader: 'YT1', status: 'OPEN' };
  openModal(`<h3 style="margin-bottom:14px">${id ? '編輯 ICD · ' + esc(i.code) : '新增 ICD'}</h3>
    <datalist id="dl-codes">${S.codes.map(c => `<option value="${esc(c.code)}">${esc(c.name_zh ?? '')}</option>`).join('')}</datalist>
    <form id="icd-form"><div class="form">${FIELDS.map(f => `<label class="${f.full || f.t === 'area' ? 'full' : ''}">${f.l}${inputFor(f, i[f.k])}</label>`).join('')}</div>
    <div id="form-msg" class="msg err"></div><div class="form-actions"><button type="button" class="btn" data-act="close-modal">取消</button><button class="btn primary" type="submit">儲存</button></div></form>`);
  $('#icd-form').onsubmit = async e => {
    e.preventDefault();
    const payload = readForm(e.target, FIELDS);
    const q = id ? S.sb.from('icds').update(payload).eq('id', id) : S.sb.from('icds').insert(payload);
    const { data, error } = await q.select().single();
    if (error) return setMsg('#form-msg', error.code === '23505' ? 'ICD 編碼已存在' : errMsg(error), 'err');
    const idx = S.icds.findIndex(x => x.id === data.id); idx >= 0 ? S.icds[idx] = data : S.icds.push(data);
    closeModal(); toast('已儲存'); route(); if (S.openId === data.id || !id) openDrawer(data.id);
  };
}

const REV_F = [{ k: 'revision', l: '版次（A/B/C/D/E/F/0/0A）', t: 'text', req: true }, { k: 'issued_date', l: '發起日期', t: 'date' }, { k: 'reply_date', l: '從屬方回覆日期', t: 'date' }, { k: 'note', l: '備註', t: 'area', full: true }];
const CORR_F = [{ k: 'logged_date', l: '日期', t: 'date' }, { k: 'direction', l: '往來方向（主導-從屬）', t: 'text' }, { k: 'revision', l: '版次', t: 'text' }, { k: 'doc_ref', l: '發文文號 / 連結', t: 'text' }, { k: 'remark', l: '備註', t: 'area', full: true }, { k: 'reply_date', l: '從屬方回覆日期', t: 'date' }, { k: 'reply_doc_ref', l: '回覆文號 / 連結', t: 'text' }, { k: 'reply_remark', l: '回覆備註', t: 'area', full: true }];
function openSubForm(kind, icdId, row) {
  const isRev = kind === 'rev', F = isRev ? REV_F : CORR_F, table = isRev ? 'icd_revisions' : 'icd_correspondence', key = isRev ? 'revs' : 'corr';
  openModal(`<h3 style="margin-bottom:14px">${row ? '編輯' : '新增'}${isRev ? '版次紀錄' : '往來文件'} · ${esc(byId(icdId).code)}</h3>
    <form id="sub-form"><div class="form">${F.map(f => `<label class="${f.full ? 'full' : ''}">${f.l}${inputFor(f, row?.[f.k])}</label>`).join('')}</div>
    <div id="form-msg" class="msg err"></div><div class="form-actions"><button type="button" class="btn" data-act="close-modal">取消</button><button class="btn primary" type="submit">儲存</button></div></form>`);
  $('#sub-form').onsubmit = async e => {
    e.preventDefault();
    const payload = readForm(e.target, F);
    const q = row ? S.sb.from(table).update(payload).eq('id', row.id) : S.sb.from(table).insert({ ...payload, icd_id: icdId });
    const { data, error } = await q.select().single();
    if (error) return setMsg('#form-msg', errMsg(error), 'err');
    const idx = S[key].findIndex(x => x.id === data.id); idx >= 0 ? S[key][idx] = data : S[key].push(data);
    closeModal(); toast('已儲存'); openDrawer(icdId);
  };
}

// ---------- 全域事件委派 ----------
document.addEventListener('click', async e => {
  const open = e.target.closest('[data-open]');
  if (open && !e.target.closest('button,a')) return openDrawer(open.dataset.open);
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = S.openId, rid = b.dataset.id;
  if (act === 'close') return closeDrawer();
  if (act === 'close-modal') return closeModal();
  if (!canEdit()) return;
  if (act === 'edit') return openIcdForm(id);
  if (act === 'add-rev') return openSubForm('rev', id, null);
  if (act === 'edit-rev') return openSubForm('rev', id, S.revs.find(r => r.id === rid));
  if (act === 'add-corr') return openSubForm('corr', id, null);
  if (act === 'edit-corr') return openSubForm('corr', id, S.corr.find(r => r.id === rid));
  if (act === 'del-rev' || act === 'del-corr') {
    if (!confirm('確定刪除此筆紀錄？')) return;
    const rev = act === 'del-rev', { error } = await S.sb.from(rev ? 'icd_revisions' : 'icd_correspondence').delete().eq('id', rid);
    if (error) return toast('刪除失敗：' + errMsg(error), true);
    S[rev ? 'revs' : 'corr'] = S[rev ? 'revs' : 'corr'].filter(r => r.id !== rid); toast('已刪除'); return openDrawer(id);
  }
  if (act === 'del' && isAdmin()) {
    const i = byId(id); if (!confirm(`確定刪除 ${i.code}？其版次與往來紀錄也會一併刪除，且無法復原。`)) return;
    const { error } = await S.sb.from('icds').delete().eq('id', id);
    if (error) return toast('刪除失敗：' + errMsg(error), true);
    S.icds = S.icds.filter(x => x.id !== id); S.revs = S.revs.filter(r => r.icd_id !== id); S.corr = S.corr.filter(r => r.icd_id !== id);
    closeDrawer(); toast('已刪除'); route();
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });

boot();
})();
