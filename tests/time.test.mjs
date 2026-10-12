import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCandidates, gridModel, editorDefaults } from '../meet/time.js';
import { availabilityStatus } from '../meet/availability.js';

test('dated slots use exact UTC instants in the event timezone', () => {
  const slots = makeCandidates(['2026-10-12'], '09:00', '10:00', 'America/Denver');
  assert.equal(slots.length, 4);
  assert.equal(slots[0].startUtc, '2026-10-12T15:00:00.000Z');
  assert.equal(slots.at(-1).endUtc, '2026-10-12T16:00:00.000Z');
});

test('fall-back hours are both offered and visibly distinguished', () => {
  const slots = makeCandidates(['2026-11-01'], '00:00', '04:00', 'America/Denver');
  assert.equal(slots.length, 20);
  const grid = gridModel(slots.map((slot, i) => ({ ...slot, id: String(i) })), 'America/Denver');
  assert.equal(grid.rows.filter(row => row.label.startsWith('1:00 AM')).length, 2);
  assert.ok(grid.rows.some(row => row.label.includes('repeat')));
});

test('spring-forward gaps are skipped; nonexistent boundary times are rejected', () => {
  const slots = makeCandidates(['2026-03-08'], '00:00', '04:00', 'America/Denver');
  assert.equal(slots.length, 12);
  assert.throws(() => makeCandidates(['2026-03-08'], '02:15', '04:00', 'America/Denver'), /does not exist/);
});

test('display timezone changes the day without changing slot identity', () => {
  const slots = makeCandidates(['2026-10-12'], '23:30', '24:00', 'America/Denver').map((slot, i) => ({ ...slot, id: String(i) }));
  const grid = gridModel(slots, 'UTC');
  assert.equal(grid.days[0].date, '2026-10-13');
  assert.equal(grid.days[0].cells.values().next().value.id, '0');
  assert.equal(editorDefaults(slots, 'America/Denver').end, '24:00');
});

test('dates may span weeks and are deduplicated', () => {
  assert.equal(makeCandidates(['2026-10-12', '2026-11-12', '2026-10-12'], '09:00', '09:15', 'America/Denver').length, 2);
});

test('invalid windows and timezones cannot generate a misleading grid', () => {
  assert.throws(() => makeCandidates(['2026-10-12'], '17:00', '09:00', 'America/Denver'), /end time/);
  assert.throws(() => makeCandidates(['2026-10-12'], '09:05', '10:00', 'America/Denver'), /15-minute/);
  assert.throws(() => makeCandidates(['2026-10-12'], '09:00', '10:00', 'Invalid/Zone'), /timezone/);
});

function cells(grid) { return grid.days.flatMap(day => [...day.cells.values()]); }
function identified(slots) { return slots.map((slot, i) => ({ ...slot, id: String(i) })); }

test('15, 30, and 60-minute events generate actual cells of the chosen duration', () => {
  for (const [increment, count] of [[15, 16], [30, 8], [60, 4]]) {
    const slots = identified(makeCandidates(['2026-10-12', '2026-10-13'], '09:00', '11:00', 'America/Denver', increment));
    const grouped = cells(gridModel(slots, 'America/Denver'));
    assert.equal(grouped.length, count);
    assert.deepEqual(grouped.map(cell => cell.id).sort(), slots.map(slot => slot.id).sort());
    assert.ok(grouped.every(cell => Date.parse(cell.endUtc) - Date.parse(cell.startUtc) === increment * 60_000));
  }
});

test('cells fit the selected window and gaps remain unoffered', () => {
  const slots = identified(makeCandidates(['2026-10-12'], '09:15', '10:15', 'America/Denver', 30));
  const grouped = cells(gridModel(slots, 'America/Denver'));
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].startUtc, slots[0].startUtc);
  assert.equal(grouped[1].endUtc, slots[1].endUtc);
  const withGap = cells(gridModel(slots.filter(slot => slot.id !== '1'), 'America/Denver'));
  assert.deepEqual(withGap.map(cell => cell.id), ['0']);
  assert.throws(() => makeCandidates(['2026-10-12'], '09:15', '10:00', 'America/Denver', 30), /whole 30-minute/);
  assert.throws(() => makeCandidates(['2026-10-12'], '09:00', '10:00', 'America/Denver', 45), /15, 30, or 60/);
});

test('longer views preserve repeated hours and timezone day boundaries', () => {
  const slots = identified(makeCandidates(['2026-11-01'], '00:00', '04:00', 'America/Denver', 60));
  const grouped = cells(gridModel(slots, 'America/Denver'));
  assert.equal(grouped.length, 5);
  assert.equal(grouped.filter(cell => cell.time.hour === 1).length, 2);
  assert.notEqual(grouped[1].time.offset, grouped[2].time.offset);
  assert.ok(gridModel(slots, 'America/Denver').rows.some(row => row.label.includes('repeat')));
  const midnight = identified(makeCandidates(['2026-10-12'], '17:30', '19:30', 'America/Denver', 60));
  const utc = gridModel(midnight, 'UTC');
  assert.equal(utc.days.length, 2);
  assert.deepEqual(cells(utc).map(cell => cell.id), midnight.map(slot => slot.id));
  assert.ok(cells(utc).every(cell => Date.parse(cell.endUtc) - Date.parse(cell.startUtc) === 3_600_000));
});

test('explicit false answers differ from unanswered cells and can be cleared', () => {
  const slots = [{ id: 'a' }, { id: 'b' }];
  const answers = new Map([['a', false]]);
  assert.equal(availabilityStatus(slots[0], answers), 'unavailable');
  assert.equal(availabilityStatus(slots[1], answers), 'unanswered');
  answers.set('b', true);
  assert.equal(availabilityStatus(slots[1], answers), 'available');
  answers.delete('a');
  assert.equal(availabilityStatus(slots[0], answers), 'unanswered');
});

test('sparse dates are grouped by calendar week, including year boundaries', () => {
  const dates = ['2026-11-02', '2026-11-09', '2026-11-13', '2026-11-16', '2026-12-31', '2027-01-01', '2027-01-04'];
  const slots = identified(makeCandidates(dates, '12:00', '12:30', 'America/Denver', 30));
  const grid = gridModel(slots, 'America/Denver');
  assert.deepEqual(grid.days.map(day => day.week), ['2026-11-02', '2026-11-09', '2026-11-09', '2026-11-16', '2026-12-28', '2026-12-28', '2027-01-04']);
  assert.deepEqual(cells(grid).map(cell => cell.id).sort(), slots.map(slot => slot.id).sort());
});

test('week grouping follows the displayed timezone without moving slots', () => {
  const slots = identified(makeCandidates(['2026-11-08'], '23:30', '24:00', 'America/Denver', 30));
  const local = gridModel(slots, 'America/Denver'), utc = gridModel(slots, 'UTC');
  assert.equal(local.days[0].week, '2026-11-02');
  assert.equal(utc.days[0].week, '2026-11-09');
  assert.equal(cells(local)[0].id, cells(utc)[0].id);
});

test('row labels use start times while cell details retain the full interval', () => {
  const slots = identified(makeCandidates(['2026-11-09'], '12:00', '13:00', 'America/Denver', 30));
  const grid = gridModel(slots, 'America/Denver');
  assert.deepEqual(grid.rows.map(row => row.label), ['12:00 PM', '12:30 PM']);
  assert.match(cells(grid)[0].label, /12:00 PM MST – 12:30 PM MST/);
  assert.deepEqual(cells(grid).map(cell => cell.id), slots.map(slot => slot.id));
});
