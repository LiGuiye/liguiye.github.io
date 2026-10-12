import { request, privateLink } from './api.js';
import { DateTime, makeCandidates, gridModel, editorDefaults } from './time.js';
import { availabilityStatus, statusLabels } from './availability.js';

const $ = selector => document.querySelector(selector);
const fragment = new URLSearchParams(location.hash.slice(1));
const query = new URLSearchParams(location.search);
let eventId = query.get('e') || query.get('event');
let adminToken = null, organizerToken = null;
let organizerMode = fragment.has('organizer') || fragment.has('admin'), organizerUnlocked = false, organizerAction = 'list';
let state, identity, draft, dirty = false, busy = false, refreshing = false;
let zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver';
let pendingSave;
let markValue = true;

function element(tag, className, content) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (content !== undefined) item.textContent = content;
  return item;
}
function notice(message, error = false) {
  $('#notice').hidden = !message;
  $('#notice').textContent = message;
  $('#notice').classList.toggle('error', error);
}
function stored(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function remember(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ } }
function organizerSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem('scheduler:organizer'));
    return session?.token ? session : null;
  } catch { return null; }
}
function rememberOrganizer(session) {
  try { session ? sessionStorage.setItem('scheduler:organizer', JSON.stringify(session)) : sessionStorage.removeItem('scheduler:organizer'); } catch {}
}
function homePanel(id) {
  for (const name of ['welcome', 'organizer-login', 'profile-signup', 'dashboard', 'composer', 'event-view']) $(`#${name}`).hidden = name !== id;
  const titles = { welcome: 'Find a time', 'organizer-login': 'Organizer access', 'profile-signup': 'Create profile', dashboard: 'Your events', composer: 'Create an event' };
  if (titles[id]) document.title = `${titles[id]} · Guiye Li`;
}
function organizerLogin(action = 'list') {
  organizerAction = action; homePanel('organizer-login'); $('#organizer-username').focus();
}
function profileSignup(action = 'list') {
  organizerAction = action; homePanel('profile-signup'); notice(''); $('#profile-username').focus();
}
function renderEventList(events) {
  const list = $('#event-list'); list.replaceChildren();
  if (!events.length) {
    const empty = element('div', 'card');
    empty.append(element('h2', '', 'Your first event starts here.'), element('p', 'muted', 'Choose Create new event to invite people to share their availability.'));
    list.append(empty); return;
  }
  for (const event of events) {
    const card = element('article', 'card event-list-item'), info = element('div'), title = element('h2');
    const open = element('a', '', event.title); open.href = privateLink(event.shareCode); title.append(open); info.append(title);
    if (event.firstSlot) {
      const first = DateTime.fromISO(event.firstSlot, { zone: event.timezone }).toFormat('LLL d, yyyy');
      const last = DateTime.fromISO(event.lastSlot, { zone: event.timezone }).toFormat('LLL d, yyyy');
      info.append(element('p', '', first === last ? first : `${first} – ${last}`));
    }
    info.append(element('p', 'event-list-meta', `${event.slotCount} cells · ${event.slotMinutes} minutes per cell · ${event.responseCount} ${event.responseCount === 1 ? 'response' : 'responses'} · ${event.timezone.replaceAll('_', ' ')}`));
    const actions = element('div', 'event-list-actions');
    const share = element('button', 'secondary', 'Copy event link'); share.type = 'button';
    share.setAttribute('aria-label', `Copy event link for ${event.title}`);
    share.addEventListener('click', () => copy(privateLink(event.shareCode), 'Participation link copied.'));
    const manage = element('a', 'primary', 'Manage event');
    manage.href = privateLink(event.shareCode, { organizer: '1' }); manage.setAttribute('aria-label', `Manage ${event.title}`);
    actions.append(share, manage); card.append(info, actions); list.append(card);
  }
}
async function restoreOrganizer(session, action = 'list') {
  const data = await request('/events', { token: session.token });
  organizerToken = session.token; organizerUnlocked = true; rememberOrganizer(session);
  $('#organizer-user').textContent = `Signed in as ${session.username}`;
  renderEventList(data.events); homePanel('dashboard');
  history.replaceState({}, '', privateLink(null));
  notice('');
  if (action === 'create') showComposer();
}
async function openOrganizerAction(action) {
  if (organizerToken && organizerUnlocked && action === 'create') { showComposer(); return; }
  const session = organizerSession();
  if (!session) { organizerLogin(action); return; }
  try { await restoreOrganizer(session, action); }
  catch (error) {
    if (error.status === 401) { organizerToken = null; organizerUnlocked = false; rememberOrganizer(null); }
    organizerLogin(action); notice(error.message, true);
  }
}
function fillZones(select, chosen) {
  const zones = new Set(['UTC', 'America/Denver', chosen, ...(Intl.supportedValuesOf?.('timeZone') ?? [])]);
  for (const value of [...zones].filter(Boolean).sort()) {
    const option = element('option', '', value.replaceAll('_', ' '));
    option.value = value;
    select.append(option);
  }
  select.value = chosen;
}
async function copy(value, message = 'Link copied.') {
  try { await navigator.clipboard.writeText(value); notice(message); }
  catch {
    notice('Clipboard access is unavailable. Select and copy this link:', true);
    const input = element('input');
    input.readOnly = true; input.value = value;
    input.setAttribute('aria-label', 'Link to copy');
    input.addEventListener('focus', () => input.select());
    $('#notice').append(input); input.select();
  }
}

