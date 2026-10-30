const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELETE_TOKEN = /^[0-9a-f]{64}$/i;
const PIN = /^[0-9]{4}$/;
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

function giscusTerm(post) {
  // location.pathname in giscus's client is percent-encoded, including Korean slugs.
  return new URL(post, 'https://blog.invalid').pathname.substring(1).replace(/\.\w+$/, '');
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

async function digest(value, algorithm = 'SHA-256') {
  const hash = await crypto.subtle.digest(algorithm, encoder.encode(value));
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

async function secretHash(value, env) {
  if (!env.COMMENT_RATE_LIMIT_SECRET || env.COMMENT_RATE_LIMIT_SECRET.length < 32) {
    throw new HttpError(503, '댓글 서버 설정을 확인해 주세요.');
  }
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.COMMENT_RATE_LIMIT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hash = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function pinHash(id, pin, env) {
  // A per-comment HMAC prevents testing the 10,000 PINs from a DB dump alone.
  // Never persist the PIN, return this hash, or reuse it as a deletion token.
  return secretHash(`comment-delete-pin:v1:${id}:${pin}`, env);
}

async function pinAttemptLimit(id, env) {
  // Share a small allowance across IPs so changing networks cannot brute-force a PIN.
  const minute = Math.floor(Date.now() / 60000);
  const windowStart = minute - minute % 15;
  const clientKey = await digest(`${env.COMMENT_RATE_LIMIT_SECRET}:pin-attempt:${id}`);
  const bucket = await env.DB.prepare(
    `INSERT INTO rate_limits (client_key, minute, count) VALUES (?, ?, 1)
     ON CONFLICT (client_key, minute) DO UPDATE SET count = count + 1
     WHERE count < 5 RETURNING count`
  ).bind(clientKey, windowStart).first();
  if (!bucket) throw new HttpError(429, 'PIN 입력 시도가 많아요. 최대 15분 후 다시 시도해 주세요.');
}

async function rateLimit(request, env, scope = '', maximum = 10) {
  if (!env.COMMENT_RATE_LIMIT_SECRET || env.COMMENT_RATE_LIMIT_SECRET.length < 32) {
    throw new HttpError(503, '댓글 서버 설정을 확인해 주세요.');
  }
  const minute = Math.floor(Date.now() / 60000);
  const ip = request.headers.get('cf-connecting-ip');
  // Local development has no Cloudflare IP header. Production headers are set by Cloudflare.
  const clientKey = await digest(`${env.COMMENT_RATE_LIMIT_SECRET}:${scope ? `${scope}:` : ''}${ip || 'local'}:${Math.floor(minute / 1440)}`);
  await env.DB.prepare('DELETE FROM rate_limits WHERE minute < ?').bind(minute - 60).run();
  const bucket = await env.DB.prepare(
    `INSERT INTO rate_limits (client_key, minute, count) VALUES (?, ?, 1)
     ON CONFLICT (client_key, minute) DO UPDATE SET count = count + 1
     WHERE count < ? RETURNING count`
  ).bind(clientKey, minute, maximum).first();
  if (!bucket) throw new HttpError(429, '요청이 많아요. 잠시 후 다시 시도해 주세요.');
}

function pageviewPath(value) {
  return postPath(new URL(postPath(value), 'https://blog.invalid').pathname);
}

async function pageviews(post, env) {
  const row = await env.DB.prepare('SELECT views FROM pageviews WHERE post = ?').bind(post).first();
  return { post, views: row?.views || 0 };
}

async function recordPageview(request, env) {
  const data = await jsonBody(request);
  const post = pageviewPath(data.post);
  if (!UUID.test(data.id)) throw new HttpError(400, '올바르지 않은 조회 요청이에요.');
  const existing = await env.DB.prepare('SELECT post FROM pageview_events WHERE id = ?').bind(data.id).first();
  if (existing) {
    if (existing.post !== post) throw new HttpError(409, '이미 사용된 조회 번호예요.');
    return pageviews(post, env);
  }
  // Browsing articles has its own allowance, so it does not consume comment limits.
  await rateLimit(request, env, 'pageviews', 60);
  await env.DB.prepare('DELETE FROM pageview_events WHERE created_at < ?').bind(Date.now() - 86400000).run();
  const results = await env.DB.batch([
    env.DB.prepare('INSERT INTO pageviews (post, views) VALUES (?, 0) ON CONFLICT DO NOTHING').bind(post),
    env.DB.prepare('INSERT INTO pageview_events (id, post, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(data.id, post, Date.now()),
    // batch is a transaction. changes() is the preceding visit insert's 0 or 1,
    // including when concurrent retries have the same ID.
    env.DB.prepare('UPDATE pageviews SET views = views + changes() WHERE post = ? RETURNING views').bind(post)
  ]);
  return { post, views: results[2].results[0].views };
}

function visitorDays() {
  // Use the server's clock and Korean calendar day, independent of visitor clocks.
  const koreanTime = Date.now() + 9 * 60 * 60 * 1000;
  return {
    today: new Date(koreanTime).toISOString().slice(0, 10),
    yesterday: new Date(koreanTime - 86400000).toISOString().slice(0, 10)
  };
}

async function visitors(env, days = visitorDays()) {
  const { results } = await env.DB.prepare(
    "SELECT day, visitors FROM visitor_stats WHERE day IN (?, ?, 'total')"
  ).bind(days.today, days.yesterday).all();
  const counts = Object.fromEntries(results.map((row) => [row.day, row.visitors]));
  return { date: days.today, timezone: 'Asia/Seoul', today: counts[days.today] || 0,
    yesterday: counts[days.yesterday] || 0, total: counts.total || 0 };
}

async function recordVisitor(request, env) {
  const data = await jsonBody(request);
  if (typeof data.id !== 'string' || !UUID.test(data.id)) throw new HttpError(400, '올바르지 않은 방문 요청이에요.');
  const days = visitorDays();
  const hash = await secretHash(`site-visitor:v1:${days.today}:${data.id}`, env);
  const existing = await env.DB.prepare(
    'SELECT 1 AS found FROM visitor_events WHERE day = ? AND visitor_hash = ?'
  ).bind(days.today, hash).first();
  if (existing) return visitors(env, days);
  await rateLimit(request, env, 'visitors', 60);
  await env.DB.prepare('DELETE FROM visitor_events WHERE day < ?').bind(days.yesterday).run();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO visitor_stats (day, visitors) VALUES (?, 0) ON CONFLICT DO NOTHING').bind(days.today),
    env.DB.prepare("INSERT INTO visitor_stats (day, visitors) VALUES ('total', 0) ON CONFLICT DO NOTHING"),
    env.DB.prepare('INSERT INTO visitor_events (day, visitor_hash) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(days.today, hash),
    // One atomic visit insert adds either 0 or 1 to both daily and total counts.
    env.DB.prepare("UPDATE visitor_stats SET visitors = visitors + changes() WHERE day IN (?, 'total')").bind(days.today)
  ]);
  return visitors(env, days);
}

function publicComment(row) {
  return { id: row.id, post: row.post, author: row.author, body: row.body, created_at: row.created_at,
    delete_method: row.delete_pin_hash ? 'pin' : 'browser' };
}

async function listComments(url, env) {
  const post = postPath(url.searchParams.get('post'));
  const oldest = commentOrder(url) === 'oldest';
  const direction = oldest ? 'ASC' : 'DESC';
  const comparison = oldest ? '>' : '<';
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
      `SELECT id, post, author, body, created_at, delete_pin_hash FROM comments
       WHERE post = ? AND (created_at, id) ${comparison} (?, ?)
       ORDER BY created_at ${direction}, id ${direction} LIMIT ?`
    ).bind(post, timestamp, id, PAGE_SIZE + 1);
  } else {
    query = env.DB.prepare(
      `SELECT id, post, author, body, created_at, delete_pin_hash FROM comments
       WHERE post = ? ORDER BY created_at ${direction}, id ${direction} LIMIT ?`
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

function commentOrder(url) {
  const order = url.searchParams.get('order') || 'newest';
  if (!['oldest', 'newest'].includes(order)) throw new HttpError(400, '잘못된 정렬 요청이에요.');
  return order;
}

function publicGitHubComment(comment, reply = false) {
  return {
    id: comment.id,
    author: {
      name: comment.author?.login || '삭제된 사용자',
      avatar_url: comment.author?.avatarUrl || '',
      url: comment.author?.url || ''
    },
    created_at: comment.createdAt,
    url: comment.url,
    hidden: Boolean(comment.deletedAt || comment.isMinimized),
    deleted: Boolean(comment.deletedAt),
    body_html: comment.deletedAt || comment.isMinimized ? '' : comment.bodyHTML,
    upvotes: comment.upvoteCount || 0,
    reactions: Object.entries(comment.reactions || {}).map(([content, { count }]) => ({ content, count })),
    ...(!reply && {
      reply_count: comment.replyCount || 0,
      replies: (comment.replies || []).map((item) => publicGitHubComment(item, true))
    })
  };
}

async function listGitHubComments(url, env) {
  const post = postPath(url.searchParams.get('post'));
  const oldest = commentOrder(url) === 'oldest';
  const cursor = url.searchParams.get('before');
  if (cursor && cursor.length > 512) throw new HttpError(400, '잘못된 페이지 요청이에요.');
  // Only this configured public repository can be read; no caller-supplied URL or token.
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GISCUS_REPO || '') || !env.GISCUS_CATEGORY) {
    throw new HttpError(503, 'GitHub 댓글 서버 설정을 확인해 주세요.');
  }
  const upstream = new URL('https://giscus.app/api/discussions');
  upstream.search = new URLSearchParams({
    repo: env.GISCUS_REPO,
    category: env.GISCUS_CATEGORY,
    strict: env.GISCUS_STRICT === '0' ? 'false' : 'true',
    // Match giscus's pathname mapping, including its trailing slash.
    term: giscusTerm(post),
    [oldest ? 'first' : 'last']: String(PAGE_SIZE)
  });
  if (cursor) upstream.searchParams.set(oldest ? 'after' : 'before', cursor);
  const cache = globalThis.caches?.default;
  const cacheUrl = new URL('/_github-comments-cache', url.origin);
  cacheUrl.search = upstream.search;
  const cacheKey = new Request(cacheUrl);
  if (cache && url.searchParams.get('fresh') !== '1') {
    const cached = await cache.match(cacheKey).catch(() => null);
    if (cached) return cached.json();
  }
  const response = await fetch(upstream, {
    headers: { Accept: 'application/json' },
    // Workers supports follow/manual, but not Fetch's redirect:error mode.
    redirect: 'manual',
    signal: AbortSignal.timeout(10000)
  });
  if (response.status === 404) return { comments: [], next_cursor: null, discussion_url: null };
  if (!response.ok) {
    throw new HttpError(response.status === 429 ? 429 : 503, 'GitHub 댓글을 불러오지 못했어요. 잠시 후 새로고침해 주세요.');
  }
  const { discussion } = await response.json();
  if (!discussion || !Array.isArray(discussion.comments) || !discussion.pageInfo) {
    throw new HttpError(503, 'GitHub 댓글 응답을 읽을 수 없어요.');
  }
  const { pageInfo } = discussion;
  const comments = discussion.comments.map((comment) => publicGitHubComment(comment));
  if (!oldest) comments.reverse();
  const result = {
    comments,
    next_cursor: oldest
      ? (pageInfo.hasNextPage ? pageInfo.endCursor : null)
      : (pageInfo.hasPreviousPage ? pageInfo.startCursor : null),
    discussion_url: discussion.url
  };
  if (cache) {
    await cache.put(cacheKey, Response.json(result, { headers: { 'Cache-Control': 'public, max-age=30' } })).catch(() => {});
  }
  return result;
}

async function createComment(request, env) {
  const data = await jsonBody(request);
  const post = postPath(data.post);
  const author = typeof data.author === 'string' ? data.author.trim() || '익명' : '익명';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const hasPin = data.pin !== undefined;
  if (hasPin && (typeof data.pin !== 'string' || !PIN.test(data.pin))) {
    throw new HttpError(400, '삭제 PIN은 숫자 4자리로 입력해 주세요.');
  }
  // Keep requests from the previous browser-key client working during rollout.
  if (data.website || !UUID.test(data.id) || (!hasPin && !DELETE_TOKEN.test(data.delete_token))) {
    throw new HttpError(400, '올바르지 않은 댓글 요청이에요.');
  }
  if (author.length > 30 || body.length < 1 || body.length > 2000) {
    throw new HttpError(400, '닉네임은 30자, 댓글은 1~2,000자로 입력해 주세요.');
  }
  const deleteHash = hasPin ? '' : await digest(data.delete_token);
  const deletePinHash = hasPin ? await pinHash(data.id, data.pin, env) : null;
  const existing = await env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(data.id).first();
  if (existing) {
    if (hasPin && existing.delete_pin_hash) {
      // Retrying a public comment's POST must not become an unlimited PIN oracle.
      await rateLimit(request, env);
      await pinAttemptLimit(data.id, env);
    }
    const ownsComment = hasPin ? sameHash(existing.delete_pin_hash, deletePinHash)
      : !existing.delete_pin_hash && sameHash(existing.delete_hash, deleteHash);
    if (ownsComment && existing.post === post && existing.author === author && existing.body === body) {
      return publicComment(existing);
    }
    throw new HttpError(409, '댓글을 다시 등록해 주세요.');
  }
  await rateLimit(request, env);
  const row = { id: data.id, post, author, body, created_at: Date.now(), delete_pin_hash: deletePinHash };
  await env.DB.prepare(
    'INSERT INTO comments (id, post, author, body, created_at, delete_hash, delete_pin_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(row.id, post, author, body, row.created_at, deleteHash, deletePinHash).run();
  return publicComment(row);
}

async function deleteComment(request, env, id) {
  if (!UUID.test(id)) throw new HttpError(400, '올바른 댓글 번호가 아니에요.');
  const data = await jsonBody(request);
  await rateLimit(request, env);
  const row = await env.DB.prepare('SELECT delete_hash, delete_pin_hash FROM comments WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, '이미 삭제된 댓글이에요.');
  if (row.delete_pin_hash) {
    if (typeof data.pin !== 'string' || !PIN.test(data.pin)) throw new HttpError(400, '삭제 PIN은 숫자 4자리로 입력해 주세요.');
    await pinAttemptLimit(id, env);
    const hash = await pinHash(id, data.pin, env);
    if (!sameHash(row.delete_pin_hash, hash)) throw new HttpError(403, 'PIN이 일치하지 않아요.');
    await env.DB.prepare('DELETE FROM comments WHERE id = ? AND delete_pin_hash = ?').bind(id, hash).run();
    return;
  }
  if (!DELETE_TOKEN.test(data.delete_token)) throw new HttpError(403, '이 댓글은 작성한 브라우저에서 삭제할 수 있어요.');
  const hash = await digest(data.delete_token);
  if (!sameHash(row.delete_hash, hash)) throw new HttpError(403, '이 브라우저에서 작성한 댓글만 삭제할 수 있어요.');
  await env.DB.prepare('DELETE FROM comments WHERE id = ? AND delete_hash = ?').bind(id, hash).run();
}

const loginRequired = 'GitHub 로그인이 만료되었어요. 위 댓글창에서 로그아웃한 뒤 다시 로그인해 주세요.';

async function giscusToken(session) {
  if (typeof session !== 'string' || !session || session.length > 4096) {
    throw new HttpError(401, loginRequired);
  }
  // Reuse the encrypted session already issued by giscus. The raw GitHub token
  // stays in this request's memory; never return, cache, persist, or log it.
  const response = await fetch('https://giscus.app/api/oauth/token', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session })
  });
  if ([400, 401, 403].includes(response.status)) throw new HttpError(401, loginRequired);
  if (!response.ok) throw new HttpError(503, 'GitHub 로그인 확인에 실패했어요. 잠시 후 다시 시도해 주세요.');
  const result = await response.json().catch(() => ({}));
  if (typeof result.token !== 'string' || !result.token || result.token.length > 4096) {
    throw new HttpError(401, loginRequired);
  }
  return result.token;
}

async function githubRequest(token, query, variables) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'optimization-log-comments'
    },
    body: JSON.stringify({ query, variables })
  });
  if (response.status === 401) throw new HttpError(401, loginRequired);
  if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
    throw new HttpError(429, 'GitHub 요청이 많아요. 잠시 후 다시 시도해 주세요.');
  }
  const result = await response.json().catch(() => ({}));
  if (result.errors?.some((error) => error.type === 'RATE_LIMITED')) {
    throw new HttpError(429, 'GitHub 요청이 많아요. 잠시 후 다시 시도해 주세요.');
  }
  if (result.errors?.some((error) => error.type === 'NOT_FOUND')) {
    throw new HttpError(404, '이미 삭제되었거나 찾을 수 없는 댓글이에요.');
  }
  if (response.status === 403 || result.errors?.some((error) => error.type === 'FORBIDDEN')) {
    throw new HttpError(403, '이 댓글을 삭제할 권한이 없어요.');
  }
  if (!response.ok || result.errors?.length || !result.data) {
    throw new HttpError(503, 'GitHub 댓글 삭제에 실패했어요. 잠시 후 다시 시도해 주세요.');
  }
  return result.data;
}

