/* Calendar planning helpers for alternate views and linked tasks. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HomepageCalendarPlanner = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY = 86400000;

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function dayKey(date) {
    return startOfDay(date).getTime();
  }

  function weekRange(date = new Date(), firstDayOfWeek = 1) {
    const start = startOfDay(date);
    const offset = (start.getDay() - firstDayOfWeek + 7) % 7;
    start.setDate(start.getDate() - offset);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return {
      start: days[0].getTime(),
      end: days[6].getTime() + DAY - 1,
      days,
    };
  }

  function groupOccurrencesByDay(items, days) {
    const groups = new Map();
    (Array.isArray(days) ? days : []).forEach((day) => groups.set(dayKey(day), []));
    (Array.isArray(items) ? items : []).forEach((item) => {
      const key = dayKey(new Date(item.ts));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return groups;
  }

  function taskLinks(task) {
    const text = [task && task.desc, task && task.url].filter(Boolean).join(" ");
    const urls = [];
    const re = /https?:\/\/[^\s)]+/gi;
    let match;
    while ((match = re.exec(text))) {
      const url = match[0].replace(/[.,;:!?]+$/, "");
      if (!urls.includes(url)) urls.push(url);
    }
    return urls;
  }

  return {
    DAY,
    startOfDay,
    dayKey,
    weekRange,
    groupOccurrencesByDay,
    taskLinks,
  };
});