function renderGrid(container, slots, displayZone, { selected, answers, touched = new Set(), toggle, responses, detail, slotMinutes = state?.event.slotMinutes ?? 15 } = {}) {
  container.replaceChildren();
  const model = gridModel(slots, displayZone);
  if (!model.days.length) { container.append(element('p', 'empty-grid', 'Add a date to start.')); return; }
  const table = element('table', 'time-grid');
  table.dataset.increment = slotMinutes;
  table.setAttribute('aria-label', toggle ? 'Select time slots' : 'Group availability by time slot');
  const head = element('thead'), headers = element('tr');
  headers.append(element('th', '', 'Time'));
  const weekStarts = new Set(model.days.filter((day, index) => index > 0 && day.week !== model.days[index - 1].week).map(day => day.date));
  for (const day of model.days) {
    const th = element('th', weekStarts.has(day.date) ? 'week-start' : '', day.sublabel);
    th.scope = 'col';
    th.append(element('span', '', day.label));
    headers.append(th);
  }
  head.append(headers);
  const body = element('tbody'), buttons = new Map();
  const spacer = element('tr', 'grid-spacer'), spacerCell = element('td');
  spacer.setAttribute('aria-hidden', 'true'); spacerCell.colSpan = model.days.length + 1;
  spacer.append(spacerCell); body.append(spacer);
  function paintCell(button, cell) {
    const status = answers ? availabilityStatus(cell, answers) : selected.has(cell.id) ? 'available' : 'unavailable';
    button.setAttribute('aria-pressed', String(status === 'available'));
    for (const name of ['unavailable', 'unanswered']) button.classList.toggle(name, !!answers && status === name);
    const label = answers ? statusLabels[status] : status === 'available' ? 'Offered' : 'Not offered';
    const text = `${cell.label}: ${label}${answers && touched.has(cell.id) ? ' (unsaved)' : ''}`;
    button.textContent = status === 'available' ? '✓' : answers ? status === 'unanswered' ? '?' : '×' : '';
    button.setAttribute('aria-label', text); button.title = text;
  }
  const hasHourRows = model.rows.some(row => row.key.slice(3, 5) === '00');
  for (const [index, row] of model.rows.entries()) {
    const hour = row.key.slice(3, 5) === '00';
    const tr = element('tr', hour ? 'hour' : '');
    const showTime = index === 0 || hour || !hasHourRows || row.label.includes('(repeat)');
    const label = element('th');
    label.append(element('span', 'time-label', showTime ? row.label : ''));
    label.scope = 'row'; label.setAttribute('aria-label', row.label); label.title = row.label; tr.append(label);
    for (const day of model.days) {
      const td = element('td', weekStarts.has(day.date) ? 'week-start' : ''), slot = day.cells.get(row.key);
      if (slot) {
        const button = element('button', 'slot');
        button.type = 'button'; button.dataset.slotId = slot.id;
        if (toggle) {
          paintCell(button, slot);
        } else {
          const statuses = responses.map(answers => availabilityStatus(slot, answers));
          const count = statuses.filter(status => status === 'available').length;
          const unanswered = statuses.every(status => status === 'unanswered');
          button.classList.add('group');
          button.classList.toggle('unanswered', unanswered);
          button.style.setProperty('--intensity', responses.length ? count / responses.length : 0);
          button.textContent = unanswered ? '?' : String(count);
          button.setAttribute('aria-label', `${slot.label}: ${count} of ${responses.length} available${unanswered ? ' · Not answered yet' : ''}`);
          button.title = button.getAttribute('aria-label');
          button.addEventListener('click', () => detail(slot));
          button.addEventListener('pointerenter', () => detail(slot));
          button.addEventListener('focus', () => detail(slot));
        }
        buttons.set(slot.id, { button, slot }); td.append(button);
      } else td.append(element('div', 'missing-slot'));
      tr.append(td);
    }
    body.append(tr);
  }
  const lastSlot = model.days.map(day => day.cells.get(model.rows.at(-1).key)).find(Boolean);
  const endTime = DateTime.fromISO(lastSlot.endUtc, { zone: displayZone }).toFormat('h:mm a');
  const foot = element('tfoot'), endRow = element('tr'), endLabel = element('th'), endSpace = element('td');
  endLabel.append(element('span', 'time-label', endTime));
  endLabel.setAttribute('aria-label', `Ending time: ${endTime}`);
  endSpace.colSpan = model.days.length;
  endRow.append(endLabel, endSpace); foot.append(endRow);
  table.append(head, body, foot); container.append(table);
  if (!toggle) return;
  let dragging = false, paint;
  const apply = button => {
    if (!button || button.disabled) return;
    const slot = buttons.get(button.dataset.slotId).slot;
    toggle(slot, paint);
    paintCell(button, slot);
    if (answers) selectionCount();
  };
  table.addEventListener('pointerdown', event => {
    const button = event.target.closest('.slot');
    if (event.pointerType !== 'mouse' || event.button !== 0 || !button || button.disabled) return;
    event.preventDefault(); dragging = true; paint = answers ? markValue : !selected.has(button.dataset.slotId); apply(button);
  });
  table.addEventListener('pointerover', event => { if (dragging && event.buttons === 1) apply(event.target.closest('.slot')); });
  table.addEventListener('pointerup', () => { dragging = false; });
  table.addEventListener('pointerleave', event => { if (!event.buttons) dragging = false; });
  table.addEventListener('click', event => {
    const button = event.target.closest('.slot');
    if (!button || button.disabled || (event.detail && event.pointerType === 'mouse')) return;
    paint = answers ? markValue : !selected.has(button.dataset.slotId); apply(button);
  });
}

