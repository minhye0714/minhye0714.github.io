import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';

export const ORIGIN = 'https://minhye0714.github.io';
export const POST = '/posts/sad-ai-syndrome/';

export function setup(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_comments.sql', import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() { return { meta: sqlite.prepare(sql).run(...values) }; }
      };
    }
  };
  const env = {
    DB, ALLOWED_ORIGINS: ORIGIN,
    GISCUS_REPO: 'minhye0714/minhye0714.github.io', GISCUS_CATEGORY: 'Announcements', GISCUS_STRICT: '1',
    COMMENT_RATE_LIMIT_SECRET: 'test-only-rate-limit-secret-with-32-characters'
  };
  const request = (path, method = 'GET', data, options = {}) => {
    const headers = new Headers({ Origin: ORIGIN, 'CF-Connecting-IP': '192.0.2.1', ...options.headers });
    if (data !== undefined) headers.set('Content-Type', 'application/json');
    if (options.noOrigin) headers.delete('Origin');
    const input = new Request(`https://comments.example.test${path}`, {
      method,
      headers,
      body: options.rawBody !== undefined ? options.rawBody : data === undefined ? undefined : JSON.stringify(data)
    });
    return worker.fetch(input, env);
  };
  return { sqlite, env, request };
}

export function draft(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    post: POST,
    author: '',
    body: '좋은 글 감사합니다!',
    delete_token: Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join(''),
    website: '',
    ...overrides
  };
}
