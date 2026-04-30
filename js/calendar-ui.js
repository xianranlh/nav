/* Calendar panel rendering helpers. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./render-utils.js"));
  } else {
    root.HomepageCalendarUI = factory(root.SakuraRender);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Render) {
  "use strict";

  const escapeHtml = Render.escapeHtml;
  const safeColor = Render.safeCssColor;

  function renderWeekdayLabels(firstDayOfWeek, weekNames) {
    const names = [];
    const first = Number(firstDayOfWeek || 1);
    for (let i = 0; i < 7; i++) names.push(weekNames[(first + i) % 7]);
    return names.map((name) => `<span>${escapeHtml(name)}</span>`).join("");
  }

  function renderMonthCell({
    cell,
    items,
    todayTime,
    selectedTime,
    weatherBadgeHtml = "",
    maxItems = 3,
  }) {
    const dayKey = cell.date.getTime();
    const weekday = cell.date.getDay();
    const classes = ["cal-cell"];
    if (!cell.inMonth) classes.push("out");
    if (dayKey === todayTime) classes.push("today");
    if (dayKey === selectedTime) classes.push("selected");
    const dayCls = weekday === 0 ? "sun" : weekday === 6 ? "sat" : "";
    const safeItems = Array.isArray(items) ? items : [];
    const shown = safeItems.slice(0, maxItems).map(({ task, done }) =>
      `<div class="day-task ${done ? "done" : ""}" style="--task-color:${safeColor(task && task.color)}" title="${escapeHtml(task && task.title)}">${escapeHtml(task && task.title)}</div>`
    ).join("");
    const more = safeItems.length > maxItems ? `<div class="more">+${safeItems.length - maxItems} 更多</div>` : "";
    return `<div class="${classes.join(" ")}" data-ts="${dayKey}" style="position:relative">
      <span class="day-num ${dayCls}">${cell.date.getDate()}</span>
      ${weatherBadgeHtml}
      <div class="day-tasks">${shown}${more}</div>
    </div>`;
  }

  function renderTaskListItem({
    task,
    ts,
    done,
    dateTimeText,
    repeatLabelHtml = "",
    countdownText,
    countdownClass = "",
    weatherTipHtml = "",
  }) {
    return `<li class="cal-day-item ${done ? "done" : ""}" data-id="${escapeHtml(task && task.id)}" data-ts="${ts}" style="--task-color:${safeColor(task && task.color)}">
      <div class="task-title">${escapeHtml(task && task.title)}${weatherTipHtml}</div>
      <div class="task-meta">
        <span>${escapeHtml(dateTimeText)}</span>
        ${repeatLabelHtml}
        <span class="countdown ${escapeHtml(countdownClass)}" data-cd="${ts}">${escapeHtml(countdownText)}</span>
      </div>
      ${task && task.desc ? `<div style="font-size:12px;color:var(--text-soft)">${escapeHtml(task.desc)}</div>` : ""}
      <div class="task-actions">
        <button data-act="${done ? "undo" : "done"}">${done ? "↶ 还原" : "✓ 完成"}</button>
        <button data-act="skip">⊘ 跳过本次</button>
        <button data-act="edit">✎ 编辑</button>
        <button data-act="del">🗑 删除</button>
      </div>
    </li>`;
  }

  function renderUpcomingItem({ task, ts, countdownText, stateClass }) {
    return `<li class="upcoming-item ${escapeHtml(stateClass)}" data-id="${escapeHtml(task && task.id)}" data-ts="${ts}" style="border-left-color:${safeColor(task && task.color)}">
      <span class="u-title">${escapeHtml(task && task.title)}</span>
      <span class="u-count" data-cd="${ts}">${escapeHtml(countdownText)}</span>
    </li>`;
  }

  function renderStatsChart(days, { width = 600, height = 160, pad = 18 } = {}) {
    const items = Array.isArray(days) ? days : [];
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;
    const n = Math.max(1, items.length);
    const bw = innerW / n * 0.75;
    const gap = innerW / n * 0.25;
    const maxTotal = Math.max(1, ...items.map((day) => day.total));
    let html = "";
    items.forEach((day, i) => {
      const x = pad + i * (bw + gap);
      const hTotal = (day.total / maxTotal) * innerH;
      const hDone = (day.done / maxTotal) * innerH;
      const yT = height - pad - hTotal;
      const yD = height - pad - hDone;
      html += `<rect class="bar-total" x="${x.toFixed(1)}" y="${yT.toFixed(1)}" width="${bw.toFixed(1)}" height="${hTotal.toFixed(1)}" rx="1.5" />`;
      html += `<rect class="bar-done" x="${x.toFixed(1)}" y="${yD.toFixed(1)}" width="${bw.toFixed(1)}" height="${hDone.toFixed(1)}" rx="1.5" />`;
      if (i % 5 === 0 || i === items.length - 1) {
        html += `<text x="${(x + bw / 2).toFixed(1)}" y="${(height - 4).toFixed(1)}" text-anchor="middle">${day.date.getMonth() + 1}/${day.date.getDate()}</text>`;
      }
    });
    return html;
  }

  return {
    renderWeekdayLabels,
    renderMonthCell,
    renderTaskListItem,
    renderUpcomingItem,
    renderStatsChart,
  };
});
