// functions/api/pair.js
// Manual fallback for the automatic site pairing done by /api/publish. The
// automatic path relies on a pair token (or the sibling's license key) still
// living in the same browser; this endpoint lets a customer link sites
// published on different devices by entering their addresses and license keys.
//
// Resume, portfolio and profile all pair with each other. Send at least two of
// the three; every pair is linked both ways.
//
// Same rules as the automatic path, by design:
//   - only OUR sites: a site id, a URL on *.resumepro-builds.pages.dev, or a
//     profile's public resumepro.pages.dev/p/<slug> URL. The server rebuilds
//     the URLs from the id, so a caller can never point a link at a foreign
//     site.
//   - same person: the site names must match (a middle initial added on only
//     one side is a different name).
//   - proven ownership: each branch's .resumepro-owner is an HMAC of the
//     license key that created it (PUBLISH_OWNER_SECRET). Every key must match
//     its branch before anything is written.
//
// The keys are used only for that HMAC -- this endpoint never publishes, so it
// does not re-verify them against Gumroad. Publishing still does.
//
// Success writes rpLinks + .resumepro-pair on EVERY branch (one commit each)
// and returns fresh pair tokens so the builders can remember the pairing.

const OWNER = 'apdg21';
const REPO = 'resumepro-builds';
const OWNER_FILE = '.resumepro-owner';
const PAIR_FILE = '.resumepro-pair';
const PORTFOLIO_BRANCH_SUFFIX = '-portfolio';
const PROFILE_BRANCH_SUFFIX = '-profile';
const MAX_SLUG_LENGTH = 30;
const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PORTFOLIO_ID_PATTERN = /-portfolio(?:-\d+)?$/;
const PROFILE_ID_PATTERN = /-profile(?:-\d+)?$/;
const SITE_SUFFIXES = { resume: '', portfolio: PORTFOLIO_BRANCH_SUFFIX, profile: PROFILE_BRANCH_SUFFIX };
const SITE_TYPES = ['resume', 'portfolio', 'profile'];
const SITE_HOST_SUFFIX = '.resumepro-builds.pages.dev';
const PUBLIC_PROFILE_ORIGIN = 'https://resumepro.pages.dev';
const siteUrl = (id) => `https://${id}${SITE_HOST_SUFFIX}`;

const ERROR_MESSAGES = {
  invalid_body: 'Send at least two site addresses and their license keys.',
  not_enough_sites: 'Enter at least two of your sites (resume, portfolio, profile).',
  missing_key: 'Enter the license key that was used for each site.',
  invalid_site:
    'That address is not one of our published sites. Paste the link we gave you when you published (or just the site name).',
  swapped_sites: 'The resume field contains a portfolio or profile address (or the other way around). Swap them and try again.',
  same_site: 'Two of the addresses are the same. Enter one of each site.',
  different_name:
    'The sites do not carry the same name. A middle initial or a different spelling on one side means they will not link.',
  site_missing: 'One of those sites does not exist (any more). Check the address.',
  site_unowned:
    'One of those sites was published before ownership was tracked. Publish it once more from the builder, then link again.',
  not_owner: 'One license key does not match the site it was entered for.',
  site_unreadable: 'We could not read one of the sites just now. Try again in a minute.',
  write_failed: 'The sites were checked, but updating the links failed. Try again in a minute.',
};

