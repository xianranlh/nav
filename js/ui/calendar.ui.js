/* 📅 日历 UI + 任务编辑器 — 自 app.js 拆分
 * 逻辑层：js/calendar.js (window.Cal) / js/holidays.js (window.CalFestivals)
 * 由 app.js 通过 window.CalendarUIFactory(UIContext) 实例化；
 * 内部仍向 window.UICalRefresh 挂全量刷新钩子（其他模块依赖）。
 */
(function () {
  "use strict";

  window.CalendarUIFactory = function (ctx) {
    const { $, $$, toast, escapeHtml, Store } = ctx;
  const UICal = (() => {
    const panel = $("#calendar-panel");
    const monthView = $("#cal-month-view");
    const listView = $("#cal-list-view");
    const gridEl = $("#cal-grid");
    const weekdaysEl = $("#cal-weekdays");
    const titleEl = $("#cal-title");
    const dayTitle = $("#cal-day-title");
    const dayList = $("#cal-day-list");
    const listEl = $("#cal-list");
    const badge = $("#cal-badge");
    const upcomingCard = $("#upcoming-card");
    const upcomingList = $("#upcoming-list");

    let viewDate = new Date();
    viewDate.setDate(1);
    let selectedDate = new Date();
    selectedDate.setHours(0, 0, 0, 0);
    let view = "month";
    let tickTimer = null;

    function init() {
      renderWeekdays();
      renderMonth();
      renderDay();
      renderCountBar();
      renderUpcoming();
      updateBadge();
      startTicker();
      CalUtils.scheduleReminders();
      upcomingCard.hidden = !Store.settings.showUpcoming;
    }

    function open() {
      panel.hidden = false;
      renderMonth();
      renderDay();
      renderCountBar();
    }
    function close() { panel.hidden = true; }

    /** 顶栏计数：近一周完成 / 累计 / 连续打卡 */
    function renderCountBar() {
      if (!window.CalUtils?.stats) return;
      const s = CalUtils.stats();
      const weekEl = $("#cal-count-week");
      const weekSub = $("#cal-count-week-sub");
      const totalEl = $("#cal-count-total");
      const totalSub = $("#cal-count-total-sub");
      const streakEl = $("#cal-count-streak");
      if (weekEl) weekEl.textContent = String(s.last7?.done ?? 0);
      if (weekSub) {
        const t = s.last7?.total ?? 0;
        const r = Math.round((s.last7?.ratio || 0) * 100);
        weekSub.textContent = t ? `计划 ${t} · 完成率 ${r}%` : "暂无已过期任务";
      }
      if (totalEl) totalEl.textContent = String(s.totalCompleted ?? 0);
      if (totalSub) totalSub.textContent = `${s.totalTasks ?? 0} 个任务`;
      if (streakEl) streakEl.textContent = String(s.streak ?? 0);
    }

    function renderWeekdays() {
      const first = Cal.data.settings.firstDayOfWeek || 1;
      const names = [];
      for (let i = 0; i < 7; i++) names.push(CalUtils.WEEK_NAMES[(first + i) % 7]);
      weekdaysEl.innerHTML = names.map((n) => `<span>${n}</span>`).join("");
    }

    function renderMonth() {
      const y = viewDate.getFullYear();
      const m = viewDate.getMonth();
      titleEl.textContent = `${y} 年 ${m + 1} 月`;
      // 异步预拉当前年和前后年的节假日（本年硬编码兜底）
      if (window.CalFestivals?.ensureYear) {
        CalFestivals.ensureYear(y);
        CalFestivals.ensureYear(y + 1);
      }
      const cells = CalUtils.monthGrid(y, m, Cal.data.settings.firstDayOfWeek || 1);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const rangeStart = cells[0].date.getTime();
      const rangeEnd = cells[41].date.getTime() + 86400000;
      const allOcc = CalUtils.listInRange(rangeStart, rangeEnd);
      const byDay = new Map();
      for (const { task, ts } of allOcc) {
        const dStart = new Date(ts); dStart.setHours(0, 0, 0, 0);
        const key = dStart.getTime();
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push({ task, ts });
      }

      gridEl.innerHTML = cells.map((c) => {
        const dayKey = c.date.getTime();
        const items = byDay.get(dayKey) || [];
        const isToday = dayKey === today.getTime();
        const isSel = dayKey === selectedDate.getTime();
        const weekday = c.date.getDay();
        const cls = ["cal-cell"];
        if (!c.inMonth) cls.push("out");
        if (isToday) cls.push("today");
        if (isSel) cls.push("selected");
        const dayCls = weekday === 0 ? "sun" : weekday === 6 ? "sat" : "";

        // 节日：取优先级最高的一个显示在 cell 里；存在法定节假日时给整 cell 加 has-holiday 类
        const festivals = window.CalFestivals ? CalFestivals.getFestivalsForDate(c.date) : [];
        const topFest = festivals[0];
        if (topFest && topFest.kind === "cn-holiday") cls.push("has-holiday");
        const festBadge = topFest
          ? `<span class="cal-cell-fest kind-${topFest.kind}" title="${escapeHtml(festivals.map((f) => f.emoji + " " + f.name).join(" · "))}">${topFest.emoji} ${escapeHtml(topFest.name.replace(" · 放假", ""))}</span>`
          : "";

        const MAX = 3;
        const isItemDone = (it) =>
          CalUtils.isDoneOccurrence?.(it.task, it.ts) ||
          (it.task.repeat?.type === "none" ? it.task.done : (it.task.doneDates || []).includes(it.ts));
        const doneCount = items.reduce((n, it) => n + (isItemDone(it) ? 1 : 0), 0);
        const shown = items.slice(0, MAX).map((it) => {
          const done = isItemDone(it);
          return `<div class="day-task ${done ? "done" : ""}" style="--task-color:${escapeHtml(it.task.color || "#ff8fab")}" title="${escapeHtml(it.task.title)}">${escapeHtml(it.task.title)}</div>`;
        }).join("");
        const more = items.length > MAX ? `<div class="more">+${items.length - MAX} 更多</div>` : "";
        const countBadge = items.length
          ? `<span class="cal-cell-count${doneCount === items.length ? " all-done" : ""}" title="完成 ${doneCount} / 共 ${items.length}">${doneCount}/${items.length}</span>`
          : "";
        let wBadge = "";
        if (Store.settings.weatherOnCal && window.WeatherUtils) {
          const ds = `${c.date.getFullYear()}-${String(c.date.getMonth() + 1).padStart(2, "0")}-${String(c.date.getDate()).padStart(2, "0")}`;
          const f = WeatherUtils.forecastForDate(ds);
          if (f) {
            const [emoji] = WeatherUtils.wmo(f.code);
            wBadge = `<span class="cal-cell-weather" title="${escapeHtml(WeatherUtils.wmo(f.code)[1])} ${Math.round(f.min)}~${Math.round(f.max)}°">${emoji}</span>`;
          }
        }
        return `<div class="${cls.join(" ")}" data-ts="${dayKey}" style="position:relative">
          <div class="cal-cell-top">
            <span class="day-num ${dayCls}">${c.date.getDate()}</span>
            ${countBadge}
            ${wBadge}
          </div>
          ${festBadge}
          <div class="day-tasks">${shown}${more}</div>
        </div>`;
      }).join("");
    }

    function renderDay() {
      const d = new Date(selectedDate);
      const isToday = d.toDateString() === new Date().toDateString();
      dayTitle.textContent = isToday ? `今天 · ${d.getMonth() + 1}/${d.getDate()}` : d.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
      const from = d.getTime();
      const to = from + 86400000 - 1;
      const items = CalUtils.listInRange(from, to);

      // 当天节日横条（在任务列表上方）
      let festBanner = "";
      const fests = window.CalFestivals ? CalFestivals.getFestivalsForDate(d) : [];
      if (fests.length) {
        festBanner = `<div class="cal-day-fests">` + fests.map((f) =>
          `<span class="cal-day-fest kind-${f.kind}" title="${escapeHtml(f.name)}">${f.emoji} ${escapeHtml(f.name)}</span>`
        ).join("") + `</div>`;
      }

      dayList.innerHTML = festBanner + items.map((it) => renderDayItem(it.task, it.ts)).join("");
    }

    function renderDayItem(task, ts) {
      const done = task.repeat?.type === "none" ? !!task.done : (task.doneDates || []).includes(ts);
      const diff = ts - Date.now();
      const cdCls = diff < 0 ? "overdue" : "";
      const repeatLabel = task.repeat && task.repeat.type !== "none" ? `<span class="task-repeat">🔁 ${escapeHtml(CalUtils.repeatLabel(task.repeat))}</span>` : "";
      // 天气提示
      let wTip = "";
      if (window.WeatherUtils && Store.settings.weatherOnCal !== false) {
        const d = new Date(ts);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const f = WeatherUtils.forecastForDate(ds);
        if (f) {
          const [emoji, desc] = WeatherUtils.wmo(f.code);
          const rain = (f.code >= 50 && f.code <= 99) || f.rainProb >= 60;
          const hot = f.max >= 32;
          const cold = f.min <= 0;
          let extra = "";
          let cls = "";
          if (rain) { extra = "记得带伞"; cls = "warn"; }
          else if (hot) { extra = "注意防晒"; cls = "hot"; }
          else if (cold) { extra = "注意保暖"; cls = "warn"; }
          wTip = `<span class="task-weather-tip ${cls}" title="${escapeHtml(desc)} ${Math.round(f.min)}~${Math.round(f.max)}°">${emoji} ${Math.round(f.max)}°${extra ? " · " + extra : ""}</span>`;
        }
      }
      return `<li class="cal-day-item ${done ? "done" : ""}" data-id="${task.id}" data-ts="${ts}" style="--task-color:${escapeHtml(task.color || "#ff8fab")}">
        <div class="task-title">${escapeHtml(task.title)}${wTip}</div>
        <div class="task-meta">
          <span>${escapeHtml(CalUtils.fmtDateTime(ts, task.allDay))}</span>
          ${repeatLabel}
          <span class="countdown ${cdCls}" data-cd="${ts}">${escapeHtml(CalUtils.fmtCountdown(diff))}</span>
        </div>
        ${task.desc ? `<div style="font-size:12px;color:var(--text-soft)">${escapeHtml(task.desc)}</div>` : ""}
        <div class="task-actions">
          <button data-act="${done ? "undo" : "done"}">${done ? "↶ 还原" : "✓ 完成"}</button>
          <button data-act="skip">⊘ 跳过本次</button>
          <button data-act="edit">✎ 编辑</button>
          <button data-act="del">🗑 删除</button>
        </div>
      </li>`;
    }

    function renderListView() {
      // 未来 3 个月按天分组
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const to = new Date(now); to.setMonth(to.getMonth() + 3);
      const items = CalUtils.listInRange(now.getTime(), to.getTime());
      if (!items.length) {
        listEl.innerHTML = `<div class="hint" style="text-align:center;padding:60px">没有即将到来的任务 🌸</div>`;
        return;
      }
      const groups = new Map();
      for (const it of items) {
        const d = new Date(it.ts); d.setHours(0, 0, 0, 0);
        const k = d.getTime();
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }
      listEl.innerHTML = [...groups].map(([k, arr]) => {
        const d = new Date(k);
        const today = d.toDateString() === new Date().toDateString();
        const label = today ? "今天" : d.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
        return `<div class="cal-list-group"><h4>${label}</h4><ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px">
          ${arr.map((it) => renderDayItem(it.task, it.ts)).join("")}
        </ul></div>`;
      }).join("");
    }

    function renderUpcoming() {
      if (!Store.settings.showUpcoming) { upcomingCard.hidden = true; return; }
      const items = CalUtils.upcoming(5);
      if (!items.length) {
        upcomingList.innerHTML = `<div class="upcoming-empty">暂无安排，享受轻松的时光 🌸</div>`;
      } else {
        upcomingList.innerHTML = items.map(({ task, ts }) => {
          const diff = ts - Date.now();
          const cls = diff < 0 ? "overdue" : diff < 3600000 ? "soon" : "";
          return `<li class="upcoming-item ${cls}" data-id="${task.id}" data-ts="${ts}" style="border-left-color:${escapeHtml(task.color || "#ff8fab")}">
            <span class="u-title">${escapeHtml(task.title)}</span>
            <span class="u-count" data-cd="${ts}">${escapeHtml(CalUtils.fmtCountdown(diff))}</span>
          </li>`;
        }).join("");
      }
      upcomingCard.hidden = false;
    }

    function updateBadge() {
      const today = CalUtils.today();
      const undone = today.filter(({ task, ts }) => !(task.repeat?.type === "none" ? task.done : (task.doneDates || []).includes(ts)));
      if (undone.length) {
        badge.textContent = undone.length > 9 ? "9+" : String(undone.length);
        badge.hidden = false;
      } else badge.hidden = true;
    }

    // 实时倒计时 tick
    let lastMidnight = new Date().toDateString();
    function startTicker() {
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(() => {
        const nodes = document.querySelectorAll("[data-cd]");
        const now = Date.now();
        let rerender = false;
        nodes.forEach((el) => {
          const ts = +el.dataset.cd;
          const diff = ts - now;
          el.textContent = CalUtils.fmtCountdown(diff);
          if (el.classList.contains("countdown")) {
            el.classList.toggle("overdue", diff < 0);
          }
          if (el.classList.contains("u-count")) {
            const item = el.closest(".upcoming-item");
            if (item) {
              item.classList.toggle("overdue", diff < 0);
              item.classList.toggle("soon", diff >= 0 && diff < 3600000);
            }
          }
          // 到时触发重新渲染（下次发生时间变了）
          if (diff < -60000 && diff > -120000) rerender = true;
        });
        // 日期切换，徽章、月视图、今日列表要刷新
        const today = new Date().toDateString();
        if (today !== lastMidnight) {
          lastMidnight = today;
          rerender = true;
        }
        if (rerender) refreshAll();
      }, 1000);
    }

    function refreshAll() {
      if (!panel.hidden) {
        if (view === "month") renderMonth();
        else if (view === "list") renderListView();
        else if (view === "stats") renderStatsView();
        renderDay();
        renderCountBar();
      } else {
        renderCountBar();
      }
      renderUpcoming();
      updateBadge();
      CalUtils.scheduleReminders();
    }

    // ------- 事件绑定 -------
    gridEl.addEventListener("click", (e) => {
      const cell = e.target.closest(".cal-cell");
      if (!cell) return;
      selectedDate = new Date(+cell.dataset.ts);
      selectedDate.setHours(0, 0, 0, 0);
      renderMonth();
      renderDay();
    });
    gridEl.addEventListener("dblclick", (e) => {
      const cell = e.target.closest(".cal-cell");
      if (!cell) return;
      selectedDate = new Date(+cell.dataset.ts);
      openTaskDialog(null, selectedDate);
    });

    function handleTaskClick(e) {
      const btn = e.target.closest("[data-act]");
      const item = e.target.closest("[data-id][data-ts]");
      if (!item) return;
      const task = Cal.get(item.dataset.id);
      const ts = +item.dataset.ts;
      if (!task) return;
      if (!btn) { openTaskDialog(task); return; }
      const act = btn.dataset.act;
      if (act === "done") { CalUtils.markDone(task, ts); toast("已完成 ✓"); refreshAll(); }
      else if (act === "undo") { CalUtils.undoDone(task, ts); refreshAll(); }
      else if (act === "skip") { CalUtils.skipOnce(task, ts); toast("已跳过本次"); refreshAll(); }
      else if (act === "edit") openTaskDialog(task);
      else if (act === "del") {
        if (confirm(`删除"${task.title}"？`)) { Cal.remove(task.id); refreshAll(); }
      }
      e.stopPropagation();
    }
    dayList.addEventListener("click", handleTaskClick);
    listEl.addEventListener("click", handleTaskClick);
    upcomingList.addEventListener("click", handleTaskClick);

    $("#cal-prev").addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() - 1); renderMonth(); });
    $("#cal-next").addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() + 1); renderMonth(); });
    $("#cal-today").addEventListener("click", () => {
      viewDate = new Date(); viewDate.setDate(1);
      selectedDate = new Date(); selectedDate.setHours(0, 0, 0, 0);
      renderMonth(); renderDay();
    });
    $("#cal-close").addEventListener("click", close);
    $("#cal-new-task").addEventListener("click", () => openTaskDialog(null, selectedDate));
    $("#cal-day-add").addEventListener("click", () => openTaskDialog(null, selectedDate));
    $("#upcoming-expand").addEventListener("click", open);

    // 节假日 API 拉到了 → 自动重渲染月视图，让新数据立刻生效
    window.addEventListener("cal-holidays-updated", () => {
      if (!panel.hidden && monthView && !monthView.hidden) renderMonth();
    });

    const statsView = $("#cal-stats-view");
    $$(".cal-view-switch .chip").forEach((b) => {
      b.addEventListener("click", () => {
        view = b.dataset.view;
        $$(".cal-view-switch .chip").forEach((x) => x.classList.toggle("active", x === b));
        monthView.hidden = view !== "month";
        listView.hidden = view !== "list";
        statsView.hidden = view !== "stats";
        $("#cal-day-panel").hidden = view !== "month";
        if (view === "list") renderListView();
        else if (view === "stats") renderStatsView();
        else renderMonth();
      });
    });

    function renderStatsView() {
      const s = CalUtils.stats();
      const last7Done = $("#stat-last7-done");
      const last7Detail = $("#stat-last7-detail");
      if (last7Done) last7Done.textContent = String(s.last7?.done ?? 0);
      if (last7Detail) {
        const t = s.last7?.total ?? 0;
        const r = Math.round((s.last7?.ratio || 0) * 100);
        last7Detail.textContent = t ? `计划 ${t} · 完成率 ${r}%` : "暂无已过期任务";
      }
      const setText = (sel, val) => { const el = $(sel); if (el) el.textContent = val; };
      setText("#stat-week-ratio", Math.round(s.week.ratio * 100) + "%");
      setText("#stat-week-detail", `${s.week.done} / ${s.week.total}`);
      setText("#stat-month-ratio", Math.round(s.month.ratio * 100) + "%");
      setText("#stat-month-detail", `${s.month.done} / ${s.month.total}`);
      setText("#stat-streak", String(s.streak));
      setText("#stat-total-tasks", String(s.totalTasks));
      setText("#stat-total-done", String(s.totalCompleted));
      renderCountBar();
      // 柱状图
      const svg = $("#stats-chart");
      if (!svg) return;
      const W = 600, H = 160, PAD = 18;
      const innerW = W - PAD * 2, innerH = H - PAD * 2;
      const n = s.days.length;
      const bw = innerW / n * 0.75;
      const gap = innerW / n * 0.25;
      const maxTotal = Math.max(1, ...s.days.map((d) => d.total));
      let g = "";
      s.days.forEach((d, i) => {
        const x = PAD + i * (bw + gap);
        const hTotal = (d.total / maxTotal) * innerH;
        const hDone = (d.done / maxTotal) * innerH;
        const yT = H - PAD - hTotal;
        const yD = H - PAD - hDone;
        g += `<rect class="bar-total" x="${x.toFixed(1)}" y="${yT.toFixed(1)}" width="${bw.toFixed(1)}" height="${hTotal.toFixed(1)}" rx="1.5" />`;
        g += `<rect class="bar-done" x="${x.toFixed(1)}" y="${yD.toFixed(1)}" width="${bw.toFixed(1)}" height="${hDone.toFixed(1)}" rx="1.5" />`;
        if (i % 5 === 0 || i === n - 1) {
          g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle">${d.date.getMonth() + 1}/${d.date.getDate()}</text>`;
        }
      });
      svg.innerHTML = g;
    }

    // iCal 导出/导入
    $("#cal-ics-export").addEventListener("click", () => {
      const ics = CalUtils.exportIcs();
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sakura-calendar-${new Date().toISOString().slice(0, 10)}.ics`;
      a.click();
      URL.revokeObjectURL(url);
      toast("已导出日历文件");
    });
    $("#cal-ics-import").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const arr = CalUtils.importIcs(text);
        if (!arr.length) return toast("未找到可导入的事件");
        Cal.data.tasks.push(...arr);
        Cal.save();
        refreshAll();
        toast(`已导入 ${arr.length} 个事件`);
      } catch (err) {
        toast("导入失败：" + err.message);
      } finally {
        e.target.value = "";
      }
    });

    $("#btn-calendar").addEventListener("click", async () => {
      open();
      // 首次尝试申请通知权限
      if (Cal.data.settings.notify && "Notification" in window && Notification.permission === "default") {
        await CalUtils.requestNotifyPermission();
        CalUtils.scheduleReminders();
      }
    });

    window.UICalRefresh = refreshAll;
    return { init, open, close, refreshAll, renderUpcoming, updateBadge, renderStatsView };
  })();

  // ===================== 任务编辑器 =====================
  const dlgTask = $("#dialog-task");
  const formTask = $("#form-task");
  let editingTaskId = null;

  // 通过 elements 访问避免与 HTMLElement.title 等属性冲突
  const tEl = (name) => formTask.elements.namedItem(name);

  function openTaskDialog(task, dateHint) {
    formTask.reset();
    editingTaskId = task ? task.id : null;
    $("#task-title-head").textContent = task ? "编辑任务" : "新建任务";
    $("#task-delete-btn").hidden = !task;

    // 默认值
    const d = task ? new Date(task.startAt) : (dateHint ? new Date(dateHint) : new Date());
    if (!task && !dateHint) { d.setMinutes(d.getMinutes() + 30); d.setSeconds(0, 0); }

    tEl("title").value = task?.title || "";
    tEl("desc").value = task?.desc || "";
    tEl("date").value = toDateInput(d);
    tEl("time").value = toTimeInput(d);
    tEl("allDay").checked = !!task?.allDay;
    tEl("time").disabled = !!task?.allDay;

    const color = task?.color || "#ff8fab";
    const colorInput = formTask.querySelector(`input[name="color"][value="${color}"]`);
    if (colorInput) colorInput.checked = true;

    const r = task?.repeat || { type: "none", interval: 1 };
    tEl("repeatType").value = r.type || "none";
    tEl("interval").value = r.interval || 1;
    formTask.querySelectorAll('input[name="wd"]').forEach((c) => { c.checked = (r.weekDays || []).includes(+c.value); });
    tEl("until").value = r.until ? toDateInput(new Date(r.until)) : "";
    tEl("remindBefore").value = String(task?.remindBefore || 0);

    updateRepeatUI();
    Dlg.open(dlgTask);
  }

  function updateRepeatUI() {
    const t = tEl("repeatType").value;
    const intWrap = formTask.querySelector(".repeat-interval");
    const wdWrap = formTask.querySelector(".weekdays-picker");
    const unitMap = { daily: "天", weekly: "周", monthly: "个月", yearly: "年" };
    intWrap.hidden = (t === "none");
    wdWrap.hidden = (t !== "weekly");
    formTask.querySelector(".repeat-until").hidden = (t === "none");
    if (unitMap[t]) $("#interval-unit").textContent = unitMap[t];
  }
  tEl("repeatType").addEventListener("change", updateRepeatUI);

  tEl("allDay").addEventListener("change", (e) => {
    tEl("time").disabled = e.target.checked;
  });

  $("#task-delete-btn").addEventListener("click", () => {
    if (!editingTaskId) return;
    if (!confirm("删除这个任务？所有历史记录都会消失。")) return;
    Cal.remove(editingTaskId);
    Dlg.close(dlgTask);
    UICal.refreshAll();
  });

  formTask.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f));
    const allDay = !!data.allDay;
    const dateStr = data.date;
    const timeStr = allDay ? "00:00" : (data.time || "09:00");
    const startAt = new Date(dateStr + "T" + timeStr).getTime();
    const wd = [...formTask.querySelectorAll('input[name="wd"]:checked')].map((x) => +x.value);
    const repeat = {
      type: data.repeatType || "none",
      interval: parseInt(data.interval || "1", 10) || 1,
    };
    if (repeat.type === "weekly" && wd.length) repeat.weekDays = wd;
    if (data.until) repeat.until = new Date(data.until + "T23:59:59").getTime();

    const patch = {
      title: data.title.trim() || "未命名",
      desc: data.desc || "",
      startAt,
      allDay,
      color: data.color || "#ff8fab",
      repeat,
      remindBefore: parseInt(data.remindBefore || "0", 10) || 0,
    };
    if (editingTaskId) {
      const old = Cal.get(editingTaskId);
      // 如果改了 startAt，清空例外/完成记录避免错位
      if (old && (old.startAt !== patch.startAt || JSON.stringify(old.repeat) !== JSON.stringify(patch.repeat))) {
        patch.exceptions = [];
        patch.doneDates = [];
        patch.done = false;
      }
      Cal.update(editingTaskId, patch);
    } else {
      Cal.create(patch);
    }
    Dlg.close(dlgTask);
    UICal.refreshAll();
    toast("已保存");
  });

  function toDateInput(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function toTimeInput(d) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }


    return UICal;
  };
})();
