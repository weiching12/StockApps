const TAIPEI_OFFSET = 8 * 60 * 60 * 1000;
const slots = [18, 20];

const taipeiParts = (now) => {
  const shifted = new Date(now.getTime() + TAIPEI_OFFSET);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), date: shifted.getUTCDate(),
    day: shifted.getUTCDay(), hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(), second: shifted.getUTCSeconds() };
};
const epoch = ({ year, month, date }, hour, minute = 30) => Date.UTC(year, month, date, hour - 8, minute);

export function nextMarketUpdate(now = new Date()) {
  const current = taipeiParts(now);
  if (current.day !== 0 && current.day !== 6) {
    for (const hour of slots) {
      const candidate = epoch(current, hour);
      if (candidate > now.getTime()) return { at: new Date(candidate), label: `${hour}:30` };
    }
  }
  const next = new Date(epoch(current, 12, 0));
  do next.setUTCDate(next.getUTCDate() + 1);
  while ([0, 6].includes(taipeiParts(next).day));
  const target = epoch(taipeiParts(next), 18);
  return { at: new Date(target), label: "18:30" };
}

export function countdownText(now = new Date()) {
  const next = nextMarketUpdate(now);
  if (next.label === "20:30") return "";
  const seconds = Math.max(0, Math.floor((next.at.getTime() - now.getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  const duration = [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
  return `預計 ${next.label} 更新 · ${duration}`;
}

/**
 * Today's date in Taipei ("YYYY-MM-DD") when today's evening update is under way: a weekday at or after
 * 18:30, so the countdown has ended. Null otherwise (before 18:30, or a weekend).
 */
export function updatingDay(now = new Date()) {
  const current = taipeiParts(now);
  if (current.day === 0 || current.day === 6 || now.getTime() < epoch(current, 18)) return null;
  return [current.year, current.month + 1, current.date].map((part, index) => String(part).padStart(index ? 2 : 4, "0")).join("-");
}

/** Writes `text()` (by default the countdown) into the node every second; returns a stop function. */
export function startUpdateCountdown(node, read = () => countdownText(new Date())) {
  if (!node) return () => {};
  const render = () => {
    const text = read();
    node.textContent = text;
    node.hidden = !text;
  };
  render();
  const timer = setInterval(render, 1000);
  return () => clearInterval(timer);
}