function error(code, status, detail) {
  return Response.json(
    { error: detail || ERROR_MESSAGES[code] || 'Could not link the sites.', code },
    { status }
  );
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function siteTypeOf(id) {
  if (PROFILE_ID_PATTERN.test(id)) return 'profile';
  if (PORTFOLIO_ID_PATTERN.test(id)) return 'portfolio';
  return 'resume';
}

function profilePublicUrl(id) {
  const match = /^(.*)-profile(?:-(\d+))?$/.exec(id);
  const slug = match ? (match[2] ? `${match[1]}-${match[2]}` : match[1]) : id;
  return `${PUBLIC_PROFILE_ORIGIN}/p/${slug}`;
}

function siteUrlFor(id) {
  return siteTypeOf(id) === 'profile' ? profilePublicUrl(id) : siteUrl(id);
}

// Accepts a bare id ("rosemarie-santos"), one of our branch URLs
// ("https://rosemarie-santos.resumepro-builds.pages.dev/", with or without a
// scheme), or -- for a profile -- its public resumepro.pages.dev/p/<slug> URL.
// Anything else, including another host that merely looks similar, is
// rejected, so the link can only ever point at our own deployment.
function parseSiteId(raw, wantType) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return null;

  let id = value;
  const wasBare = SITE_ID_PATTERN.test(value);
  if (!wasBare) {
    let url;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(value) ? value : `https://${value}`);
    } catch (_) {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname;
    if (host.endsWith(SITE_HOST_SUFFIX)) {
      id = host.slice(0, -SITE_HOST_SUFFIX.length);
    } else if (wantType === 'profile' && `https://${host}` === PUBLIC_PROFILE_ORIGIN) {
      // /p/<slug> -> <slug>-profile (mirror of publish.js publicProfileSlug).
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments[0] !== 'p' || !segments[1]) return null;
      const numbered = /^(.*)-(\d+)$/.exec(segments[1]);
      id = numbered ? `${numbered[1]}-profile-${numbered[2]}` : `${segments[1]}-profile`;
    } else {
      return null;
    }
  }
  if (wantType === 'profile' && wasBare && !PROFILE_ID_PATTERN.test(id) && !PORTFOLIO_ID_PATTERN.test(id)) {
    // The profile field also accepts its bare public slug ("maya-reyes").
    // A branch URL must already name a profile branch -- a resume or
    // portfolio address pasted here is a mistake, not a slug to suffix.
    id = `${id}-profile`;
  }
  if (!SITE_ID_PATTERN.test(id)) return null;
  if (siteTypeOf(id) !== wantType) return null;
  return id;
}

// Best-effort type hint for the "fields swapped" message only.
function looksType(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const hostAndPath = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/');
  const host = hostAndPath[0];
  if (host.endsWith(SITE_HOST_SUFFIX)) {
    return siteTypeOf(host.slice(0, -SITE_HOST_SUFFIX.length));
  }
  if (`https://${hostAndPath[0]}` === PUBLIC_PROFILE_ORIGIN && hostAndPath[1] === 'p') return 'profile';
  if (!host.includes('.') && SITE_ID_PATTERN.test(host)) return siteTypeOf(host);
  return null;
}

// Branch names lose their collision suffix ("-2") and the type suffix
// ("-portfolio"/"-profile"), leaving the person's name slug.
function personOf(id, type) {
  let person = id.replace(/-\d+$/, '');
  const suffix = SITE_SUFFIXES[type];
  if (suffix) person = person.replace(new RegExp(`${suffix}$`), '');
  return person.replace(/-+$/, '');
}

// Mirrors siblingMatchesPerson() in publish.js, comparing branch ids instead
// of an incoming form name: equal names, or one is a longer form of the other
// ("rosemarie-santos" / "rosemarie-santos-mendoza"), or both were truncated
// (suffix branches have less room for the name).
function namesMatch(a, b) {
  const aPerson = personOf(a.id, a.type);
  const bPerson = personOf(b.id, b.type);
  if (!aPerson || !bPerson) return false;

  if (aPerson === bPerson) return true;
  if (bPerson.startsWith(`${aPerson}-`)) return true;
  if (aPerson.startsWith(`${bPerson}-`)) return true;

  const aRoom = MAX_SLUG_LENGTH - SITE_SUFFIXES[a.type].length;
  const bRoom = MAX_SLUG_LENGTH - SITE_SUFFIXES[b.type].length;
  if (bPerson.length >= bRoom - 1 && aPerson.startsWith(bPerson)) return true;
  if (aPerson.length >= aRoom - 1 && bPerson.startsWith(aPerson)) return true;
  return false;
}

