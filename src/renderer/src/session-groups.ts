/** R82 侧栏信息架构：按更新时间分组 + 紧凑相对时间。
 *
 * 纯函数，便于在 node --test 下直接覆盖（不依赖 DOM）。
 * 分组按传入顺序稳定切分（IPC 返回的列表已按 updatedAt 倒序）。
 */
interface SessionGroup {
  key: "today" | "yesterday" | "week" | "earlier";
  label: string;
  items: SessionMeta[];
}

const GROUP_META: Array<{ key: SessionGroup["key"]; label: string }> = [
  { key: "today", label: "今天" },
  { key: "yesterday", label: "昨天" },
  { key: "week", label: "近 7 天" },
  { key: "earlier", label: "更早" }
];

function startOfDay(value: Date): Date {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** 以「日」为单位偏移，跨夏令时也不会跳过/重复一天。 */
function shiftDays(value: Date, days: number): Date {
  const copy = new Date(value);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function groupSessionsByDate(sessions: SessionMeta[], now = new Date()): SessionGroup[] {
  const todayStart = startOfDay(now).getTime();
  const yesterdayStart = shiftDays(startOfDay(now), -1).getTime();
  const weekStart = shiftDays(startOfDay(now), -6).getTime();
  const buckets: Record<SessionGroup["key"], SessionMeta[]> = { today: [], yesterday: [], week: [], earlier: [] };
  for (const item of sessions) {
    const stamp = new Date(item.updatedAt).getTime();
    if (!Number.isFinite(stamp) || stamp < weekStart) buckets.earlier.push(item);
    else if (stamp >= todayStart) buckets.today.push(item);
    else if (stamp >= yesterdayStart) buckets.yesterday.push(item);
    else buckets.week.push(item);
  }
  return GROUP_META
    .map((meta) => ({ ...meta, items: buckets[meta.key] }))
    .filter((group) => group.items.length > 0);
}

/** 侧栏行尾的紧凑时间：今天显示时刻，越久越粗略；完整日期放 title。 */
export function formatSessionAge(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const stamp = date.getTime();
  if (!Number.isFinite(stamp)) return "";
  const diff = now.getTime() - stamp;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  const todayStart = startOfDay(now).getTime();
  if (stamp >= todayStart) {
    const hours = Math.floor(diff / 3_600_000);
    return hours >= 1 && hours < 6 ? `${hours} 小时前` : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const yesterdayStart = shiftDays(startOfDay(now), -1).getTime();
  if (stamp >= yesterdayStart) return "昨天";
  const weekStart = shiftDays(startOfDay(now), -6).getTime();
  if (stamp >= weekStart) {
    const dayDiff = Math.round((todayStart - startOfDay(date).getTime()) / 86_400_000);
    return `${Math.max(2, dayDiff)} 天前`;
  }
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}/${date.getDate()}`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
