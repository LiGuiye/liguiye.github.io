import { API_BASE_URL } from './config.js';

export const apiBase = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? '/api' : API_BASE_URL.replace(/\/$/, '');

export async function request(path, { method = 'GET', token, data, etag } = {}) {
  if (!apiBase) throw new Error('This scheduling page is not ready yet. Please contact the organizer.');
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (data) headers['Content-Type'] = 'application/json';
  if (etag) headers['If-None-Match'] = etag;
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, { method, headers, body: data ? JSON.stringify(data) : undefined, cache: 'no-store' });
  } catch { throw new Error('Cannot connect. Your selections are still here; please retry when you are online.'); }
  if (response.status === 304 || response.status === 204) return null;
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('The connection was interrupted. Your selections are still here; please retry.'); }
  if (!response.ok) {
    const error = new Error(payload.error ?? 'The request failed.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function privateLink(eventCode, parameters = {}) {
  const url = new URL('./', location.href);
  url.search = eventCode ? new URLSearchParams({ e: eventCode }).toString() : '';
  url.hash = new URLSearchParams(parameters).toString();
  return url.href;
}