function showComposer(editing = false) {
  if (!editing) homePanel('composer');
  const container = $('#composer');
  container.replaceChildren($('#composer-template').content.cloneNode(true));
  container.hidden = false;
  const form = container.querySelector('form'), fields = form.elements;
  const defaults = editing ? editorDefaults(state.slots, state.event.timezone) : { dates: [], start: '09:00', end: '17:00' };
  const key = slot => `${slot.startUtc}/${slot.endUtc}`;
  let slotMinutes = editing ? state.event.slotMinutes : 15;
  let dates = defaults.dates, options = [], selected = new Set(editing ? state.slots.map(key) : []), valid = true;
  const original = new Map(editing ? state.slots.map(slot => [key(slot), slot]) : []);
  const editRevision = state?.event.slotRevision;
  let pendingCreation;
  fillZones(fields.timezone, editing ? state.event.timezone : 'America/Denver');
  fields.timezone.disabled = editing;
  for (let minute = 0; minute <= 1440; minute += 15) {
    const value = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const label = minute === 1440 ? 'Midnight (next day)' : DateTime.fromISO(`2000-01-01T${value}`).toFormat('h:mm a');
    if (minute < 1440) { const option = element('option', '', label); option.value = value; fields.start.append(option); }
    const option = element('option', '', label); option.value = value; fields.end.append(option);
  }
  fields.start.value = defaults.start; fields.end.value = defaults.end;
  fields.increment.value = slotMinutes;
  fields.date.value = DateTime.now().setZone(fields.timezone.value).plus({ days: 1 }).toISODate();
  if (editing) {
    fields.title.value = state.event.title; fields.description.value = state.event.description;
    container.querySelector('.composer-eyebrow').textContent = 'Organizer controls';
    container.querySelector('.composer-title').textContent = 'Edit candidate times';
    container.querySelector('.composer-intro').textContent = 'Keep the times you need, add new options, or remove dates.';
    container.querySelector('.save-event').textContent = 'Save event changes';
    container.querySelector('.editor-note').textContent = 'Answers stay attached to identical time ranges. Removed or resized cells and their answers are deleted. New cells start unanswered.';
  }
  container.querySelector('.cancel-editor').hidden = false;
  container.querySelector('.cancel-editor').textContent = editing ? 'Cancel' : 'Back to events';
  function summary() {
    if (!valid) {
      container.querySelector('.candidate-summary').textContent = 'Choose a valid time window before saving.';
      container.querySelector('.save-event').disabled = true; return;
    }
    const kept = [...selected].filter(start => original.has(start)).length;
    const originalMinutes = editing ? state.event.slotMinutes : 15;
    container.querySelector('.candidate-summary').textContent = editing
      ? `${kept * originalMinutes} min kept · ${(selected.size - kept) * slotMinutes} min added · ${(original.size - kept) * originalMinutes} min removed`
      : `${dates.length} ${dates.length === 1 ? 'date' : 'dates'} · ${selected.size} cells · ${slotMinutes} minutes per cell`;
    container.querySelector('.save-event').disabled = !valid || !selected.size;
  }
  function grid() {
    renderGrid(container.querySelector('.candidate-grid'), options.map(slot => ({ ...slot, id: key(slot) })), fields.timezone.value, {
      selected, slotMinutes,
      toggle(slot, value) { value ? selected.add(slot.id) : selected.delete(slot.id); summary(); }
    });
    summary();
  }
  function regenerate(initial = false) {
    try {
      const previous = new Set(options.map(key));
      options = makeCandidates(dates, fields.start.value, fields.end.value, fields.timezone.value, slotMinutes);
      selected = new Set(options.filter(slot => initial && editing ? selected.has(key(slot)) : selected.has(key(slot)) || !previous.has(key(slot))).map(key));
      notice('');
      valid = true; grid();
    } catch (error) {
      valid = false; notice(error.message, true);
      container.querySelector('.candidate-grid').replaceChildren(element('p', 'empty-grid', error.message)); summary();
    }
  }
  function chips() {
    const list = container.querySelector('.date-chips'); list.replaceChildren();
    for (const date of dates) {
      const chip = element('button', 'date-chip', `${DateTime.fromISO(date).toFormat('ccc, LLL d, yyyy')} ×`);
      chip.type = 'button'; chip.setAttribute('aria-label', `Remove ${date}`);
      chip.addEventListener('click', () => { dates = dates.filter(value => value !== date); chips(); regenerate(); }); list.append(chip);
    }
  }
  container.querySelector('.add-date').addEventListener('click', () => {
    if (!fields.date.value) { notice('Choose a date first.', true); return; }
    if (!dates.includes(fields.date.value)) dates = [...dates, fields.date.value].sort();
    fields.date.value = DateTime.fromISO(fields.date.value).plus({ days: 1 }).toISODate();
    chips(); regenerate();
  });
  for (const input of [fields.start, fields.end, fields.timezone]) input.addEventListener('change', () => regenerate());
  fields.increment.addEventListener('change', () => {
    slotMinutes = Number(fields.increment.value); regenerate();
  });
  container.querySelector('.select-all').addEventListener('click', () => { selected = new Set(options.map(key)); grid(); });
  container.querySelector('.clear-all').addEventListener('click', () => { selected.clear(); grid(); });
  container.querySelector('.cancel-editor').addEventListener('click', () => { editing ? container.hidden = true : openOrganizerAction('list'); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!valid || !selected.size) return;
    const payload = { title: fields.title.value, description: fields.description.value, timezone: fields.timezone.value, slotMinutes,
      slots: options.filter(slot => selected.has(key(slot))) };
    const button = container.querySelector('.save-event'), originalLabel = button.textContent;
    const controls = [...form.querySelectorAll('button, input, select, textarea')].map(control => [control, control.disabled]);
    controls.forEach(([control]) => { control.disabled = true; }); button.textContent = 'Saving…';
    try {
      let next;
      if (editing) next = await request(`/events/${eventId}`, { method: 'PATCH', token: adminToken, data: { ...payload, slotRevision: editRevision } });
      else {
        pendingCreation ??= { id: crypto.randomUUID() };
        next = await request('/events', { method: 'POST', token: organizerToken, data: { ...payload, ...pendingCreation } });
        eventId = pendingCreation.id; adminToken = organizerToken; organizerMode = true;
        prepareIdentity();
      }
      homePanel('event-view');
      applyState(next, true);
      notice(editing ? 'Event updated. Answers for unchanged times have been kept.' : 'Event created. Share the event link and manage it from your organizer workspace.');
    } catch (error) { notice(error.message, true); }
    finally { controls.forEach(([control, disabled]) => { control.disabled = disabled; }); button.textContent = originalLabel; summary(); }
  });
  chips(); regenerate(true);
}

