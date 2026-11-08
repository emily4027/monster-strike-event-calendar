document.addEventListener('DOMContentLoaded', () => {

    // =====================================================
    // 檔案結構
    //   1. 設定與常數
    //   2. DOM 快取與狀態
    //   3. 讀取資料 (活動清單、抽卡紀錄)：只讀，不寫入任何雲端文件
    //   4. 渲染 (月曆格、手機清單、活動詳細)
    //   5. 登入
    //   6. 懸浮工具箱
    //   7. 啟動
    //
    // 資料來源：
    //   - 活動清單：Firestore shared/events (所有人可讀)；讀不到時用抽卡統計的 events.json
    //   - 抽卡紀錄：登入時讀 artifacts/{appId}/users/{uid}/data/gacha_records；
    //     未登入時讀這台電腦上抽卡統計的本機紀錄 (localStorage gachaRecords)
    // 日期計算、排版、抽數彙總都在 calendar.js (有自動化測試，見 tests/)
    // =====================================================

    const C = window.CalendarCore;

    // =====================================================
    // 1. 設定與常數
    // =====================================================
    const SHARED_COLLECTION = 'shared';
    const EVENTS_DOC_ID = 'events';
    // 同網域 (emily4027.github.io)，直接讀抽卡統計 repo 的備援檔，不另外複製一份
    const FALLBACK_EVENTS_URL = '/monster-strike-gacha/events.json';
    const GACHA_LOCAL_KEY = 'gachaRecords';
    const ACCOUNT_FILTER_KEY = 'calendar_account_filter_v1';

    const TOOLBOX_TOOLS_URL = 'https://emily4027.github.io/monster-strike-toolbox/tools.js';
    const THIS_TOOL = {
        id: 'calendar',
        name: '活動行事曆',
        url: 'https://emily4027.github.io/monster-strike-event-calendar/',
        emoji: '📅'
    };

    const FIREBASE_WAIT_RETRIES = 50;   // 每次間隔 100ms
    const TOAST_DURATION_MS = 3000;
    const TOAST_COLORS = { error: '#dc3545', info: '#0d6efd', success: '#28a745' };


    // =====================================================
    // 2. DOM 快取與狀態
    // =====================================================
    const $ = (id) => document.getElementById(id);
    const monthTitle = $('month-title');
    const weeksContainer = $('calendar-weeks');
    const eventList = $('event-list');
    const accountFilter = $('account-filter');
    const recordsSourceLabel = $('records-source');
    const cloudStatusText = $('cloudStatusText');
    const statusDot = document.querySelector('.status-dot');
    const loginBtn = $('google-login-btn');
    const logoutBtn = $('logout-btn');
    const userInfo = $('user-info');
    const userName = $('user-display-name');
    const userAvatar = $('user-avatar');
    const toast = $('toast-message');
    const modalTitle = $('event-modal-title');
    const modalBody = $('event-modal-body');

    const today = C.todayString();
    let current = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
    let events = [];
    let eventsSource = '';
    let records = [];
    let recordsSource = '';     // '' = 沒有紀錄可顯示、'local'、'cloud'
    let currentUser = null;
    let summary = new Map();
    let toastTimer = null;
    let modal = null;

    // 建立元素的小工具：文字一律用 textContent，不拼 HTML 字串
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function icon(name) {
        const i = el('i', `bi bi-${name}`);
        i.setAttribute('aria-hidden', 'true');
        return i;
    }

    function showToast(message, type = 'success') {
        toast.textContent = message;
        toast.style.backgroundColor = TOAST_COLORS[type] || TOAST_COLORS.success;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), TOAST_DURATION_MS);
    }

    function setStatus(state, message) {
        cloudStatusText.textContent = message;
        statusDot.className = 'status-dot' + (state ? ` status-${state}` : '');
    }

    const storage = {
        get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* 無痕模式等情況可忽略 */ } }
    };


    // =====================================================
    // 3. 讀取資料
    // =====================================================
    async function waitForFirebase() {
        for (let i = 0; i < FIREBASE_WAIT_RETRIES; i++) {
            if (window.firebaseFns && window.db && window.firebaseAuth) return true;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return false;
    }

    async function loadEventsFromCloud() {
        if (!(await waitForFirebase())) throw new Error('Firebase SDK 沒有載入');
        const { doc, getDoc } = window.firebaseFns;
        const snap = await getDoc(doc(window.db, SHARED_COLLECTION, EVENTS_DOC_ID));
        const list = snap.exists() ? snap.data().events : null;
        if (!Array.isArray(list) || list.length === 0) throw new Error('雲端還沒有活動清單');
        return list;
    }

    async function loadEventsFromFallback() {
        const response = await fetch(FALLBACK_EVENTS_URL, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const list = await response.json();
        if (!Array.isArray(list)) throw new Error('events.json 格式不正確');
        return list;
    }

    async function loadEvents() {
        try {
            events = C.normalizeEvents(await loadEventsFromCloud());
            eventsSource = '雲端活動清單';
        } catch (cloudError) {
            console.warn('[EVENTS] 讀不到雲端活動清單，改用 events.json', cloudError);
            try {
                events = C.normalizeEvents(await loadEventsFromFallback());
                eventsSource = '備援活動清單 (events.json)';
            } catch (fallbackError) {
                console.error('[EVENTS] 讀不到備援活動清單', fallbackError);
                events = [];
                eventsSource = '';
            }
        }
    }

    function loadLocalRecords() {
        try {
            const list = JSON.parse(storage.get(GACHA_LOCAL_KEY) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (e) {
            console.warn('[RECORDS] 本機抽卡紀錄格式不正確', e);
            return [];
        }
    }

    // 只讀取抽卡紀錄，不寫入 (抽卡統計和果實分配有版本檢查規則，這裡不碰)
    async function loadCloudRecords(user) {
        const { doc, getDoc } = window.firebaseFns;
        const appId = window.envAppId || 'default-app-id';
        const snap = await getDoc(doc(window.db, 'artifacts', appId, 'users', user.uid, 'data', 'gacha_records'));
        const list = snap.exists() ? snap.data().records : [];
        return Array.isArray(list) ? list : [];
    }

    async function refreshRecords() {
        if (currentUser) {
            try {
                records = await loadCloudRecords(currentUser);
                recordsSource = 'cloud';
            } catch (error) {
                console.error('[RECORDS] 讀不到雲端抽卡紀錄', error);
                showToast('讀不到雲端抽卡紀錄，只顯示活動', 'error');
                records = [];
                recordsSource = '';
            }
        } else {
            records = loadLocalRecords();
            recordsSource = records.length ? 'local' : '';
        }
        updateAccountFilter();
        render();
    }


    // =====================================================
    // 4. 渲染
    // =====================================================
    const tagClass = (e) => `tag-${e.tag || 'none'}`;
    const hasRecords = () => recordsSource !== '' && records.length > 0;
    const totalOf = (e) => (summary.get(e.event) || { total: 0 }).total;
    const isOngoing = (e) => e.date <= today && (e.endDate || e.date) >= today;

    function updateAccountFilter() {
        const names = C.accountNames(records);
        const saved = accountFilter.value !== 'all' ? accountFilter.value : storage.get(ACCOUNT_FILTER_KEY);
        accountFilter.replaceChildren(new Option('全部帳號', 'all'));
        names.forEach((name) => accountFilter.appendChild(new Option(name, name)));
        accountFilter.value = names.includes(saved) ? saved : 'all';
        accountFilter.disabled = names.length === 0;
    }

    function updateSummary() {
        summary = hasRecords() ? C.summarizePulls(records, events, accountFilter.value) : new Map();
        const accountText = accountFilter.value === 'all' ? '全部帳號' : accountFilter.value;
        if (recordsSource === 'cloud') recordsSourceLabel.textContent = `抽數：雲端紀錄（${accountText}）`;
        else if (recordsSource === 'local') recordsSourceLabel.textContent = `抽數：這台電腦上的紀錄（${accountText}）`;
        else recordsSourceLabel.textContent = '';
    }

    function barLabel(e) {
        const total = totalOf(e);
        return C.displayName(e.event) + (total > 0 ? `・${total}抽` : '');
    }

    function renderGrid() {
        const weeks = C.monthWeeks(current);
        const fragment = document.createDocumentFragment();
        weeks.forEach((days) => {
            const bars = C.layoutWeek(events, days[0].date);
            const lanes = bars.reduce((max, b) => Math.max(max, b.lane + 1), 0);
            const week = el('div', 'calendar-week');
            week.style.gridTemplateRows = `auto repeat(${lanes}, var(--bar-height)) 1fr`;

            days.forEach((d, col) => {
                const cell = el('div', 'day-cell');
                if (!d.inMonth) cell.classList.add('other-month');
                if (d.date === today) cell.classList.add('today');
                cell.style.gridColumn = String(col + 1);
                week.appendChild(cell);

                const number = el('div', 'day-number', String(d.day));
                if (d.date === today) number.classList.add('today');
                number.style.gridColumn = String(col + 1);
                week.appendChild(number);
            });

            bars.forEach((b) => {
                const bar = el('button', `event-bar ${tagClass(b.event)}`, barLabel(b.event));
                bar.type = 'button';
                bar.title = `${b.event.event}（${C.formatPeriod(b.event)}）`;
                if (b.continuesBefore) bar.classList.add('continues-before');
                if (b.continuesAfter) bar.classList.add('continues-after');
                if (!b.event.endDate) bar.classList.add('single-day');
                bar.style.gridColumn = `${b.startCol + 1} / span ${b.span}`;
                bar.style.gridRow = String(b.lane + 2);
                bar.addEventListener('click', () => openEvent(b.event));
                week.appendChild(bar);
            });
            fragment.appendChild(week);
        });
        weeksContainer.replaceChildren(fragment);
    }

    function renderList() {
        const weeks = C.monthWeeks(current);
        const first = `${C.monthKey(current)}-01`;
        const last = weeks[weeks.length - 1].filter((d) => d.inMonth).pop().date;
        const list = C.eventsInRange(events, first, last);
        if (list.length === 0) {
            eventList.replaceChildren(el('li', 'event-list-empty', eventsSource ? '這個月沒有活動' : '讀不到活動清單'));
            return;
        }
        const items = list.map((e) => {
            const li = el('li');
            const button = el('button', `event-list-item ${tagClass(e)}`);
            button.type = 'button';
            const main = el('span', 'event-list-main');
            main.appendChild(el('span', 'event-list-name', C.displayName(e.event)));
            const meta = el('span', 'event-list-meta', C.formatPeriod(e) + (e.tag ? `・${C.TAG_LABELS[e.tag]}` : ''));
            if (isOngoing(e)) meta.appendChild(el('span', 'badge-ongoing', '進行中'));
            main.appendChild(meta);
            button.appendChild(main);
            const total = totalOf(e);
            if (total > 0) button.appendChild(el('span', 'event-list-pulls', `${total}抽`));
            button.addEventListener('click', () => openEvent(e));
            li.appendChild(button);
            return li;
        });
        eventList.replaceChildren(...items);
    }

    function render() {
        monthTitle.textContent = `${current.year} 年 ${current.month} 月`;
        updateSummary();
        renderGrid();
        renderList();
    }

    function openEvent(e) {
        modalTitle.textContent = C.displayName(e.event);
        const body = [];

        const info = el('dl', 'event-info');
        const addRow = (label, value) => {
            info.appendChild(el('dt', '', label));
            const dd = el('dd');
            if (value instanceof Node) dd.appendChild(value); else dd.textContent = value;
            info.appendChild(dd);
        };
        addRow('活動名稱', e.event);
        addRow('期間', C.formatPeriod(e) + (e.endDate ? '' : '（只有開始日）'));
        const tag = el('span', `tag-chip ${tagClass(e)}`, e.tag ? C.TAG_LABELS[e.tag] : '未分類');
        addRow('類型', tag);
        if (e.source) {
            const link = el('a', '', '官網公告');
            link.href = e.source;
            link.target = '_blank';
            link.rel = 'noopener';
            addRow('來源', link);
        }
        body.push(info);

        const section = el('div', 'event-pulls');
        section.appendChild(el('h6', 'fw-bold mt-3', '我的抽卡紀錄'));
        const entry = summary.get(e.event);
        if (!hasRecords()) {
            section.appendChild(el('p', 'text-muted small mb-0', currentUser
                ? '雲端沒有抽卡紀錄。'
                : '登入 Google 帳號，或在這台電腦上使用抽卡統計，就會顯示抽數。'));
        } else if (!entry || entry.accounts.length === 0) {
            section.appendChild(el('p', 'text-muted small mb-0', '這個活動沒有紀錄。'));
        } else {
            const table = el('table', 'table table-sm align-middle mb-0 pulls-table');
            const head = el('thead');
            const headRow = el('tr');
            ['帳號', '抽數', '抽到的角色'].forEach((t) => headRow.appendChild(el('th', '', t)));
            head.appendChild(headRow);
            table.appendChild(head);
            const tbody = el('tbody');
            entry.accounts.forEach((a) => {
                const row = el('tr');
                row.appendChild(el('td', 'text-nowrap', a.account));
                row.appendChild(el('td', 'text-nowrap', `${a.pulls}抽`));
                row.appendChild(el('td', 'notes-cell', a.notes.length ? a.notes.join('、') : '—'));
                tbody.appendChild(row);
            });
            if (entry.accounts.length > 1) {
                const totalRow = el('tr', 'total-row');
                totalRow.appendChild(el('td', '', '合計'));
                totalRow.appendChild(el('td', 'text-nowrap', `${entry.total}抽`));
                totalRow.appendChild(el('td'));
                tbody.appendChild(totalRow);
            }
            table.appendChild(tbody);
            section.appendChild(table);
        }
        body.push(section);

        modalBody.replaceChildren(...body);
        if (!modal) modal = new window.bootstrap.Modal($('eventModal'));
        modal.show();
    }

    function goToMonth(month) {
        current = month;
        render();
    }


    // =====================================================
    // 5. 登入
    // =====================================================
    function renderAuth(user) {
        if (user) {
            loginBtn.style.display = 'none';
            userInfo.style.display = 'flex';
            userName.textContent = user.displayName || '使用者';
            if (user.photoURL) userAvatar.src = user.photoURL;
        } else {
            loginBtn.style.display = '';
            userInfo.style.display = 'none';
            userName.textContent = '';
            userAvatar.removeAttribute('src');
        }
    }

    async function initAuth() {
        if (!(await waitForFirebase())) {
            setStatus('offline', eventsSource ? `${eventsSource}（Firebase 沒有載入，無法登入）` : 'Firebase 沒有載入');
            loginBtn.disabled = true;
            return;
        }
        const { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } = window.firebaseFns;
        onAuthStateChanged(window.firebaseAuth, async (user) => {
            currentUser = user;
            renderAuth(user);
            await refreshRecords();
        });
        loginBtn.addEventListener('click', async () => {
            try {
                await signInWithPopup(window.firebaseAuth, new GoogleAuthProvider());
            } catch (error) {
                console.error('Login failed:', error);
                showToast('登入失敗', 'error');
            }
        });
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(window.firebaseAuth);
                showToast('已登出', 'info');
            } catch (error) {
                console.error(error);
            }
        });
    }


    // =====================================================
    // 6. 懸浮工具箱：讀取工具箱的 tools.js (window.MS_TOOLS) 後重建連結；
    //    讀不到時維持 index.html 裡的連結。清單裡還沒有這個工具時 (還沒正式上線) 補在最後。
    // =====================================================
    function renderToolboxMenu() {
        const list = document.querySelector('.toolbox-items-list');
        const tools = Array.isArray(window.MS_TOOLS) ? window.MS_TOOLS : [];
        const valid = tools.filter((t) => t && typeof t.name === 'string' && t.name
            && typeof t.url === 'string' && /^https:\/\//.test(t.url));
        if (!list || valid.length === 0) return;
        if (!valid.some((t) => t.id === THIS_TOOL.id)) valid.push(THIS_TOOL);

        const home = list.querySelector('.toolbox-home');
        const links = valid.map((t) => {
            const active = t.id === THIS_TOOL.id;
            const a = el('a', 'toolbox-item' + (active ? ' active' : ''),
                (typeof t.emoji === 'string' ? t.emoji + ' ' : '') + t.name + (active ? ' (現行)' : ''));
            a.href = t.url;
            return a;
        });
        list.replaceChildren(...(home ? [home] : []), ...links);
    }

    function loadToolboxMenu() {
        const script = document.createElement('script');
        script.src = TOOLBOX_TOOLS_URL;
        script.async = true;
        script.onload = renderToolboxMenu;
        script.onerror = () => console.warn('[TOOLBOX] 讀不到工具箱的 tools.js，使用內建連結');
        document.head.appendChild(script);
    }


    // =====================================================
    // 7. 啟動
    // =====================================================
    function bindEvents() {
        $('prev-month').addEventListener('click', () => goToMonth(C.addMonths(current, -1)));
        $('next-month').addEventListener('click', () => goToMonth(C.addMonths(current, 1)));
        $('today-btn').addEventListener('click', () => goToMonth({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
        accountFilter.addEventListener('change', () => {
            storage.set(ACCOUNT_FILTER_KEY, accountFilter.value);
            render();
        });
        // 左右方向鍵切換月份 (詳細視窗開著時不切換)
        document.addEventListener('keydown', (event) => {
            if (document.querySelector('.modal.show')) return;
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
            if (event.key === 'ArrowLeft') goToMonth(C.addMonths(current, -1));
            if (event.key === 'ArrowRight') goToMonth(C.addMonths(current, 1));
        });
        // 另一個分頁的抽卡統計改了本機紀錄 (未登入時)
        window.addEventListener('storage', (event) => {
            if (event.key === GACHA_LOCAL_KEY && !currentUser) refreshRecords();
        });
    }

    async function init() {
        bindEvents();
        loadToolboxMenu();
        render();
        await loadEvents();
        if (eventsSource) setStatus('online', `${eventsSource}・共 ${events.length} 場活動`);
        else setStatus('offline', '讀不到活動清單，請稍後再試');
        records = loadLocalRecords();
        recordsSource = records.length ? 'local' : '';
        updateAccountFilter();
        render();
        initAuth();
    }

    init();
});
