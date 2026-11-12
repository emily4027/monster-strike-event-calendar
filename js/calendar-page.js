document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // =====================================================
    // 📅 行事曆頁
    //   1. 設定與狀態
    //   2. 讀取資料 (活動清單、抽卡紀錄、卡池、屬性、名稱修正)。唯一的寫入是管理員編輯活動 (shared/events)
    //   3. 渲染 (月曆格、手機清單)
    //   4. 活動詳細 (期間、這期卡池、我的抽卡紀錄)
    //   5. 啟動 (含從角色頁跳過來的 ?event=…&date=…)
    //
    // 日期計算、排版、抽數彙總在 calendar.js；共用的讀取、登入、工具箱在 common.js
    // =====================================================

    const C = window.CalendarCore;
    const S = window.Shared;
    const { poolKey, poolsForEvent, resolveName, readNameFixes } = window.CharacterPools;
    const { charactersInNotes } = window.Catalog;
    const { el } = S;

    // =====================================================
    // 1. 設定與狀態
    // =====================================================
    const ACCOUNT_FILTER_KEY = 'calendar_account_filter_v1';
    const TOAST_DURATION_MS = 3000;
    const TOAST_COLORS = { error: '#dc3545', info: '#0d6efd', success: '#28a745' };
    const EVENTS_SOURCE_LABELS = { cloud: '雲端活動清單', fallback: '備援活動清單 (events.json)' };

    const $ = (id) => document.getElementById(id);
    const monthTitle = $('month-title');
    const weeksContainer = $('calendar-weeks');
    const monthList = $('month-list');
    const accountFilter = $('account-filter');
    const recordsSourceLabel = $('records-source');
    const toast = $('toast-message');
    const modalTitle = $('event-modal-title');
    const modalBody = $('event-modal-body');

    const today = C.todayString();
    const monthOf = (date) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });
    let current = monthOf(today);
    let events = [];
    let rawEvents = [];         // 雲端的原始清單 (管理員編輯時先在本機檢查用)
    let eventsSource = '';
    let records = [];
    let recordsSource = '';     // '' = 沒有紀錄可顯示、'local'、'cloud'
    let currentUser = null;
    let summary = new Map();
    let pools = [];
    let nameFixes = readNameFixes(null);
    let elementClass = () => '';   // 角色名稱 → 屬性的 CSS class
    let toastTimer = null;
    let modal = null;
    let openedEvent = null;     // 活動詳細開著時，卡池或紀錄讀完要重畫
    let isAdmin = false;
    let editing = false;        // 活動詳細正在編輯模式 (管理員)

    function showToast(message, type = 'success') {
        toast.textContent = message;
        toast.style.backgroundColor = TOAST_COLORS[type] || TOAST_COLORS.success;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), TOAST_DURATION_MS);
    }


    // =====================================================
    // 2. 讀取資料
    // =====================================================
    async function loadEvents() {
        const result = await S.loadEvents();
        rawEvents = result.events;
        events = C.normalizeEvents(result.events);
        eventsSource = EVENTS_SOURCE_LABELS[result.source] || '';
    }

    async function refreshRecords() {
        if (currentUser) {
            try {
                records = await S.readCloudRecords(currentUser.uid);
                recordsSource = 'cloud';
            } catch (error) {
                console.error('[RECORDS] 讀不到雲端抽卡紀錄', error);
                showToast('讀不到雲端抽卡紀錄，只顯示活動', 'error');
                records = [];
                recordsSource = '';
            }
        } else {
            records = S.readLocalRecords();
            recordsSource = records.length ? 'local' : '';
        }
        updateAccountFilter();
        render();
    }


    // =====================================================
    // 3. 渲染
    // =====================================================
    const tagClass = (e) => `tag-${e.tag || 'none'}`;
    const hasRecords = () => recordsSource !== '' && records.length > 0;
    const totalOf = (e) => (summary.get(e.event) || { total: 0 }).total;
    const isOngoing = (e) => e.date <= today && (e.endDate || e.date) >= today;

    function updateAccountFilter() {
        const names = C.accountNames(records);
        const saved = accountFilter.value !== 'all' ? accountFilter.value : S.storage.get(ACCOUNT_FILTER_KEY);
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
            monthList.replaceChildren(el('li', 'month-list-empty', eventsSource ? '這個月沒有活動' : '讀不到活動清單'));
            return;
        }
        const items = list.map((e) => {
            const li = el('li');
            const button = el('button', `month-list-item ${tagClass(e)}`);
            button.type = 'button';
            const main = el('span', 'month-list-main');
            main.appendChild(el('span', 'month-list-name', C.displayName(e.event)));
            const meta = el('span', 'month-list-meta', C.formatPeriod(e) + (e.tag ? `・${C.TAG_LABELS[e.tag]}` : ''));
            if (isOngoing(e)) meta.appendChild(el('span', 'badge-ongoing', '進行中'));
            main.appendChild(meta);
            button.appendChild(main);
            const total = totalOf(e);
            if (total > 0) button.appendChild(el('span', 'month-list-pulls', `${total}抽`));
            button.addEventListener('click', () => openEvent(e));
            li.appendChild(button);
            return li;
        });
        monthList.replaceChildren(...items);
    }

    function render() {
        monthTitle.textContent = `${current.year} 年 ${current.month} 月 ▾`;
        updateSummary();
        renderGrid();
        renderList();
        if (openedEvent) renderEventBody(openedEvent);
    }

    // 月份選擇器：點上方的「2026 年 11 月」打開，選年份和月份直接跳過去 (不用一個月一個月按)
    //   有活動的月份下面有小圓點
    const monthPicker = $('month-picker');
    let pickerYear = current.year;
    function closeMonthPicker() {
        monthPicker.hidden = true;
        monthTitle.setAttribute('aria-expanded', 'false');
    }
    function renderMonthPicker() {
        const head = el('div', 'month-picker-head');
        const yearButton = (text, delta, label) => {
            const b = el('button', 'btn btn-sm btn-outline-secondary', text);
            b.type = 'button';
            b.setAttribute('aria-label', label);
            b.addEventListener('click', () => { pickerYear += delta; renderMonthPicker(); });
            return b;
        };
        head.append(yearButton('‹', -1, '上一年'), el('span', 'month-picker-year', `${pickerYear} 年`), yearButton('›', 1, '下一年'));
        const grid = el('div', 'month-picker-grid');
        const thisMonth = monthOf(today);
        for (let m = 1; m <= 12; m++) {
            const key = C.monthKey({ year: pickerYear, month: m });
            const b = el('button', 'month-picker-month', `${m} 月`);
            b.type = 'button';
            if (pickerYear === current.year && m === current.month) b.classList.add('selected');
            if (pickerYear === thisMonth.year && m === thisMonth.month) b.classList.add('this-month');
            if (events.some((e) => e.date.slice(0, 7) <= key && (e.endDate || e.date).slice(0, 7) >= key)) b.classList.add('has-events');
            b.addEventListener('click', () => {
                closeMonthPicker();
                goToMonth({ year: pickerYear, month: m });
            });
            grid.appendChild(b);
        }
        const foot = el('div', 'month-picker-foot');
        const todayButton = el('button', 'btn btn-sm btn-link', '回到今天');
        todayButton.type = 'button';
        todayButton.addEventListener('click', () => { closeMonthPicker(); goToMonth(thisMonth); });
        foot.appendChild(todayButton);
        monthPicker.replaceChildren(head, grid, foot);
    }
    function toggleMonthPicker() {
        if (!monthPicker.hidden) return closeMonthPicker();
        pickerYear = current.year;
        renderMonthPicker();
        monthPicker.hidden = false;
        monthTitle.setAttribute('aria-expanded', 'true');
    }

    function goToMonth(month) {
        current = month;
        render();
    }


    // =====================================================
    // 4. 活動詳細
    // =====================================================
    const characterLink = (name) => `characters.html?q=${encodeURIComponent(name)}`;

    // 這期卡池：pools.json 裡符合活動名稱與年月的卡池；抽到的角色加上 ✓ 和數量
    function renderPoolSection(e, entry) {
        const section = el('div', 'event-pools');
        section.appendChild(el('h6', 'fw-bold mt-3', '這期卡池'));
        const found = poolsForEvent(pools, e.event);
        if (found.length === 0) {
            section.appendChild(el('p', 'text-muted small mb-0', pools.length
                ? '沒有這期的卡池資料（常駐或免費轉蛋、官網沒有這期的公告，或還沒整理）。'
                : '卡池資料讀取中...'));
            return section;
        }
        const notes = entry ? entry.accounts.flatMap((a) => a.notes) : [];
        const got = new Map();
        charactersInNotes(notes, (n) => resolveName(nameFixes, n)).forEach((count, name) => {
            const key = poolKey(name);
            got.set(key, (got.get(key) || 0) + count);
        });

        found.forEach((p) => {
            const block = el('div', 'pool-block');
            const head = el('div', 'pool-head');
            head.appendChild(el('span', `pool-badge pool-${p.kind}`, p.kind !== 'collab' ? '本家限定' : (p.rerun ? '合作限定・複刻' : '合作限定')));
            // 複刻的卡池顯示它自己的標題 (「第1彈」，或那個轉蛋的名稱)，不是「主卡池・複刻 N」
            head.appendChild(el('span', 'pool-name', p.label || p.pool));
            block.appendChild(head);
            const chips = el('div', 'pool-chars');
            p.chars.forEach((name) => {
                const count = got.get(poolKey(name)) || 0;
                const chip = el('a', `pool-char ${elementClass(name)}` + (count ? ' got' : ''), count ? `✓ ${name} ×${count}` : name);
                chip.href = characterLink(name);
                chip.title = count ? `抽到 ${count} 隻，看角色頁的紀錄` : '看角色頁的紀錄';
                chips.appendChild(chip);
            });
            block.appendChild(chips);
            section.appendChild(block);
        });
        if (hasRecords()) {
            section.appendChild(el('p', 'text-muted small mt-1 mb-0',
                `✓ = ${accountFilter.value === 'all' ? '所有帳號' : accountFilter.value}在這個活動抽到的角色。`));
        }
        return section;
    }

    function renderPullsSection(entry) {
        const section = el('div', 'event-pulls');
        section.appendChild(el('h6', 'fw-bold mt-3', '我的抽卡紀錄'));
        if (!hasRecords()) {
            section.appendChild(el('p', 'text-muted small mb-0', currentUser
                ? '雲端沒有抽卡紀錄。'
                : '登入 Google 帳號，或在這台電腦上使用抽卡統計，就會顯示抽數。'));
            return section;
        }
        if (!entry || entry.accounts.length === 0) {
            section.appendChild(el('p', 'text-muted small mb-0', '這個活動沒有紀錄。'));
            return section;
        }
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
        return section;
    }

    function renderEventBody(e) {
        const info = el('dl', 'event-info');
        const addRow = (label, value) => {
            info.appendChild(el('dt', '', label));
            const dd = el('dd');
            if (value instanceof Node) dd.appendChild(value); else dd.textContent = value;
            info.appendChild(dd);
        };
        addRow('活動名稱', e.event);
        addRow('期間', C.formatPeriod(e) + (e.endDate ? '' : '（只有開始日）'));
        addRow('類型', el('span', `tag-chip ${tagClass(e)}`, e.tag ? C.TAG_LABELS[e.tag] : '未分類'));
        if (e.source) {
            const link = el('a', '', '官網公告');
            link.href = e.source;
            link.target = '_blank';
            link.rel = 'noopener';
            addRow('來源', link);
        }
        const entry = summary.get(e.event);
        if (editing) return;   // 編輯中不重畫，免得把輸入到一半的內容洗掉
        const parts = [info];
        if (isAdmin) {
            const bar = el('div', 'admin-bar');
            const btn = el('button', 'btn btn-sm btn-outline-secondary', '✏️ 編輯活動');
            btn.type = 'button';
            btn.addEventListener('click', () => renderEditForm(e));
            bar.appendChild(btn);
            if (e.source && S.poolsForEventCount(pools, e.event) === 0) {
                bar.appendChild(el('span', 'admin-hint', '已經有公告網址。爬蟲下次執行時會讀這篇公告整理卡池，開 PR 給你確認。'));
            }
            parts.push(bar);
        }
        modalBody.replaceChildren(...parts, renderPoolSection(e, entry), renderPullsSection(entry));
    }

    // 管理員：編輯這場活動 (名稱、期間、標籤、公告網址)。只寫入雲端的活動清單 shared/events
    function renderEditForm(e) {
        editing = true;
        const form = el('form', 'event-edit-form');
        const field = (label, input, hint) => {
            const wrap = el('label', 'edit-field');
            wrap.appendChild(el('span', 'edit-label', label));
            wrap.appendChild(input);
            if (hint) wrap.appendChild(el('span', 'edit-hint', hint));
            form.appendChild(wrap);
            return input;
        };
        const input = (type, value) => {
            const node = el('input', 'form-control form-control-sm');
            node.type = type;
            node.value = value || '';
            return node;
        };
        const name = field('活動名稱', input('text', e.event), '開頭的「YYYY-MM月」和卡池的關鍵字（例如「超獸神祭」）要保留，卡池才對得到。改名後舊名稱會自動記下來，舊紀錄不會斷。');
        name.required = true;
        const date = field('開始日', input('date', e.date));
        date.required = true;
        const endDate = field('結束日（可以留空）', input('date', e.endDate));
        const tag = el('select', 'form-select form-select-sm');
        [['', '未分類'], ...C.TAGS.map((t) => [t, C.TAG_LABELS[t]])].forEach(([value, text]) => tag.appendChild(new Option(text, value)));
        tag.value = e.tag || '';
        field('標籤', tag);
        const source = field('官網公告網址（可以留空）', input('url', e.source),
            '貼上那期轉蛋的官網公告網址。存檔後，爬蟲下次執行（每天中午，或到 GitHub Actions 手動執行）會讀這篇公告，把卡池整理成 PR 給你確認，並補上空的結束日。');
        source.placeholder = 'https://www.monster-strike.com.tw/news/...';

        const error = el('p', 'edit-error');
        error.hidden = true;
        form.appendChild(error);
        const actions = el('div', 'edit-actions');
        const save = el('button', 'btn btn-sm btn-accent', '存檔');
        save.type = 'submit';
        const cancel = el('button', 'btn btn-sm btn-outline-secondary', '取消');
        cancel.type = 'button';
        actions.append(save, cancel);
        form.appendChild(actions);

        const close = (target) => {
            editing = false;
            openedEvent = target;
            modalTitle.textContent = C.displayName(target.event);
            renderEventBody(target);
        };
        cancel.addEventListener('click', () => close(e));
        form.addEventListener('submit', async (submitEvent) => {
            submitEvent.preventDefault();
            const edit = { event: name.value, date: date.value, endDate: endDate.value, tag: tag.value, source: source.value.trim() };
            error.hidden = true;
            save.disabled = true;
            try {
                C.applyEventEdit(rawEvents, e.event, edit);   // 先在本機檢查一次，錯誤可以馬上顯示
                rawEvents = await S.saveEventEdit(e.event, edit);
                events = C.normalizeEvents(rawEvents);
                const updated = events.find((x) => x.event === edit.event.replace(/[ \t]{2,}/g, ' ').trim()) || e;
                editing = false;
                goToMonth(monthOf(updated.date));
                close(updated);
                showToast('已存檔');
            } catch (err) {
                console.error('[EDIT] 活動存檔失敗', err);
                error.textContent = err && err.code === 'permission-denied'
                    ? '沒有寫入權限（只有管理員可以編輯活動）。'
                    : `存檔失敗：${(err && err.message) || err}`;
                error.hidden = false;
                save.disabled = false;
            }
        });
        modalTitle.textContent = `編輯：${C.displayName(e.event)}`;
        modalBody.replaceChildren(form);
        name.focus();
    }

    function openEvent(e) {
        openedEvent = e;
        modalTitle.textContent = C.displayName(e.event);
        renderEventBody(e);
        if (!modal) {
            const node = $('eventModal');
            modal = new window.bootstrap.Modal(node);
            node.addEventListener('hidden.bs.modal', () => { openedEvent = null; editing = false; });
        }
        modal.show();
    }

    // 從角色頁跳過來：?event=活動名稱&date=YYYY-MM-DD
    //   找得到活動 → 切到那個月並打開活動；找不到 → 只切到 date 那個月
    function openFromQuery() {
        const params = new URLSearchParams(location.search);
        const name = (params.get('event') || '').trim();
        const date = params.get('date') || '';
        if (!name && !date) return;
        const aliasMap = C.buildAliasMap(events);
        const target = name ? events.find((e) => e.event === (aliasMap.get(name) || name)) : null;
        if (target) {
            goToMonth(monthOf(target.date));
            openEvent(target);
        } else if (C.isValidDate(date)) {
            goToMonth(monthOf(date));
            if (name) showToast(`活動清單裡沒有「${name}」，已切到 ${date.slice(0, 7)}`, 'info');
        }
    }


    // =====================================================
    // 5. 啟動
    // =====================================================
    function bindEvents() {
        $('prev-month').addEventListener('click', () => goToMonth(C.addMonths(current, -1)));
        $('next-month').addEventListener('click', () => goToMonth(C.addMonths(current, 1)));
        $('today-btn').addEventListener('click', () => goToMonth(monthOf(today)));
        monthTitle.addEventListener('click', toggleMonthPicker);
        // 點選擇器外面時關掉。用 composedPath 判斷：按年份的「‹」「›」會重畫選擇器，
        // 被按的按鈕那時已經不在畫面上，用 closest 會誤判成點到外面
        const pickerWrap = monthTitle.parentElement;
        document.addEventListener('click', (event) => {
            if (!monthPicker.hidden && !event.composedPath().includes(pickerWrap)) closeMonthPicker();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !monthPicker.hidden) closeMonthPicker();
        });
        accountFilter.addEventListener('change', () => {
            S.storage.set(ACCOUNT_FILTER_KEY, accountFilter.value);
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
            if (event.key === S.GACHA_LOCAL_KEY && !currentUser) refreshRecords();
        });
    }

    async function init() {
        bindEvents();
        S.loadToolboxMenu();
        render();
        S.loadPools().then((list) => {
            pools = list;
            if (openedEvent) renderEventBody(openedEvent);
        });
        S.loadElementClasses().then((fn) => {
            elementClass = fn;
            if (openedEvent) renderEventBody(openedEvent);
        });
        S.loadNameFixes().then((fixes) => {
            nameFixes = fixes;
            if (openedEvent) renderEventBody(openedEvent);
        });
        await loadEvents();
        if (eventsSource) S.setStatus('online', `${eventsSource}・共 ${events.length} 場活動`);
        else S.setStatus('offline', '讀不到活動清單，請稍後再試');
        records = S.readLocalRecords();
        recordsSource = records.length ? 'local' : '';
        updateAccountFilter();
        render();
        openFromQuery();
        const ok = await S.initAuth((user) => {
            currentUser = user;
            refreshRecords();
            S.checkAdmin(user).then((admin) => {
                if (currentUser !== user) return;
                // 本機開發：網址加 ?previewAdmin 可以預覽管理員的畫面 (只是畫面，寫入權限仍由 Firestore 規則把關)
                const preview = location.hostname === 'localhost' && new URLSearchParams(location.search).has('previewAdmin');
                isAdmin = admin || preview;
                $('admin-badge').hidden = !isAdmin;
                if (openedEvent) renderEventBody(openedEvent);
            });
        });
        if (!ok) S.setStatus('offline', eventsSource ? `${eventsSource}（Firebase 沒有載入，無法登入）` : 'Firebase 沒有載入');
    }

    init();
});