function prepareIdentity() {
  identity = stored(`scheduler:${eventId}`);
}
function ownAnswers() {
  return new Map(state.availability.filter(answer => answer.participantId === identity?.id).map(answer => [answer.slotId, answer.available]));
}
function applyState(next, review = false) {
  if (state?.event.id === next.event.id && next.event.revision < state.event.revision) next = state;
  state = next;
  const url = privateLink(state.event.shareCode, organizerMode ? { organizer: '1' } : {});
  if (location.href !== url) history.replaceState({}, '', url);
  const person = state.participants.find(value => value.id === identity?.id);
  if (!dirty || review || !draft) {
    const previous = draft;
    const answers = ownAnswers();
    draft = { answers: dirty && review && previous ? new Map([...previous.answers].filter(([id]) => state.slots.some(slot => slot.id === id))) : answers,
      touched: dirty && review && previous ? new Set([...previous.touched].filter(id => state.slots.some(slot => slot.id === id))) : new Set(),
      slotRevision: state.event.slotRevision, revision: person?.revision ?? identity?.revision ?? 0 };
    if (identity && !dirty) $('#participant-name').value = person?.name ?? identity.name;
  }
  $('#event-view').hidden = false;
  $('#event-title').textContent = state.event.title; document.title = `${state.event.title} · Find a time`;
  $('#event-description').textContent = state.event.description;
  const dateCount = new Set(state.slots.map(slot => DateTime.fromISO(slot.startUtc, { zone: state.event.timezone }).toISODate())).size;
  $('#event-meta').textContent = `${dateCount} candidate ${dateCount === 1 ? 'date' : 'dates'} · Event timezone: ${state.event.timezone.replaceAll('_', ' ')}`;
  $('#event-interval').textContent = `${state.event.slotMinutes}-minute cells`;
  $('#edit-event').hidden = !adminToken;
  $('#delete-event').hidden = !adminToken;
  $('#participant-access').hidden = !!identity;
  $('#signed-in').hidden = !identity;
  $('#current-name').textContent = identity ? `Editing ${person?.name ?? identity.name}’s response` : '';
  renderEventGrids();
}
function renderEventGrids() {
  $('#slot-detail').textContent = 'Select a time to see who is available.';
  renderGrid($('#own-grid'), state.slots, zone, { answers: draft.answers, touched: draft.touched,
    toggle(slot, value) {
      if (busy || !identity) return;
      value === undefined ? draft.answers.delete(slot.id) : draft.answers.set(slot.id, value);
      draft.touched.add(slot.id);
      dirty = true;
    } });
  const responses = state.participants.map(person => new Map(state.availability.filter(answer => answer.participantId === person.id).map(answer => [answer.slotId, answer.available])));
  renderGrid($('#group-grid'), state.slots, zone, { responses, detail: showDetail });
  $('#participant-list').replaceChildren(...state.participants.map(person => element('span', 'name-chip', `${person.name}${person.passwordProtected ? ' 🔒' : ''}`)));
  selectionCount(); disableOwn(busy || !identity);
}
function selectionCount() {
  const available = [...draft.answers.values()].filter(value => value === true).length;
  $('#selection-count').textContent = `${available} available · ${draft.answers.size - available} not available · ${state.slots.length - draft.answers.size} unanswered${dirty ? ' · unsaved' : ''}`;
}
function disableOwn(disabled) {
  $('#save-response').disabled = disabled;
  $('#own-grid').querySelectorAll('button').forEach(button => { button.disabled = disabled; });
  $('.answer-tools').querySelectorAll('button').forEach(button => { button.disabled = disabled; });
}
function showDetail(slot) {
  const detail = $('#slot-detail'); detail.replaceChildren(element('strong', '', slot.label));
  const responses = state.participants.map(person => ({ person, answers: new Map(state.availability.filter(answer => answer.participantId === person.id).map(answer => [answer.slotId, answer.available])) }));
  for (const [status, label] of Object.entries(statusLabels)) {
    const people = responses.filter(({ answers }) => availabilityStatus(slot, answers) === status);
    if (people.length) detail.append(element('p', '', `${label}: ${people.map(({ person }) => person.name).join(', ')}`));
  }
  if (!state.participants.length) detail.append(element('p', '', 'No responses yet.'));
}
async function refresh(review = false) {
  if (!state || refreshing || busy) return;
  const id = eventId;
  refreshing = true;
  try {
    const next = await request(`/events/${id}`, { etag: review ? undefined : `"${state.event.revision}"` });
    if (eventId !== id) return;
    if (next && next.event.revision >= state.event.revision) {
      const timesChanged = next.event.slotRevision !== state.event.slotRevision;
      applyState(next, review);
      if (timesChanged) { $('#slot-detail').textContent = 'Candidate times changed. Select a time to see who is available.'; notice('The organizer updated the event. Added times are unanswered. Review the current times before saving.'); }
    }
    if (review) notice('Availability refreshed. Review your selections, then save when ready.');
  } catch (error) { if (review) notice(error.message, true); }
  finally { refreshing = false; }
}

