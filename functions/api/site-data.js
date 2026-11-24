// functions/api/site-data.js
// GET /api/site-data?id=<branch> (or ?url=<live link>)
//
// Returns the data.json of a published resume/portfolio site so the builder
// can pull it back into the editor ("Edit my existing site"). Reading is free
// -- no license key is checked here; publishing and downloading stay gated.
//
// The file is public on <branch>.resumepro-builds.pages.dev, but that host
// does not send CORS headers, so the browser can't fetch it directly. This
// endpoint reads it server-side and re-serves it same-origin.
//
// Strict on purpose: only ids/URLs on our own *.resumepro-builds.pages.dev
// host are accepted, so this can't be used as a generic proxy.

const SITE_HOST_SUFFIX = '.resumepro-builds.pages.dev';
const PUBLIC_HOST = 'resumepro.pages.dev';
const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PROFILE_ID_PATTERN = /-profile(?:-\d+)?$/;
const PORTFOLIO_ID_PATTERN = /-portfolio(?:-\d+)?$/;

function error(code, message, status) {
  return Response.json(
    { error: message, code },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

// Public profile links are /p/<slug>; the branch behind one carries the
// "-profile" suffix (mirrors functions/api/publish.js).
function profileBranchFromSlug(slug) {
  const numbered = /^(.*)-(\d+)$/.exec(slug);
  return numbered ? `${numbered[1]}-profile-${numbered[2]}` : `${slug}-profile`;
}

// Accepts a bare id ("sofia-reyes"), one of our URLs, or a public profile
// link ("https://resumepro.pages.dev/p/maya-reyes"), with or without a
// scheme. Same rule as functions/api/pair.js.
function parseSiteId(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return null;

  const publicMatch = new RegExp(
    `^(?:https?:\\/\\/)?(?:www\\.)?${PUBLIC_HOST.replace(/\./g, '\\.')}`
    + '\\/p\\/([a-z0-9][a-z0-9-]{0,62})(?:[/?#]|$)'
  ).exec(value);
  if (publicMatch) return profileBranchFromSlug(publicMatch[1]);
  if (value.startsWith('p/')) {
    const bare = value.split('/')[1] || '';
    return SITE_ID_PATTERN.test(bare) ? profileBranchFromSlug(bare) : null;
  }

  let id = value.split('/')[0];
  if (!SITE_ID_PATTERN.test(id)) {
    let host;
    try {
      host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(value) ? value : `https://${value}`).hostname;
    } catch (_) {
      return null;
    }
    if (host === SITE_HOST_SUFFIX.slice(1) || !host.endsWith(SITE_HOST_SUFFIX)) return null;
    id = host.slice(0, -SITE_HOST_SUFFIX.length);
  }
  return SITE_ID_PATTERN.test(id) ? id : null;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const id = parseSiteId(url.searchParams.get('id') || url.searchParams.get('url'));
  if (!id) {
    return error(
      'invalid_site',
      'That address is not one of our published sites. Paste the link we gave you when you published (or just the site name).',
      400
    );
  }

  const siteOrigin = `https://${id}${SITE_HOST_SUFFIX}`;
  let res;
  try {
    // Cache-buster: Cloudflare Pages may cache data.json at the edge, and the
    // point of this request is to see the latest publish.
    res = await fetch(`${siteOrigin}/data.json?t=${Date.now()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'resumepro-site-data' },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
  } catch (_) {
    return error('site_unreadable', 'We could not reach that site just now. Try again in a minute.', 502);
  }

  if (res.status === 404) {
    return error(
      'site_missing',
      'That site has no saved details yet. If you just published it, wait a few seconds and try again.',
      404
    );
  }
  if (!res.ok) {
    return error('site_unreadable', 'We could not read that site just now. Try again in a minute.', 502);
  }

  let data;
  try {
    data = JSON.parse(await res.text());
  } catch (_) {
    return error('site_unreadable', 'That site’s saved details could not be read. Try again in a minute.', 502);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return error('site_unreadable', 'That site’s saved details could not be read. Try again in a minute.', 502);
  }

  return Response.json(
    {
      id,
      url: siteOrigin,
      kind: PROFILE_ID_PATTERN.test(id) ? 'profile'
        : PORTFOLIO_ID_PATTERN.test(id) ? 'portfolio'
        : 'resume',
      data,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
