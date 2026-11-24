// functions/p/[[path]].js
// GET /p/<slug> and /p/<slug>/<file>
//
// Public, indexable front door for profile sites. The published branch itself
// (https://<name>-profile.resumepro-builds.pages.dev) is served by Cloudflare
// with `x-robots-tag: noindex`, which keeps every build preview out of Google.
// This Function fetches the same page and strips that header, so the /p/ URL
// -- the canonical written at publish time -- is the one search engines index.
//
// Slug mapping (mirror of publish.js publicProfileSlug):
//   maya-reyes        -> maya-reyes-profile
//   maya-reyes-2      -> maya-reyes-profile-2
//
// Read-only: only GET/HEAD leave this endpoint, and only <slug>.resumepro-builds
// hosts are fetched, so it can't be used as an open proxy.

const SITE_HOST_SUFFIX = '.resumepro-builds.pages.dev';
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function branchForSlug(slug) {
  const numbered = /^(.*)-(\d+)$/.exec(slug);
  return numbered ? `${numbered[1]}-profile-${numbered[2]}` : `${slug}-profile`;
}

function htmlResponse(status, message) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${status}</title>`
    + `<meta name="robots" content="noindex"><p style="font:16px system-ui;padding:40px">${message}</p>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

export async function onRequest({ request, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const segments = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const slug = String(segments[0] || '').trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) {
    return htmlResponse(404, 'That profile link is not valid.');
  }

  const rest = segments.slice(1).map((part) => encodeURIComponent(part)).join('/');
  if (rest.split('/').includes('..')) {
    return htmlResponse(404, 'That profile link is not valid.');
  }

  const incoming = new URL(request.url);
  const target = new URL(`https://${branchForSlug(slug)}${SITE_HOST_SUFFIX}/${rest}`);
  target.search = incoming.search;

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      headers: { Accept: request.headers.get('Accept') || 'text/html' },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
  } catch (_) {
    return htmlResponse(502, 'We could not reach that profile just now. Try again in a minute.');
  }

  if (upstream.status === 404) {
    return htmlResponse(404, 'That profile does not exist yet.');
  }

  // A branch-host redirect must not send the browser to the noindex alias.
  if (upstream.status >= 300 && upstream.status < 400) {
    const headers = new Headers(upstream.headers);
    headers.delete('x-robots-tag');
    headers.delete('set-cookie');
    const location = headers.get('location');
    if (location && location.includes(SITE_HOST_SUFFIX)) {
      const redirected = new URL(location);
      const redirectBranch = redirected.hostname.slice(0, -SITE_HOST_SUFFIX.length);
      const match = /^(.*)-profile(?:-(\d+))?$/.exec(redirectBranch);
      const redirectSlug = match ? (match[2] ? `${match[1]}-${match[2]}` : match[1]) : redirectBranch;
      headers.set('location', `${incoming.origin}/p/${redirectSlug}${redirected.pathname}${redirected.search}`);
    }
    headers.set('Cache-Control', 'no-store');
    return new Response(null, { status: upstream.status, headers });
  }

  if (!upstream.ok) {
    return htmlResponse(502, 'We could not load that profile just now. Try again in a minute.');
  }

  const headers = new Headers(upstream.headers);
  headers.delete('x-robots-tag');
  headers.delete('set-cookie');
  // The branch alias response says noindex; this one is the indexable copy.
  headers.set('Cache-Control', 'public, max-age=300');

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}
