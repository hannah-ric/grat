'use strict';

const fs = require('fs');
const path = require('path');

function restBackend() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const command = async commandParts => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(commandParts)
    });
    const data = await response.json();
    if (response.ok === false || (data && data.error)) throw new Error(String(data && data.error || `KV request failed (${response.status})`));
    return data ? data.result : null;
  };
  return {
    get: key => command(['GET', key]),
    set: (key, value, options) => options && options.ex
      ? command(['SET', key, value, 'EX', String(options.ex)])
      : command(['SET', key, value]),
    del: key => command(['DEL', key]),
    incr: key => command(['INCR', key]),
    incrby: (key, n) => command(['INCRBY', key, String(n)]),
    expire: (key, seconds) => command(['EXPIRE', key, String(seconds)])
  };
}

function fileBackend() {
  const file = process.env.BB_KV_FILE;
  if (!file) return null;
  const read = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { return {}; }
  };
  const write = map => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(map));
  };
  const unwrap = (map, key) => {
    const entry = map[key];
    if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value')) {
      if (entry.expiresAt && entry.expiresAt <= Date.now()) { delete map[key]; write(map); return null; }
      return entry.value;
    }
    return entry === undefined ? null : entry;
  };
  return {
    get: async key => unwrap(read(), key),
    set: async (key, value, options) => {
      const map = read();
      map[key] = options && options.ex ? { value, expiresAt: Date.now() + options.ex * 1000 } : value;
      write(map);
      return 'OK';
    },
    del: async key => { const map = read(); delete map[key]; write(map); return 1; },
    incr: async key => {
      const map = read();
      const current = Number(unwrap(map, key) || 0);
      map[key] = current + 1;
      write(map);
      return current + 1;
    },
    incrby: async (key, n) => {
      const map = read();
      const next = Number(unwrap(map, key) || 0) + Number(n);
      map[key] = next;
      write(map);
      return next;
    },
    expire: async (key, seconds) => {
      const map = read();
      const value = unwrap(map, key);
      if (value === null) return 0;
      map[key] = { value, expiresAt: Date.now() + seconds * 1000 };
      write(map);
      return 1;
    }
  };
}

function backend() { return restBackend() || fileBackend(); }
function configured() { return !!backend(); }

module.exports = { backend, configured };