async function readBranchFile(gh, ref, path) {
  const res = await gh(`/contents/${path}?ref=${encodeURIComponent(ref)}`, {
    headers: { Accept: 'application/vnd.github.raw' },
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) return { error: `Could not read ${path}: ${await res.text()}` };
  return { text: await res.text() };
}

async function readBranchOwner(gh, branch) {
  const file = await readBranchFile(gh, branch, OWNER_FILE);
  if (file.missing || file.error) return file;
  return { token: file.text.trim() };
}

async function readBranchHead(gh, branch) {
  const res = await gh(`/git/ref/heads/${branch}`);
  if (res.status === 404) return { missing: true };
  if (!res.ok) return { error: `Could not read branch "${branch}": ${await res.text()}` };
  return { sha: (await res.json()).object.sha };
}

async function readPairIds(gh, ref) {
  const file = await readBranchFile(gh, ref, PAIR_FILE);
  if (!file.text) return [];
  try {
    const parsed = JSON.parse(file.text);
    const ids = Array.isArray(parsed.ids) ? parsed.ids : [parsed.id];
    return ids.filter((id) => typeof id === 'string' && SITE_ID_PATTERN.test(id));
  } catch (_) {
    return [];
  }
}

// One commit per branch: data.json gains rpLinks for every linked site
// (keeping the ones already there) and the pair marker records all sibling
// ids, so later publishes from any device keep the links without headers.
async function linkBranch(gh, { id, headSha, links, otherIds }) {
  const headRes = await gh(`/git/commits/${headSha}`);
  if (!headRes.ok) return { ok: false, reason: 'site_unreadable' };
  const head = await headRes.json();

  const raw = await readBranchFile(gh, headSha, 'data.json');
  if (!raw.text) return { ok: false, reason: 'site_unreadable' };
  let data;
  try {
    data = JSON.parse(raw.text);
  } catch (_) {
    return { ok: false, reason: 'site_unreadable' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'site_unreadable' };
  }

  const pairIds = await readPairIds(gh, headSha);
  const existingLinks =
    data.rpLinks && typeof data.rpLinks === 'object' && !Array.isArray(data.rpLinks) ? data.rpLinks : {};
  const linkChanged = Object.entries(links).some(([key, url]) => existingLinks[key] !== url);
  const idsMissing = otherIds.some((otherId) => !pairIds.includes(otherId));
  if (!linkChanged && !idsMissing) {
    return { ok: true, unchanged: true };
  }
  data.rpLinks = { ...existingLinks, ...links };
  const nextPairIds = [...new Set([...pairIds, ...otherIds])];

  const blob = async (content) => {
    const res = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content, encoding: 'utf-8' }) });
    return res.ok ? (await res.json()).sha : null;
  };
  const dataSha = await blob(JSON.stringify(data, null, 2));
  const pairSha = await blob(JSON.stringify(
    nextPairIds.length > 1 ? { id: nextPairIds[0], ids: nextPairIds } : { id: nextPairIds[0] }
  ));
  if (!dataSha || !pairSha) return { ok: false, reason: 'write_failed' };

  const treeRes = await gh('/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: head.tree.sha,
      tree: [
        { path: 'data.json', mode: '100644', type: 'blob', sha: dataSha },
        { path: PAIR_FILE, mode: '100644', type: 'blob', sha: pairSha },
      ],
    }),
  });
  if (!treeRes.ok) return { ok: false, reason: 'write_failed' };

  const commitRes = await gh('/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: `Link ${id} to ${otherIds.join(', ')}`,
      tree: (await treeRes.json()).sha,
      parents: [headSha],
    }),
  });
  if (!commitRes.ok) return { ok: false, reason: 'write_failed' };

  const refRes = await gh(`/git/refs/heads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: (await commitRes.json()).sha, force: false }),
  });
  if (!refRes.ok) return { ok: false, reason: 'write_failed' };
  return { ok: true };
}

export async function onRequestPost({ request, env }) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    return Response.json({ error: 'Server is missing GITHUB_TOKEN.' }, { status: 500 });
  }
  const ownerSecret = env.PUBLISH_OWNER_SECRET;
  if (!ownerSecret) {
    return Response.json({ error: 'Server is missing PUBLISH_OWNER_SECRET.' }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return error('invalid_body', 400);
  }
  if (!body || typeof body !== 'object') return error('invalid_body', 400);

  // At least two of resume / portfolio / profile; every filled field needs its
  // license key.
  const submitted = [];
  for (const type of SITE_TYPES) {
    const raw = body[type];
    const key = body[`${type}Key`];
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw !== 'string' || typeof key !== 'string') return error('invalid_body', 400);
    if (!raw.trim()) continue;
    if (!key.trim()) return error('missing_key', 400);
    submitted.push({ type, raw: raw.trim(), key: key.trim() });
  }
  if (submitted.length < 2) {
    return error(submitted.length === 0 ? 'invalid_body' : 'not_enough_sites', 400);
  }

  const sites = [];
  for (const site of submitted) {
    const id = parseSiteId(site.raw, site.type);
    if (!id) {
      const looksLike = looksType(site.raw);
      return error(looksLike && looksLike !== site.type ? 'swapped_sites' : 'invalid_site', 400);
    }
    sites.push({ type: site.type, id, key: site.key });
  }
  if (new Set(sites.map((site) => site.id)).size !== sites.length) {
    return error('same_site', 400);
  }
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      if (!namesMatch(sites[i], sites[j])) return error('different_name', 400);
    }
  }

  const gh = (path, opts = {}) =>
    fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'resumepro-publish', // GitHub rejects requests with no User-Agent
        ...opts.headers,
      },
    });

  try {
    const heads = await Promise.all(sites.map((site) => readBranchHead(gh, site.id)));
    if (heads.some((head) => head.missing)) return error('site_missing', 404);
    if (heads.some((head) => head.error)) return error('site_unreadable', 502);

    const owners = await Promise.all(sites.map((site) => readBranchOwner(gh, site.id)));
    if (owners.some((owner) => owner.error)) return error('site_unreadable', 502);
    if (owners.some((owner) => owner.missing)) return error('site_unowned', 403);

    const hashes = await Promise.all(sites.map((site) => hmacHex(ownerSecret, site.key)));
    if (owners.some((owner, i) => !sameToken(owner.token, hashes[i]))) {
      return error('not_owner', 403);
    }

    // One commit per branch, each carrying links to every other site.
    const results = new Map();
    for (let i = 0; i < sites.length; i++) {
      const self = sites[i];
      const links = {};
      const otherIds = [];
      for (let j = 0; j < sites.length; j++) {
        if (i === j) continue;
        links[sites[j].type] = siteUrlFor(sites[j].id);
        otherIds.push(sites[j].id);
      }
      // Sequential: a branch can only take one fast-forward commit at a time.
      results.set(self.id, await linkBranch(gh, { id: self.id, headSha: heads[i].sha, links, otherIds }));
    }

    const failed = sites.filter((site) => !results.get(site.id).ok);
    if (failed.length) {
      const partial = {};
      for (const site of sites) {
        const result = results.get(site.id);
        partial[site.type] = result.ok ? 'linked' : result.reason;
      }
      return Response.json(
        { error: ERROR_MESSAGES.write_failed, code: 'write_failed', partial },
        { status: 502 }
      );
    }

    const response = {
      ok: true,
      linked: true,
      updated: {},
      // Same tokens /api/publish hands out; lets the builders keep updating
      // the pairing automatically from this browser.
      tokens: {},
    };
    for (const site of sites) {
      response[site.type] = { id: site.id, url: siteUrlFor(site.id) };
      response.updated[site.type] = !results.get(site.id).unchanged;
      response.tokens[site.type] = await hmacHex(ownerSecret, `pair:${site.id}`);
    }
    return Response.json(response);
  } catch (err) {
    return Response.json({ error: err.message || 'Could not link the sites.' }, { status: 502 });
  }
}
