export const UPDATE_SCHEDULE = 'Mondays at 3 am, plus the first and last calendar day of each month at 3 am (Australia/Sydney). Coinciding dates run once.';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function sydneyParts(date: Date) {
  const p = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second) };
}

// 3 am exists on both Sydney daylight-saving transition days.
function sydneyThreeAm(year: number, month: number, day: number): Date {
  const desired = Date.UTC(year, month - 1, day, 3);
  let utc = desired;
  for (let i = 0; i < 3; i += 1) {
    const p = sydneyParts(new Date(utc));
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    utc += desired - represented;
  }
  return new Date(utc);
}

export function scheduledSlots(now = new Date()) {
  const p = sydneyParts(now);
  const slots: { date: string; at: Date }[] = [];
  for (let offset = -8; offset <= 9; offset += 1) {
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (day.getUTCDay() !== 1 && d !== 1 && d !== last) continue;
    slots.push({ date: day.toISOString().slice(0, 10), at: sydneyThreeAm(y, m, d) });
  }
  return {
    previous: slots.filter((s) => s.at <= now).at(-1)!,
    next: slots.find((s) => s.at > now)!,
  };
}
