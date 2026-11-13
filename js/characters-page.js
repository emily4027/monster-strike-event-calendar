document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // =====================================================
    // 📖 角色頁
    //   1. 設定與常數
    //   2. DOM 與狀態
    //   3. 資料整理
    //   4. 登入與管理員的名稱修正
    //   5. 渲染 (一律用 textContent，不用 innerHTML 拼字串)
    //   6. 啟動 (含從行事曆跳過來的 ?q=角色名稱)
    //
    // 這個頁面絕對不寫入抽卡紀錄或果實分配的資料。
    // 會寫入的只有管理員的名稱修正 (Firestore shared/characters) 和編輯模式對角色名冊的修改 (shared/roster)。抽卡紀錄本身由抽卡統計
    // 在各使用者打開時套用修正 (notes.js 的 renameCharacters)，果實分配同步改匯入對應。
    // 共用的讀取、登入、工具箱在 common.js
    // =====================================================

    const {
        buildAliasMap, buildCatalog, listAccounts, sortCatalog, filterByQuery, findSimilarNames,
        poolOf
    } = window.Catalog;
    const { buildLimitedLookup, readNameFixes, resolveName, isDistinct, isPeriodPool, poolKey } = window.CharacterPools;
    const Roster = window.Roster;
    const S = window.Shared;
    const { el } = S;

    // =====================================================
    // 1. 設定與常數
    // =====================================================
    const SEARCH_DEBOUNCE_MS = 200;
    const TAG_LABELS = { honke: '本家', collab: '合作', free: '免費' };


    // =====================================================
    // 2. DOM 與狀態
    // =====================================================
    const $ = (id) => document.getElementById(id);
    const els = {
        statusDot: $('statusDot'),
        statusText: $('cloudStatusText'),
        loginBtn: $('google-login-btn'),
        userInfo: $('user-info'),
        avatar: $('user-avatar'),
        userName: $('user-display-name'),
        logoutBtn: $('logout-btn'),
        notice: $('source-notice'),
        search: $('search-input'),
        account: $('account-filter'),
        sort: $('sort-select'),
        pool: $('pool-filter'),
        tagFilters: [...document.querySelectorAll('.tag-filter')],
        summary: $('summary'),
        list: $('catalog-list'),
        empty: $('empty-message'),
        adminBadge: $('admin-badge'),
        editBtn: $('edit-mode-btn'),
        issueFilter: $('issue-filter'),
        rosterNames: $('roster-names')
    };

    let records = [];
    let aliasMap = new Map();
    let similarMap = new Map();
    let pools = [];
    let limitedOf = buildLimitedLookup([]);
    let nameFixes = readNameFixes(null);
    let elementClass = () => '';   // 角色名稱 → 屬性的 CSS class
    let isAdmin = false;
    let roster = null;        // 角色名冊 (characters.json 套上管理員的修改)：{ base, edits, data, names }
    let editMode = false;     // 管理員的編輯模式：清單換成整份名冊
    let rosterSimilar = null; // 名冊裡只差一個字的名稱 (名冊變動時重算)
    let openName = '';        // 存檔後重新渲染時，維持展開這個角色
    let source = 'pending';   // pending (確認登入中) | local | cloud | cloud-error
    let loadToken = 0;        // 登入狀態改變時，丟掉舊的讀取結果


    // =====================================================
    // 3. 資料整理 (讀取在 common.js)
    // =====================================================
    const fixedName = (name) => resolveName(nameFixes, name);

    // 疑似相同：用修正後的名稱比對，管理員標成「不同角色」的不再提示
    function updateSimilar() {
        similarMap = new Map();
        findSimilarNames(buildCatalog(records, { rename: fixedName }).map((e) => e.name)).forEach((others, name) => {
            const left = others.filter((o) => !isDistinct(nameFixes, name, o));
            if (left.length > 0) similarMap.set(name, left);
        });
    }

    function setRecords(list, newSource) {
        records = list;
        source = newSource;
        updateSimilar();
        renderAccountOptions();
        renderNotice();
        render();
    }


    // =====================================================
    // 4. 登入與管理員的名稱修正
    // =====================================================
    // 管理員的名稱修正：transaction 裡讀最新的 shared/characters，套用修改後寫回 (不會蓋掉其他管理員剛存的修改)
    async function saveNameFix(op, keepOpen) {
        if (!isAdmin) return;
        try {
            nameFixes = readNameFixes(await S.saveNameFix(op));
            openName = keepOpen || '';
            updateSimilar();
            render();
        } catch (e) {
            console.error('[FIX] 名稱修正存檔失敗', e);
            const denied = e && e.code === 'permission-denied';
            alert(denied
                ? '沒有寫入權限。請確認 Firestore 規則允許管理員寫入 shared/characters（見 README）。'
                : `存檔失敗：${(e && e.message) || e}`);
        }
    }

    async function onUserChanged(user) {
        const token = ++loadToken;
        S.checkAdmin(user).then((admin) => {
            if (token !== loadToken) return;
            // 本機開發：網址加 ?previewAdmin 可以預覽管理員的畫面 (只是畫面，寫入權限仍由 Firestore 規則把關)
            const preview = location.hostname === 'localhost' && new URLSearchParams(location.search).has('previewAdmin');
            isAdmin = admin || preview;
            els.adminBadge.hidden = !isAdmin;
            els.editBtn.hidden = !isAdmin;
            if (!isAdmin && editMode) setEditMode(false);
            render();
        });
        if (!user) {
            S.setStatus('offline', '未登入 (讀取這台電腦的紀錄)');
            setRecords(S.readLocalRecords(), 'local');
            return;
        }
        S.setStatus('saving', '正在讀取雲端紀錄...');
        try {
            const list = await S.readCloudRecords(user.uid);
            if (token !== loadToken) return;
            S.setStatus('online', '雲端紀錄');
            setRecords(list, 'cloud');
        } catch (e) {
            if (token !== loadToken) return;
            console.error('[CLOUD] 讀取抽卡紀錄失敗', e);
            S.setStatus('offline', '雲端讀取失敗 (改讀這台電腦的紀錄)');
            setRecords(S.readLocalRecords(), 'cloud-error');
        }
    }

    async function initAuth() {
        const ok = await S.initAuth(onUserChanged);
        if (!ok) {
            S.setStatus('offline', '無法連線雲端 (讀取這台電腦的紀錄)');
            setRecords(S.readLocalRecords(), 'local');
        }
    }


    // =====================================================
    // 5. 渲染
    // =====================================================
    function renderNotice() {
        const messages = {
            local: '目前讀取的是這台電腦上的抽卡紀錄。登入 Google 帳號後，可以讀取雲端上所有帳號的紀錄。',
            'cloud-error': '雲端紀錄讀取失敗，暫時顯示這台電腦上的抽卡紀錄。請重新整理頁面再試一次。'
        };
        const text = messages[source];
        els.notice.hidden = !text;
        els.notice.textContent = text || '';
        els.notice.classList.toggle('is-error', source === 'cloud-error');
    }

    function renderAccountOptions() {
        const current = els.account.value;
        const accounts = listAccounts(records);
        els.account.replaceChildren(el('option', '', '全部帳號合計'));
        els.account.firstChild.value = '';
        accounts.forEach((a) => {
            const opt = el('option', '', a);
            opt.value = a;
            els.account.appendChild(opt);
        });
        els.account.value = accounts.includes(current) ? current : '';
    }

    // 卡池選單：固定選項後面接各限定卡池
    function renderPoolOptions() {
        const current = els.pool.value;
        els.pool.querySelectorAll('option[data-pool]').forEach((o) => o.remove());
        // 同一個卡池有好幾期的版本，選單裡只列一次
        [...new Set(pools.filter((p) => p.kind === 'limited').map((p) => p.pool))].forEach((name) => {
            const opt = el('option', '', `限定：${name}`);
            opt.value = 'pool:' + name;
            opt.dataset.pool = '1';
            els.pool.appendChild(opt);
        });
        els.pool.value = [...els.pool.options].some((o) => o.value === current) ? current : '';
    }

    const selectedTags = () => els.tagFilters.filter((c) => c.checked).map((c) => c.value);

    const kindOf = (name) => {
        const c = roster ? Roster.findCharacter(roster.data, name) : null;
        return (c && c.kind) || '';
    };

    function render() {
        if (editMode) { renderRoster(); return; }
        const account = els.account.value;
        const all = buildCatalog(records, { aliasMap, account, tags: selectedTags(), rename: fixedName });
        all.forEach((e) => {
            e.pool = poolOf(e, limitedOf, { isPeriodPool, kindOf });
        });
        const pool = els.pool.value;
        const byPool = !pool ? all
            : pool === 'none' ? all.filter((e) => !e.pool)
            : pool === 'limited' || pool === 'collab' ? all.filter((e) => e.pool && e.pool.kind === pool)
            : pool === 'period' ? all.filter((e) => e.pool && e.pool.period)
            : all.filter((e) => e.pool && e.pool.kind === 'limited' && e.pool.pools[0] === pool.slice('pool:'.length));
        const shown = sortCatalog(filterByQuery(byPool, els.search.value), els.sort.value);

        const totalCount = all.reduce((s, e) => s + e.total, 0);
        els.summary.textContent = `${account || '全部帳號'}：${all.length} 種角色，共 ${totalCount} 隻`
            + (shown.length !== all.length ? `（符合條件 ${shown.length} 種）` : '');

        els.list.replaceChildren(...shown.map(renderEntry));

        let emptyText = '';
        if (shown.length === 0) {
            if (source === 'pending' && records.length === 0) emptyText = '讀取中...';
            else if (records.length === 0) emptyText = source === 'cloud' ? '雲端上還沒有抽卡紀錄。' : '這台電腦上還沒有抽卡紀錄。';
            else if (all.length === 0) emptyText = '這個條件下沒有抽到角色。';
            else emptyText = '找不到符合的角色。';
        }
        els.empty.hidden = !emptyText;
        els.empty.textContent = emptyText;
    }

    function renderEntry(entry) {
        const details = el('details', 'catalog-item');
        const summary = el('summary', 'catalog-summary');

        const main = el('div', 'catalog-main');
        main.appendChild(el('span', `catalog-name ${elementClass(entry.name)}`, entry.name));
        if (entry.pool) {
            const limited = entry.pool.kind === 'limited';
            const label = limited ? (entry.pool.period ? '期間限定' : '限定') : '合作';
            const where = entry.pool.pools.length ? `：${entry.pool.pools.join('、')}` : (limited ? '（卡池未知）' : '');
            const badge = el('span', `pool-badge pool-${entry.pool.kind}`, label + where);
            badge.title = !entry.pool.pools.length ? '管理員在角色名冊指定的類別，還沒有卡池資料'
                : limited ? (entry.pool.period ? '特定活動或節日才開的限定轉蛋' : '台版官網限定角色名單上的卡池') : '抽到這隻角色的合作活動';
            main.appendChild(badge);
        }
        const similar = similarMap.get(entry.name);
        if (similar && similar.length > 0) {
            const badge = el('span', 'similar-badge', `疑似相同：${similar.join('、')}`);
            badge.title = isAdmin
                ? '名稱只差一個字。展開後可以確認是打錯字（合併）還是不同角色。'
                : '名稱只差一個字，可能是打錯字。';
            main.appendChild(badge);
        }
        if (entry.oldNames.length > 0) {
            const badge = el('span', 'fixed-badge', `已修正：${entry.oldNames.join('、')}`);
            badge.title = '抽卡紀錄裡寫成這些名稱，管理員已修正成目前的名稱。紀錄的主人下次打開抽卡統計時，紀錄會改成新名稱。';
            main.appendChild(badge);
        }
        summary.appendChild(main);

        const meta = el('div', 'catalog-meta');
        meta.appendChild(el('span', 'catalog-count', `×${entry.total}`));
        meta.appendChild(el('span', 'catalog-date', entry.lastDate || '—'));
        summary.appendChild(meta);
        details.appendChild(summary);

        // 展開時才建立明細
        details.addEventListener('toggle', () => {
            if (!details.open || details.dataset.built) return;
            details.dataset.built = '1';
            details.appendChild(renderDetail(entry));
        });
        if (openName && entry.name === openName) details.open = true;
        return details;
    }

    function smallButton(text, className, onClick) {
        const btn = el('button', `btn btn-sm ${className}`, text);
        btn.type = 'button';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            onClick();
        });
        return btn;
    }

    const confirmRenameText = (from, to) => `把「${from}」改成「${to}」？\n\n`
        + `所有人的抽卡紀錄裡的「${from}」，都會在他們下次打開抽卡統計時改成「${to}」（果實分配的匯入對應會跟著改）。\n`
        + '之後可以取消修正，但已經改好的紀錄不會改回來。';

    // 管理員：修正名稱、取消修正、確認疑似相同
    function renderAdminPanel(entry) {
        const panel = el('div', 'admin-panel');
        panel.appendChild(el('div', 'admin-panel-title', '管理員：名稱修正（所有人的抽卡紀錄都會在下次打開抽卡統計時改成新名稱）'));

        // 修正這個名稱
        const form = el('form', 'fix-form');
        const input = el('input', 'form-control form-control-sm');
        input.type = 'text';
        input.value = entry.name;
        input.setAttribute('aria-label', `「${entry.name}」的正確名稱`);
        form.appendChild(input);
        const submit = el('button', 'btn btn-sm btn-accent', '改成這個名稱');
        submit.type = 'submit';
        form.appendChild(submit);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const to = input.value.trim();
            if (!to || to === entry.name) return;
            if (!confirm(confirmRenameText(entry.name, to))) return;
            saveNameFix({ type: 'rename', from: entry.name, to }, to);
        });
        panel.appendChild(form);

        // 已修正成這個名稱的原名稱
        entry.oldNames.forEach((old) => {
            const row = el('div', 'fix-row');
            row.appendChild(el('span', '', `紀錄裡的「${old}」已修正成「${fixedName(old)}」`));
            row.appendChild(smallButton('取消修正', 'btn-outline-secondary', () => {
                if (confirm(`取消「${old}」的修正？\n已經改成新名稱的抽卡紀錄不會改回來，只是之後不會再把「${old}」改掉。`)) saveNameFix({ type: 'unrename', from: old }, entry.name);
            }));
            panel.appendChild(row);
        });

        // 疑似相同：確認是打錯 (合併) 還是不同角色
        (similarMap.get(entry.name) || []).forEach((other) => {
            const row = el('div', 'fix-row');
            row.appendChild(el('span', '', `和「${other}」疑似相同：`));
            row.appendChild(smallButton(`「${other}」打錯了，改成「${entry.name}」`, 'btn-outline-primary', () => {
                if (confirm(confirmRenameText(other, entry.name))) saveNameFix({ type: 'rename', from: other, to: entry.name }, entry.name);
            }));
            row.appendChild(smallButton(`「${entry.name}」打錯了，改成「${other}」`, 'btn-outline-primary', () => {
                if (confirm(confirmRenameText(entry.name, other))) saveNameFix({ type: 'rename', from: entry.name, to: other }, other);
            }));
            row.appendChild(smallButton('是不同角色', 'btn-outline-secondary', () => {
                saveNameFix({ type: 'distinct', a: entry.name, b: other }, entry.name);
            }));
            panel.appendChild(row);
        });

        // 已標成不同角色的名稱 (可以取消)
        const distinctOthers = [];
        nameFixes.distinct.forEach((key) => {
            const [a, b] = key.split('\u0000');
            if (a === entry.name) distinctOthers.push(b);
            else if (b === entry.name) distinctOthers.push(a);
        });
        distinctOthers.forEach((other) => {
            const row = el('div', 'fix-row');
            row.appendChild(el('span', '', `已確認和「${other}」是不同角色`));
            row.appendChild(smallButton('取消', 'btn-outline-secondary', () => {
                saveNameFix({ type: 'undistinct', a: entry.name, b: other }, entry.name);
            }));
            panel.appendChild(row);
        });
        return panel;
    }

    // 行事曆會切到那個活動的月份並打開它；活動清單裡沒有時切到紀錄的日期
    function calendarLink(e) {
        const params = new URLSearchParams({ event: e.event });
        if (e.date) params.set('date', e.date);
        return './?' + params.toString();
    }

    function renderDetail(entry) {
        const wrap = el('div', 'catalog-detail');
        if (isAdmin) wrap.appendChild(renderAdminPanel(entry));
        entry.accounts.forEach((acc) => {
            const block = el('div', 'account-block');
            const head = el('div', 'account-head');
            head.appendChild(el('span', 'account-name', acc.account));
            head.appendChild(el('span', 'account-count', `×${acc.count}`));
            block.appendChild(head);

            const ul = el('ul', 'event-list');
            acc.entries.forEach((e) => {
                const li = el('li', 'event-row');
                li.dataset.tag = e.tag;
                li.appendChild(el('span', 'event-date', e.date || '—'));
                if (e.event) {
                    const link = el('a', 'event-name', e.event);
                    link.href = calendarLink(e);
                    link.title = '在行事曆查看這個活動';
                    li.appendChild(link);
                } else {
                    li.appendChild(el('span', 'event-name', '(未填活動)'));
                }
                if (e.rawName && e.rawName !== entry.name) li.appendChild(el('span', 'event-rawname', `紀錄寫「${e.rawName}」`));
                if (TAG_LABELS[e.tag]) li.appendChild(el('span', `event-tag tag-${e.tag}`, TAG_LABELS[e.tag]));
                li.appendChild(el('span', 'event-count', `×${e.count}`));
                ul.appendChild(li);
            });
            block.appendChild(ul);
            wrap.appendChild(block);
        });
        return wrap;
    }

    // =====================================================
    // 5-1. 編輯模式 (管理員)：整份角色名冊，有狀況的排前面
    // =====================================================
    function setEditMode(on) {
        editMode = on;
        document.body.classList.toggle('edit-mode', on);
        els.editBtn.setAttribute('aria-pressed', String(on));
        els.editBtn.textContent = on ? '離開編輯模式' : '編輯模式';
        els.editBtn.classList.toggle('btn-primary', on);
        els.editBtn.classList.toggle('btn-outline-primary', !on);
        openName = '';
        render();
    }

    function setRoster(next) {
        roster = next;
        rosterSimilar = null;
        els.rosterNames.replaceChildren(...next.data.characters.map((c) => {
            const o = el('option');
            o.value = c.name;
            return o;
        }));
    }

    // 存一個修改；成功後卡池的名稱和屬性顏色也跟著更新
    async function saveRosterOp(op, keepOpen, errorBox) {
        try {
            setRoster(await S.saveRosterOp(op));
            openName = keepOpen || '';
            pools = await S.loadPools();
            limitedOf = buildLimitedLookup(pools);
            elementClass = await S.loadElementClasses();
            render();
        } catch (e) {
            console.error('[ROSTER] 名冊存檔失敗', e);
            const denied = e && e.code === 'permission-denied';
            const text = denied ? '沒有寫入權限（需要用管理員帳號登入）。' : `存不了：${(e && e.message) || e}`;
            if (errorBox) errorBox.textContent = text;
            else alert(text);
        }
    }

    function renderRoster() {
        if (!roster) {
            els.summary.textContent = '';
            els.list.replaceChildren();
            els.empty.hidden = false;
            els.empty.textContent = '讀不到角色名冊，請重新整理頁面再試一次。';
            return;
        }
        const data = roster.data;
        if (!rosterSimilar) rosterSimilar = findSimilarNames(data.characters.map((c) => c.name));
        const inPoolKeys = new Set(pools.flatMap((p) => p.chars).map(poolKey));
        const rows = Roster.rosterIssues(data, {
            inPool: (n) => inPoolKeys.has(poolKey(n)),
            similarOf: rosterSimilar,
            recordNames: buildCatalog(records, { rename: fixedName }).map((e) => e.name)
        });
        const filter = els.issueFilter.value;
        const isIssue = (r) => r.issues.some((i) => i.type !== 'pending');
        const byFilter = !filter ? rows
            : filter === 'issues' ? rows.filter(isIssue)
            : filter === 'nodex' ? rows.filter((r) => !r.character.missing && !Roster.hasDexNumbers(r.character))
            : rows.filter((r) => r.issues.some((i) => i.type === filter));
        const q = poolKey(els.search.value);
        const shown = !q ? byFilter : byFilter.filter((r) => Roster.namesOf(r.character).some((n) => poolKey(n).includes(q)));

        els.summary.textContent = `名冊 ${data.characters.length} 隻角色，有狀況 ${rows.filter(isIssue).length} 隻`
            + (shown.length !== rows.length ? `（符合條件 ${shown.length} 隻）` : '');
        els.list.replaceChildren(...shown.map(renderRosterRow));
        els.empty.hidden = shown.length > 0;
        els.empty.textContent = shown.length > 0 ? '' : '沒有符合的角色。';
    }

    function renderRosterRow(row) {
        const c = row.character;
        const details = el('details', 'catalog-item');
        const summary = el('summary', 'catalog-summary');
        const main = el('div', 'catalog-main');
        main.appendChild(el('span', `catalog-name ${elementClass(c.name)}`, c.name));
        if (c.id) main.appendChild(el('span', 'roster-id', c.id));
        const limited = limitedOf(c.name);
        if (limited) main.appendChild(el('span', 'pool-badge pool-limited', `${isPeriodPool(limited) ? '期間限定' : '限定'}：${limited}`));
        else if (c.kind) main.appendChild(el('span', `pool-badge pool-${c.kind === 'collab' ? 'collab' : 'limited'}`, Roster.KINDS[c.kind]));
        row.issues.forEach((i) => main.appendChild(el('span', `issue-badge issue-${i.type}`, i.text)));
        summary.appendChild(main);
        details.appendChild(summary);
        details.addEventListener('toggle', () => {
            if (!details.open || details.dataset.built) return;
            details.dataset.built = '1';
            details.appendChild(renderRosterForm(row));
        });
        if (openName && c.name === openName) details.open = true;
        return details;
    }

    function labeled(text, control, hint) {
        const wrap = el('div');
        const label = el('label', '', text);
        if (hint) label.appendChild(el('span', 'hint', ` ${hint}`));
        wrap.append(label, control);
        return wrap;
    }

    function selectOf(options, value, className = 'form-select form-select-sm') {
        const select = el('select', className);
        options.forEach(([v, text]) => {
            const o = el('option', '', text);
            o.value = v;
            select.appendChild(o);
        });
        select.value = value || '';
        return select;
    }

    function renderRosterForm(row) {
        const c = row.character;
        const form = el('form', 'roster-form');
        const error = el('div', 'roster-error');

        const name = el('input', 'form-control form-control-sm');
        name.type = 'text';
        name.value = c.name;
        const element = selectOf([['', '（沒有）'], ...['火', '水', '木', '光', '闇'].map((e) => [e, e])], c.element);
        const kind = selectOf([['', '不確定'], ...Object.entries(Roster.KINDS)], c.kind);
        const fields = el('div', 'roster-fields');
        fields.append(labeled('名稱', name), labeled('屬性', element), labeled('類別', kind, '不屬於任何卡池時才用'));
        form.appendChild(fields);

        const aliases = el('textarea', 'form-control form-control-sm');
        aliases.rows = Math.max(2, (c.aliases || []).length);
        aliases.value = (c.aliases || []).join('\n');
        form.appendChild(labeled('別名', aliases, '同一隻角色的其他寫法，一行一個'));

        // 形態：名稱、形態種類、圖鑑編號
        const formsWrap = el('div');
        const addFormRow = (f = {}) => {
            const r = el('div', 'roster-form-row');
            const fname = el('input', 'form-control form-control-sm');
            fname.type = 'text';
            fname.placeholder = '形態的名稱';
            fname.value = f.name || '';
            const ftype = selectOf([['', '（形態）'], ...Roster.FORMS.map((x) => [x, x]),
                ...(f.form && !Roster.FORMS.includes(f.form) ? [[f.form, f.form]] : [])], f.form);
            const no = el('input', 'form-control form-control-sm');
            no.type = 'number';
            no.min = '1';
            no.placeholder = '圖鑑編號';
            no.value = f.no || '';
            const remove = smallButton('移除', 'btn-outline-secondary', () => r.remove());
            r.append(fname, ftype, no, remove);
            r.read = () => ({ name: fname.value, form: ftype.value, no: no.value });
            formsWrap.appendChild(r);
        };
        (c.forms || []).forEach(addFormRow);
        const formsBox = labeled('形態', formsWrap, '進化後的名稱和遊戲裡的圖鑑編號');
        formsBox.appendChild(smallButton('＋ 加一個形態', 'btn-outline-secondary', () => addFormRow()));
        form.appendChild(formsBox);

        const read = () => ({
            name: name.value, element: element.value, kind: kind.value,
            aliases: aliases.value.split('\n'),
            poolAliases: c.poolAliases,
            forms: [...formsWrap.children].map((r) => r.read())
        });
        const actions = el('div', 'roster-actions');
        const saveText = c.missing ? '加進名冊' : row.issues.some((i) => i.type === 'new') ? '確認是新角色並儲存' : '儲存';
        const save = el('button', 'btn btn-sm btn-accent', saveText);
        save.type = 'submit';
        actions.appendChild(save);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            error.textContent = '';
            const character = read();
            const op = c.id ? { type: 'save', id: c.id, character } : { type: 'add', character, original: c.name };
            saveRosterOp(op, character.name.trim(), error);
        });
        // 只差一個字：確認是不同角色
        row.issues.filter((i) => i.type === 'similar').forEach((i) => (i.others || []).forEach((otherId) => {
            const other = roster.data.characters.find((x) => x.id === otherId);
            if (!other || !c.id) return;
            actions.appendChild(smallButton(`和「${other.name}」是不同角色`, 'btn-outline-secondary',
                () => saveRosterOp({ type: 'distinct', a: c.id, b: otherId }, c.name, error)));
        }));
        form.appendChild(actions);

        // 這隻其實是另一隻角色：併成對方的別名或形態
        const target = el('input', 'form-control form-control-sm');
        target.type = 'text';
        target.placeholder = '輸入那隻角色的名稱';
        target.setAttribute('list', 'roster-names');
        const as = selectOf([['alias', '是它的別名（另一種寫法）'], ['form', '是它進化後的形態']], 'alias');
        const mergeRow = el('div', 'roster-merge');
        mergeRow.append(target, as, smallButton('合併過去', 'btn-outline-danger', () => {
            error.textContent = '';
            const into = Roster.findCharacter(roster.data, target.value);
            if (!into || !into.id) { error.textContent = '名冊裡找不到這個名稱（還沒編號的新角色不能當合併的對象）'; return; }
            if (!confirm(`把「${c.name}」併成「${into.name}」的${as.value === 'form' ? '形態' : '別名'}？\n\n合併後「${c.name}」不再是獨立的角色，卡池裡用到它的地方都會換成「${into.name}」。合併不能直接復原。`)) return;
            saveRosterOp({ type: 'merge', from: c.id || undefined, fromName: c.name, into: into.id, as: as.value }, into.name, error);
        }));
        form.appendChild(labeled('這隻其實是另一隻角色', mergeRow, '合併後不能直接復原'));
        form.appendChild(error);
        return form;
    }

    function bindFilters() {
        els.editBtn.addEventListener('click', () => setEditMode(!editMode));
        els.issueFilter.addEventListener('change', render);
        let timer = null;
        els.search.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(render, SEARCH_DEBOUNCE_MS);
        });
        els.account.addEventListener('change', render);
        els.sort.addEventListener('change', render);
        els.pool.addEventListener('change', render);
        els.tagFilters.forEach((c) => c.addEventListener('change', render));

        // 抽卡統計在其他分頁改了本機紀錄時，自動更新
        window.addEventListener('storage', (e) => {
            if (e.key === S.GACHA_LOCAL_KEY && source === 'local') setRecords(S.readLocalRecords(), 'local');
        });
    }


    // =====================================================
    // 6. 啟動
    // =====================================================
    bindFilters();
    // 從行事曆的卡池點角色過來：?q=角色名稱
    const query = new URLSearchParams(location.search).get('q');
    if (query) els.search.value = query;
    // 登入狀態確認前，先顯示這台電腦的紀錄 (登入時這份就是抽卡統計留下的雲端副本)
    setRecords(S.readLocalRecords(), 'pending');
    S.loadToolboxMenu();
    initAuth();
    S.loadEvents().then(({ events }) => {
        aliasMap = buildAliasMap(events);
        render();
    });
    S.loadPools().then((list) => {
        pools = list;
        limitedOf = buildLimitedLookup(pools);
        renderPoolOptions();
        render();
    });
    S.loadElementClasses().then((fn) => {
        elementClass = fn;
        render();
    });
    S.loadRoster().then((r) => {
        setRoster(r);
        render();
    }).catch((e) => console.warn('[DATA] 讀不到角色名冊', e));
    S.loadNameFixes().then((fixes) => {
        nameFixes = fixes;
        updateSimilar();
        render();
    });
});