async function deleteGitHubComment(request, env, encodedId) {
  let id;
  try { id = decodeURIComponent(encodedId); } catch { throw new HttpError(400, '올바른 댓글 번호가 아니에요.'); }
  if (!/^[A-Za-z0-9_+/=-]{8,200}$/.test(id)) throw new HttpError(400, '올바른 댓글 번호가 아니에요.');
  const data = await jsonBody(request);
  const post = postPath(data.post);
  await rateLimit(request, env);
  const token = await giscusToken(data.session);
  const result = await githubRequest(token, `query CommentDeletionPermission($id: ID!) {
    node(id: $id) {
      __typename
      ... on DiscussionComment {
        id viewerDidAuthor viewerCanDelete
        replies(first: 1) { totalCount }
        discussion { title body category { name } repository { nameWithOwner } }
      }
    }
  }`, { id });
  const comment = result.node;
  if (!comment) throw new HttpError(404, '이미 삭제되었거나 찾을 수 없는 댓글이에요.');
  // GitHub checks the authenticated user, not any username sent by the browser.
  // A repository admin still cannot use this endpoint to delete somebody else's comment.
  if (comment.__typename !== 'DiscussionComment' || comment.id !== id ||
      comment.viewerDidAuthor !== true || comment.viewerCanDelete !== true) {
    throw new HttpError(403, '로그인한 계정이 작성한 댓글만 삭제할 수 있어요.');
  }
  const discussion = comment.discussion;
  if (discussion?.repository?.nameWithOwner?.toLowerCase() !== env.GISCUS_REPO?.toLowerCase() ||
      discussion?.category?.name !== env.GISCUS_CATEGORY) {
    throw new HttpError(403, '이 블로그의 댓글만 삭제할 수 있어요.');
  }
  const term = giscusTerm(post);
  const matchesPost = env.GISCUS_STRICT === '0'
    ? discussion.title === term
    : typeof discussion.body === 'string' && discussion.body.includes(`<!-- sha1: ${await digest(term, 'SHA-1')} -->`);
  if (!matchesPost) throw new HttpError(403, '현재 글의 댓글만 삭제할 수 있어요.');
  const deleted = await githubRequest(token, `mutation DeleteBlogComment($id: ID!) {
    deleteDiscussionComment(input: { id: $id }) { clientMutationId }
  }`, { id });
  if (!deleted.deleteDiscussionComment) throw new HttpError(503, 'GitHub 댓글 삭제 결과를 확인하지 못했어요.');
  // GitHub wipes a parent comment that has replies instead of removing the thread.
  return { retained: comment.replies?.totalCount > 0 };
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
      if (url.pathname === '/github-comments' && request.method === 'GET') {
        return respond(200, await listGitHubComments(url, env));
      }
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
      if (url.pathname === '/pageviews' && request.method === 'GET') {
        return respond(200, await pageviews(pageviewPath(url.searchParams.get('post')), env));
      }
      if (url.pathname === '/visitors' && request.method === 'GET') {
        return respond(200, await visitors(env));
      }
      if (!origin) throw new HttpError(403, '사이트 주소가 필요해요.');
      if (url.pathname === '/visitors' && request.method === 'POST') {
        return respond(200, await recordVisitor(request, env));
      }
      if (url.pathname === '/pageviews' && request.method === 'POST') {
        return respond(200, await recordPageview(request, env));
      }
      const githubMatch = url.pathname.match(/^\/github-comments\/([^/]+)$/);
      if (githubMatch && request.method === 'DELETE') {
        return respond(200, await deleteGitHubComment(request, env, githubMatch[1]));
      }
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
