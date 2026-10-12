import { DateTime } from './vendor/luxon.mjs';

export { DateTime };

function boundary(date, time, zone, end = false) {
  const midnight = time === '24:00';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('Choose valid dates and hours.');
  let value = DateTime.fromISO(`${date}T${midnight ? '00:00' : time}`, { zone });
  if (midnight) value = value.plus({ days: 1 });
  if (!value.isValid || (!midnight && (value.toISODate() !== date || value.toFormat('HH:mm') !== time))) {
    throw new Error(`${date} at ${time} does not exist in ${zone}. Choose another boundary time.`);
  }
  const alternatives = value.getPossibleOffsets().sort((a, b) => a.toMillis() - b.toMillis());
  return end ? alternatives.at(-1) : alternatives[0];
}

export function makeCandidates(dates, start, end, zone, slotMinutes = 15) {
  if (![15, 30, 60].includes(slotMinutes)) throw new Error('Choose 15, 30, or 60 minutes per cell.');
  if (!DateTime.now().setZone(zone).isValid) throw new Error('Choose a valid timezone.');
  if (!dates.length) return [];
  if (dates.length > 31) throw new Error('Choose at most 31 candidate dates.');
  const toMinutes = time => {
    const [hour, minute] = time.split(':').map(Number);
    if (!Number.isInteger(hour) || ![0, 15, 30, 45].includes(minute) || hour > 24 || hour < 0 || (hour === 24 && minute)) {
      throw new Error('Choose hours in 15-minute increments.');
    }
    return hour * 60 + minute;
  };
  if (toMinutes(start) >= toMinutes(end) || start === '24:00') throw new Error('The end time must be later than the start time.');
  const result = [];
  for (const date of [...new Set(dates)].sort()) {
    const from = boundary(date, start, zone), until = boundary(date, end, zone, true);
    const duration = slotMinutes * 60_000;
    if ((until.toMillis() - from.toMillis()) % duration) throw new Error(`The daily window must fit whole ${slotMinutes}-minute cells. Adjust From or Until.`);
    for (let instant = from.toMillis(); instant < until.toMillis(); instant += duration) {
      result.push({ startUtc: new Date(instant).toISOString(), endUtc: new Date(instant + duration).toISOString() });
    }
  }
  if (result.length > 3000) throw new Error('Choose at most 3,000 candidate slots.');
  return result;
}

export function gridModel(slots, zone) {
  const days = new Map(), rowLabels = new Map();
  for (const slot of [...slots].sort((a, b) => a.startUtc.localeCompare(b.startUtc))) {
    const time = DateTime.fromISO(slot.startUtc, { zone }), until = DateTime.fromISO(slot.endUtc, { zone });
    const date = time.toISODate(), startClock = time.toFormat('HH:mm'), clock = `${startClock}:${until.toFormat('HH:mm')}`;
    if (!days.has(date)) days.set(date, { date, week: time.startOf('week').toISODate(), label: time.toFormat('ccc'), sublabel: time.toFormat('LLL d'), cells: new Map(), occurrences: new Map() });
    const day = days.get(date), count = day.occurrences.get(startClock) ?? 0;
    day.occurrences.set(startClock, count + 1);
    const key = `${clock}:${count}`;
    day.cells.set(key, { ...slot, time, label: `${time.toFormat('cccc, LLL d, yyyy · h:mm a ZZZZ')} – ${until.toFormat('h:mm a ZZZZ')}` });
    const format = time.offset !== until.offset ? 'h:mm a ZZZZ' : 'h:mm a';
    rowLabels.set(key, `${time.toFormat(format)}${count ? ' (repeat)' : ''}`);
  }
  return {
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    rows: [...rowLabels.keys()].sort().map(key => ({ key, label: rowLabels.get(key) }))
  };
}

export function editorDefaults(slots, zone) {
  const times = slots.map(slot => DateTime.fromISO(slot.startUtc, { zone }));
  const ends = slots.map(slot => DateTime.fromISO(slot.endUtc, { zone }));
  return {
    dates: [...new Set(times.map(time => time.toISODate()))].sort(),
    start: times.map(time => time.toFormat('HH:mm')).sort()[0] ?? '09:00',
    end: ends.map((time, i) => time.toISODate() !== times[i].toISODate() ? '24:00' : time.toFormat('HH:mm')).sort().at(-1) ?? '17:00'
  };
}
