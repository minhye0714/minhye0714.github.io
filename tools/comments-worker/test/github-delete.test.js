import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setup, POST } from '../support/memory-d1.js';

const ID = 'DC_comment_123';
const SESSION = 'test-only-encrypted-giscus-session';
const TOKEN = 'ghu_test_only_never_return_this_token';
const input = () => ({ post: POST, session: SESSION });

function permission(overrides = {}) {
  return {
    __typename: 'DiscussionComment', id: ID, viewerDidAuthor: true, viewerCanDelete: true,
    replies: { totalCount: 0 },
    discussion: {
      title: POST.substring(1),
      body: `Discussion\n<!-- sha1: ${createHash('sha1').update(POST.substring(1)).digest('hex')} -->`,
      category: { name: 'Announcements' },
      repository: { nameWithOwner: 'minhye0714/minhye0714.github.io' }
    }, ...overrides
  };
}

function upstream(t, options = {}) {
  const calls = [];
  const state = { comment: permission(), ...options };
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), init, body });
    assert.equal(init.redirect, 'manual');
    if (String(url) === 'https://giscus.app/api/oauth/token') {
      assert.deepEqual(body, { session: SESSION });
      return state.sessionResponse?.() || Response.json({ token: TOKEN });
    }
    assert.equal(String(url), 'https://api.github.com/graphql');
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(body.variables, { id: ID });
    if (body.query.includes('mutation DeleteBlogComment')) {
      return state.mutationResponse?.() || Response.json({ data: { deleteDiscussionComment: { clientMutationId: null } } });
    }
    assert.ok(body.query.includes('viewerDidAuthor viewerCanDelete'));
    return state.queryResponse?.() || Response.json({ data: { node: state.comment } });
  });
  return { state, calls, mutations: () => calls.filter((call) => call.body.query?.includes('mutation DeleteBlogComment')) };
}

test('an existing giscus session deletes only the authenticated author\'s blog comment without exposing or storing credentials', async (t) => {
  const { request, sqlite } = setup(t);
  const { calls, mutations } = upstream(t);
  const response = await request(`/github-comments/${ID}`, 'DELETE', input());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { retained: false });
  assert.equal(calls.length, 3);
  assert.equal(mutations().length, 1);
  assert.deepEqual(mutations()[0].body.variables, { id: ID });
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM rate_limits').all()).includes(SESSION));
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM rate_limits').all()).includes(TOKEN));
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM comments').get().count, 0);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
});

test('deleting a parent with replies preserves its reply thread', async (t) => {
  const { request } = setup(t);
  upstream(t, { comment: permission({ replies: { totalCount: 2 } }) });
  assert.deepEqual(await (await request(`/github-comments/${ID}`, 'DELETE', input())).json(), { retained: true });
});

test('a successful deletion that uses the last rate-limit allowance still succeeds', async (t) => {
  const { request } = setup(t);
  upstream(t, { mutationResponse: () => Response.json({ data: { deleteDiscussionComment: { clientMutationId: null } } }, { headers: { 'x-ratelimit-remaining': '0' } }) });
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', input())).status, 200);
});

test('Korean post paths use the same encoded pathname hash as the giscus client', async (t) => {
  const { request } = setup(t);
  const post = '/posts/한글-글/';
  const term = new URL(post, 'https://blog.invalid').pathname.substring(1);
  const comment = permission();
  comment.discussion.title = term;
  comment.discussion.body = `<!-- sha1: ${createHash('sha1').update(term).digest('hex')} -->`;
  upstream(t, { comment });
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', { ...input(), post })).status, 200);
});

test('another author, a denied permission, another repo/category/post or a different object cannot be deleted', async (t) => {
  const { request } = setup(t);
  const { state, mutations } = upstream(t);
  const original = permission();
  for (const comment of [
    permission({ viewerDidAuthor: false }),
    permission({ viewerCanDelete: false }),
    permission({ __typename: 'IssueComment' }),
    permission({ id: 'DC_other_123' }),
    permission({ discussion: { ...original.discussion, repository: { nameWithOwner: 'someone/another-repo' } } }),
    permission({ discussion: { ...original.discussion, category: { name: 'Another category' } } }),
    permission({ discussion: { ...original.discussion, body: '<!-- sha1: different-post -->' } })
  ]) {
    state.comment = comment;
    const response = await request(`/github-comments/${ID}`, 'DELETE', { ...input(), author: 'minhye0714', viewerCanDelete: true });
    assert.equal(response.status, 403);
  }
  assert.equal(mutations().length, 0);
});

test('missing sessions, invalid IDs, invalid posts and cross-origin requests never reach GitHub', async (t) => {
  const { request } = setup(t);
  const { calls } = upstream(t);
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', { post: POST })).status, 401);
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', { ...input(), session: 'x'.repeat(4097) })).status, 401);
  assert.equal((await request('/github-comments/bad', 'DELETE', input())).status, 400);
  assert.equal((await request('/github-comments/%XX', 'DELETE', input())).status, 400);
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', { ...input(), post: '/' })).status, 400);
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', input(), { noOrigin: true })).status, 403);
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', input(), { headers: { Origin: 'https://example.org' } })).status, 403);
  assert.equal(calls.length, 0);
});

test('expired giscus sessions and revoked GitHub credentials request login instead of deleting', async (t) => {
  const { request } = setup(t);
  const { state, mutations } = upstream(t, { sessionResponse: () => Response.json({ error: `State has expired. ${TOKEN}` }, { status: 400 }) });
  const expired = await request(`/github-comments/${ID}`, 'DELETE', input());
  assert.equal(expired.status, 401);
  assert.ok(!(await expired.text()).includes(TOKEN));
  state.sessionResponse = null;
  state.queryResponse = () => Response.json({ message: 'Bad credentials' }, { status: 401 });
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', input())).status, 401);
  assert.equal(mutations().length, 0);
});

test('not-found comments and upstream failures do not produce a successful deletion', async (t) => {
  const { request } = setup(t);
  const { state, mutations } = upstream(t, { comment: null });
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', input())).status, 404);
  assert.equal(mutations().length, 0);
  state.queryResponse = () => Response.json({ data: { node: null }, errors: [{ type: 'NOT_FOUND' }] });
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', input())).status, 404);
  state.queryResponse = null;
  state.comment = permission();
  state.mutationResponse = () => Response.json({ data: { deleteDiscussionComment: null }, errors: [{ type: 'FORBIDDEN', message: TOKEN }] });
  const denied = await request(`/github-comments/${ID}`, 'DELETE', input());
  assert.equal(denied.status, 403);
  assert.ok(!(await denied.text()).includes(TOKEN));
  state.mutationResponse = () => Response.json({ data: { deleteDiscussionComment: null } });
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', input())).status, 503);
  state.queryResponse = () => Response.json({ message: 'rate limit' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', input())).status, 429);
});

test('delete attempts are rate limited before exchanging more sessions', async (t) => {
  const { request } = setup(t);
  const { calls } = upstream(t, { sessionResponse: () => Response.json({ error: 'expired' }, { status: 400 }) });
  for (let index = 0; index < 10; index++) {
    assert.equal((await request(`/github-comments/${ID}`, 'DELETE', input())).status, 401);
  }
  assert.equal((await request(`/github-comments/${ID}`, 'DELETE', input())).status, 429);
  assert.equal(calls.length, 10);
});
