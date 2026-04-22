/**
 * Thin fetch wrapper. Every API call in the app routes through here.
 * If you need to change the base URL or global error handling, this is the one file.
 */

const BASE = "http://localhost:8000";

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export function get(path) {
  return request(path);
}

export function post(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function del(path) {
  return request(path, { method: "DELETE" });
}