$('#home-create').addEventListener('click', () => openOrganizerAction('create'));
$('#home-events').addEventListener('click', () => openOrganizerAction('list'));
$('#home-profile').addEventListener('click', () => profileSignup());
$('#login-create-profile').addEventListener('click', () => profileSignup(organizerAction));
$('#profile-signin').addEventListener('click', () => { $('#profile-password').value = ''; $('#profile-confirm').value = ''; organizerLogin(organizerAction); notice(''); });
$('#register-profile').addEventListener('submit', async event => {
  event.preventDefault();
  const username = $('#profile-username').value.trim(), password = $('#profile-password').value;
  if (password !== $('#profile-confirm').value) { notice('The passwords do not match.', true); return; }
  const button = $('#profile-submit'); button.disabled = true;
  try {
    const session = await request('/organizer/register', { method: 'POST', data: { username, password } });
    rememberOrganizer(session); $('#profile-password').value = ''; $('#profile-confirm').value = '';
    await restoreOrganizer(session, organizerAction); notice('Your profile is ready. You can create your first event.');
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
$('#dashboard-create').addEventListener('click', () => openOrganizerAction('create'));
$('#dashboard-refresh').addEventListener('click', () => openOrganizerAction('list'));
$('#organizer-cancel').addEventListener('click', () => { $('#organizer-password').value = ''; homePanel('welcome'); notice(''); });
$('#organizer-lock').addEventListener('click', async () => {
  const session = organizerSession(), button = $('#organizer-lock'); button.disabled = true;
  try {
    if (session) await request('/organizer/logout', { method: 'POST', token: session.token });
    notice('Signed out of organizer access.');
  } catch (error) { notice(error.message, true); }
  finally {
    organizerToken = null; organizerUnlocked = false; rememberOrganizer(null);
    $('#event-list').replaceChildren(); homePanel('welcome'); button.disabled = false;
  }
});
$('#unlock-organizer').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#organizer-unlock'); button.disabled = true;
  try {
    const username = $('#organizer-username').value.trim(), password = $('#organizer-password').value;
    const session = await request('/organizer/login', { method: 'POST', data: { username, password } });
    rememberOrganizer(session); $('#organizer-password').value = '';
    await restoreOrganizer(session, organizerAction);
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
fillZones($('#display-zone'), zone);
$('.answer-tools').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  markValue = button.dataset.answer === 'available' ? true : button.dataset.answer === 'unavailable' ? false : undefined;
  $('.answer-tools').querySelectorAll('button').forEach(tool => tool.setAttribute('aria-pressed', String(tool === button)));
});
$('#display-zone').addEventListener('change', () => { zone = $('#display-zone').value; renderEventGrids(); $('#slot-detail').textContent = 'Select a time to see who is available.'; });
$('#share-event').addEventListener('click', () => copy(privateLink(state.event.shareCode), 'Participation link copied.'));
$('#edit-event').addEventListener('click', () => { showComposer(true); $('#composer').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('#delete-event').addEventListener('click', () => {
  if (busy || !adminToken) return;
  $('#delete-event-name').textContent = state.event.title;
  $('#delete-error').hidden = true;
  $('#delete-confirmation').showModal();
});
$('#cancel-delete').addEventListener('click', () => $('#delete-confirmation').close());
$('#delete-confirmation').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('#confirm-delete').addEventListener('click', async () => {
  if (busy || !adminToken) return;
  const button = $('#confirm-delete'), deletedId = eventId;
  busy = true; disableOwn(true); button.disabled = true; $('#cancel-delete').disabled = true; button.textContent = 'Deleting…';
  $('#delete-error').hidden = true;
  try {
    try { await request(`/events/${eventId}`, { method: 'DELETE', token: adminToken }); }
    catch (error) { if (error.status !== 404) throw error; }
    $('#delete-confirmation').close();
    remember(`scheduler:${deletedId}`, null);
    dirty = false; state = null; draft = null; identity = null; eventId = null; adminToken = null; pendingSave = null; organizerMode = false;
    history.replaceState({}, '', privateLink(null));
    homePanel('dashboard');
    $('#event-list').replaceChildren(element('p', 'muted', 'Loading your events…'));
    await openOrganizerAction('list');
    notice('Event deleted. Its invitation link is no longer available.');
  } catch (error) {
    $('#delete-error').textContent = error.message; $('#delete-error').hidden = false;
  } finally {
    busy = false; button.disabled = false; $('#cancel-delete').disabled = false; button.textContent = 'Delete event permanently';
    if (state) disableOwn(!identity);
  }
});
$('#refresh').addEventListener('click', () => refresh(true));
$('#participant-access').addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('#participant-name').value.trim(), password = $('#participant-password').value;
  if (!name || busy) return;
  const button = $('#access-response'); button.disabled = true; button.textContent = 'Opening response…';
  try {
    const access = await request(`/events/${eventId}/participants/access`, { method: 'POST', data: { name, password } });
    identity = { id: access.participant.id, name: access.participant.name, revision: access.participant.revision, token: access.token };
    remember(`scheduler:${eventId}`, identity);
    $('#participant-password').value = ''; dirty = false; draft = null; pendingSave = null;
    applyState(access.snapshot);
    notice(`Editing ${identity.name}’s response. Choose your times and save availability.`);
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; button.textContent = 'Start / edit response'; }
});
$('#change-name').addEventListener('click', () => {
  if (dirty) { notice('Save your availability before changing names.', true); return; }
  identity = null; draft = null; pendingSave = null; remember(`scheduler:${eventId}`, null);
  $('#participant-name').value = ''; $('#participant-password').value = '';
  applyState(state); $('#participant-name').focus(); notice('Enter a name to start or edit a response.');
});
$('#save-response').addEventListener('click', async () => {
  if (busy || !identity) return;
  const payload = { slotRevision: draft.slotRevision, revision: draft.revision,
    availableSlotIds: [...draft.answers].filter(([, value]) => value === true).map(([id]) => id).sort(),
    unavailableSlotIds: [...draft.answers].filter(([, value]) => value === false).map(([id]) => id).sort() };
  const signature = JSON.stringify(payload);
  if (pendingSave?.signature !== signature) pendingSave = { signature, requestId: crypto.randomUUID() };
  busy = true; disableOwn(true); $('#save-response').textContent = 'Saving…';
  try {
    const next = await request(`/events/${eventId}/participants/${identity.id}`, { method: 'PUT', token: identity.token, data: { ...payload, requestId: pendingSave.requestId } });
    dirty = false; pendingSave = null; applyState(next);
    notice('Your availability is saved. Return with the same name to edit it later.');
  } catch (error) { notice(error.message, true); }
  finally { busy = false; disableOwn(!identity); $('#save-response').textContent = 'Save availability'; }
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('focus', () => refresh());
window.addEventListener('hashchange', () => location.reload());
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
setInterval(() => { if (!document.hidden) refresh(); }, 30_000);

async function start() {
  if (!eventId) {
    if (fragment.has('create')) { history.replaceState({}, '', privateLink(null)); await openOrganizerAction('create'); }
    else if (organizerSession()) await openOrganizerAction('list');
    else homePanel('welcome');
    return;
  }
  notice('Loading event…');
  try {
    const next = await request(`/events/${eventId}`);
    eventId = next.event.id;
    prepareIdentity();
    if (organizerMode) adminToken = organizerSession()?.token;
    if (adminToken) {
      try { await request(`/events/${eventId}/admin`, { token: adminToken }); }
      catch (error) {
        adminToken = null;
        if (organizerMode && error.status === 401) rememberOrganizer(null);
        notice(error.message, true);
      }
    }
    if (identity) {
      try {
        const person = await request(`/events/${eventId}/participants/${identity.id}`, { token: identity.token });
        identity.name = person.name; identity.revision = person.revision; remember(`scheduler:${eventId}`, identity);
      } catch {
        identity = null; remember(`scheduler:${eventId}`, null);
        notice('Enter your name again to edit your response.');
      }
    }
    applyState(next);
    if ($('#notice').textContent === 'Loading event…') notice('');
  } catch (error) { $('#welcome').hidden = false; notice(error.message, true); }
}
start();
