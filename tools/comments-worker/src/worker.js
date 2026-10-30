const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELETE_TOKEN = /^[0-9a-f]{64}$/i;
const PAGE_SIZE = 50;
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function postPath(value) {
  if (typeof value !== 'string' || value.length > 512 || !/^\/posts\/[^?#\s]+\/$/.test(value)) {
    throw new HttpError(400, '올바른 글 주소가 아니에요.');
  }
  return value;
}

async function jsonBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, '지원하지 않는 요청 형식이에요.');
  }
  if (!request.body) throw new HttpError(400, '요청 내용이 없어요.');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw new HttpError(413, '입력 내용이 너무 길어요.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch {
    throw new HttpError(400, '요청 내용을 읽을 수 없어요.');
  }
}

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameHash(left, right) {
  if (typeof left !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function rateLimit(request, env) {
  if (!env.COMMENT_RATE_LIMIT_SECRET || env.COMMENT_RATE_LIMIT_SECRET.length < 32) {
    throw new HttpError(503, '댓글 서버 설정을 확인해 주세요.');
  }
  const minute = Math.floor(Date.now() / 60000);
  const ip = request.headers.get('cf-connecting-ip');
  // Local development has no Cloudflare IP header. Production headers are set by Cloudflare.
  const clientKey = await digest(`${env.COMMENT_RATE_LIMIT_SECRET}:${ip || 'local'}:${Math.floor(minute / 1440)}`);
  await env.DB.prepare('DELETE FROM rate_limits WHERE minute < ?').bind(minute - 60).run();
  const bucket = await env.DB.prepare(
    `INSERT INTO rate_limits (client_key, minute, count) VALUES (?, ?, 1)
     ON CONFLICT (client_key, minute) DO UPDATE SET count = count + 1
     WHERE count < 10 RETURNING count`
  ).bind(clientKey, minute).first();
  if (!bucket) throw new HttpError(429, '요청이 많아요. 잠시 후 다시 시도해 주세요.');
}

function publicComment(row) {
  return { id: row.id, post: row.post, author: row.author, body: row.body, created_at: row.created_at };
}

async function listComments(url, env) {
  const post = postPath(url.searchParams.get('post'));
  const cursor = url.searchParams.get('before');
  let query;
  if (cursor) {
    const separator = cursor.indexOf(':');
    const timestamp = Number(cursor.slice(0, separator));
    const id = cursor.slice(separator + 1);
    if (separator < 1 || !Number.isSafeInteger(timestamp) || timestamp < 1 || !UUID.test(id)) {
      throw new HttpError(400, '잘못된 페이지 요청이에요.');
    }
    query = env.DB.prepare(
      `SELECT id, post, author, body, created_at FROM comments
       WHERE post = ? AND (created_at, id) < (?, ?)
       ORDER BY created_at DESC, id DESC LIMIT ?`
    ).bind(post, timestamp, id, PAGE_SIZE + 1);
  } else {
    query = env.DB.prepare(
      `SELECT id, post, author, body, created_at FROM comments
       WHERE post = ? ORDER BY created_at DESC, id DESC LIMIT ?`
    ).bind(post, PAGE_SIZE + 1);
  }
  const { results } = await query.all();
  const comments = results.slice(0, PAGE_SIZE).map(publicComment);
  const last = comments.at(-1);
  return {
    comments,
    next_cursor: results.length > PAGE_SIZE ? `${last.created_at}:${last.id}` : null
  };
}

async function createComment(request, env) {
  const data = await jsonBody(request);
  const post = postPath(data.post);
  const author = typeof data.author === 'string' ? data.author.trim() || '익명' : '익명';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  if (data.website || !UUID.test(data.id) || !DELETE_TOKEN.test(data.delete_token)) {
    throw new HttpError(400, '올바르지 않은 댓글 요청이에요.');
  }
  if (author.length > 30 || body.length < 1 || body.length > 2000) {
    throw new HttpError(400, '닉네임은 30자, 댓글은 1~2,000자로 입력해 주세요.');
  }
  const deleteHash = await digest(data.delete_token);
  const existing = await env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(data.id).first();
  if (existing) {
    if (sameHash(existing.delete_hash, deleteHash) && existing.post === post && existing.author === author && existing.body === body) {
      return publicComment(existing);
    }
    throw new HttpError(409, '댓글을 다시 등록해 주세요.');
  }
  await rateLimit(request, env);
  const row = { id: data.id, post, author, body, created_at: Date.now() };
  await env.DB.prepare(
    'INSERT INTO comments (id, post, author, body, created_at, delete_hash) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(row.id, post, author, body, row.created_at, deleteHash).run();
  return row;
}

async function deleteComment(request, env, id) {
  if (!UUID.test(id)) throw new HttpError(400, '올바른 댓글 번호가 아니에요.');
  const data = await jsonBody(request);
  if (!DELETE_TOKEN.test(data.delete_token)) throw new HttpError(403, '이 댓글을 삭제할 수 없어요.');
  await rateLimit(request, env);
  const row = await env.DB.prepare('SELECT delete_hash FROM comments WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, '이미 삭제된 댓글이에요.');
  const hash = await digest(data.delete_token);
  if (!sameHash(row.delete_hash, hash)) throw new HttpError(403, '이 브라우저에서 작성한 댓글만 삭제할 수 있어요.');
  await env.DB.prepare('DELETE FROM comments WHERE id = ? AND delete_hash = ?').bind(id, hash).run();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin');
    const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin'
    });
    const respond = (status, data) => data === undefined
      ? new Response(null, { status, headers })
      : Response.json(data, { status, headers });
    if (origin && !allowedOrigins.includes(origin)) return respond(403, { error: '허용되지 않은 사이트예요.' });
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      if (!origin) return respond(403, { error: '사이트 주소가 필요해요.' });
      headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
      headers.set('Access-Control-Max-Age', '86400');
      return respond(204);
    }
    try {
      const url = new URL(request.url);
      if (!env.DB) throw new HttpError(503, '댓글 저장소가 연결되지 않았어요.');
      if (url.pathname === '/health' && request.method === 'GET') {
        await env.DB.prepare('SELECT id FROM comments LIMIT 0').all();
        if (!env.COMMENT_RATE_LIMIT_SECRET || env.COMMENT_RATE_LIMIT_SECRET.length < 32) {
          throw new HttpError(503, '댓글 서버 설정이 필요해요.');
        }
        return respond(200, { ok: true });
      }
      if (url.pathname === '/comments' && request.method === 'GET') {
        return respond(200, await listComments(url, env));
      }
      if (!origin) throw new HttpError(403, '사이트 주소가 필요해요.');
      if (url.pathname === '/comments' && request.method === 'POST') {
        return respond(201, { comment: await createComment(request, env) });
      }
      const match = url.pathname.match(/^\/comments\/([^/]+)$/);
      if (match && request.method === 'DELETE') {
        await deleteComment(request, env, match[1]);
        return respond(204);
      }
      return respond(404, { error: '요청한 주소를 찾을 수 없어요.' });
    } catch (error) {
      if (error instanceof HttpError) return respond(error.status, { error: error.message });
      console.error('Comment API error:', error.name);
      return respond(503, { error: '댓글 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' });
    }
  }
};
