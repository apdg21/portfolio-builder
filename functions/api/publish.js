// functions/api/publish.js
// Publishes a generated resume site to a GitHub branch on the dedicated
// "resumepro-builds" repo. That repo has its own connected Cloudflare Pages
// project with preview deployments enabled for all branches, so pushing to
// (or updating) a personal name branch automatically builds and deploys it
// to https://<your-name>.resumepro-builds.pages.dev — no separate hosting
// API call needed beyond the GitHub API itself.
//
// Requires one secret on THIS Pages project (the one running functions/api/):
//   GITHUB_TOKEN — a fine-grained personal access token scoped to ONLY the
//   resumepro-builds repo, with Contents: Read and write permission.
//
// Re-publishing: the frontend sends the previously-returned resume_id back
// in the X-Resume-Id header, so the SAME branch gets force-updated with a
// new commit instead of a new branch (and therefore a new URL) being
// created every time.
//
// Publishing is a paid action, so the license key + template travel in the
// X-License-Key / X-License-Template headers and are verified here -- the
// client-side requireLicense() gate alone can be bypassed by POSTing here
// directly.
//
// Branch ownership: the first publish writes .resumepro-owner into the branch
// holding an HMAC of the license key (PUBLISH_OWNER_SECRET), and later updates
// must present a key that hashes to the same value. Without it, any valid key
// could force-update any existing branch by copying its public name into
// data.json. Requires one more secret:
//   PUBLISH_OWNER_SECRET — any long random string. Changing it orphans every
//   existing site (they can no longer be updated) and invalidates every
//   resume/portfolio pair token.
//
// Site pairing: every successful publish returns a pair_token (an HMAC of the
// branch name). When the same person later publishes another kind of site, the
// builder sends X-Sibling-Id plus that token (or, as a fallback, X-Sibling-Key:
// the license key that created the sibling). Resume, portfolio and profile all
// pair with each other. Once proven, this site's data.json gets rpLinks
// pointing at the sibling(s) and each sibling branch gets one extra commit
// linking back. rpLinks is always server-written, so a client can't point a
// site at someone else's.
//
// Profile sites: the client sends X-Site-Type: profile. Their branches carry a
// "-profile" suffix, and this endpoint adds the indexable SEO head (canonical,
// og:url, ProfilePage JSON-LD with the live URL) that the browser could not
// know before the branch name existed. The branch alias itself is served with
// x-robots-tag: noindex by Cloudflare; the canonical points at the
// resumepro.pages.dev/p/<slug> proxy, which is the URL that gets indexed.

import { verifyLicense } from './_license.js';

const OWNER = 'apdg21';
const REPO = 'resumepro-builds';
const BASE_BRANCH = 'main';
const OWNER_FILE = '.resumepro-owner';
const PAIR_FILE = '.resumepro-pair';
// Site types share this repo, so their branches carry a suffix -- the same
// person can own a resume, a portfolio and a profile side by side, and each
// one can be updated without touching the others.
const PORTFOLIO_BRANCH_SUFFIX = '-portfolio';
const PROFILE_BRANCH_SUFFIX = '-profile';
// Where the indexable profile pages live. /p/<slug> is a Pages Function that
// proxies the branch and strips its noindex header (functions/p/[[path]].js).
const PUBLIC_SITE_ORIGIN = 'https://resumepro.pages.dev';
const MAX_SLUG_LENGTH = 30;
const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PORTFOLIO_ID_PATTERN = /-portfolio(?:-\d+)?$/;
const PROFILE_ID_PATTERN = /-profile(?:-\d+)?$/;
const SITE_SUFFIXES = { resume: '', portfolio: PORTFOLIO_BRANCH_SUFFIX, profile: PROFILE_BRANCH_SUFFIX };

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Must stay a bare HMAC of the key: every existing .resumepro-owner holds this.
const ownerToken = (secret, licenseKey) => hmacHex(secret, licenseKey);
const pairToken = (secret, branch) => hmacHex(secret, `pair:${branch}`);

function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const siteUrl = (branch) => `https://${branch}.${REPO}.pages.dev`;

// maya-reyes-profile -> maya-reyes, maya-reyes-profile-2 -> maya-reyes-2.
// Kept in sync with functions/p/[[path]].js, which reverses the mapping.
export function publicProfileSlug(branch) {
  const match = /^(.*)-profile(?:-(\d+))?$/.exec(branch);
  if (!match) return branch;
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}

export const profilePublicUrl = (branch) => `${PUBLIC_SITE_ORIGIN}/p/${publicProfileSlug(branch)}`;

const escapeAttr = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The browser can bake everything about a profile except its final URL, so
// this adds/updates only the URL-dependent tags: base, canonical, og:url, and
// the sameAs/url fields inside the ProfilePage JSON-LD already in the head.
// The base matters because the public URL has no trailing slash
// (/p/maya-reyes), so "style.css" would otherwise resolve to /p/style.css.
export function injectProfileCanonical(html, publicUrl) {
  if (typeof html !== 'string' || !/<\/head>/i.test(html)) return html;
  let out = html
    .replace(/<base\s[^>]*>\s*/gi, '')
    .replace(/<link rel="canonical"[^>]*>\s*/gi, '')
    .replace(/<meta property="og:url"[^>]*>\s*/gi, '');

  out = out.replace(
    /<script type="application\/ld\+json" id="rp-google-schema">([\s\S]*?)<\/script>/i,
    (whole, json) => {
      try {
        const obj = JSON.parse(json);
        obj.url = publicUrl;
        if (obj['@id']) obj['@id'] = publicUrl;
        if (obj.mainEntity && typeof obj.mainEntity === 'object') obj.mainEntity.url = publicUrl;
        return `<script type="application/ld+json" id="rp-google-schema">\n${JSON.stringify(obj, null, 2)}\n</script>`;
      } catch (_) {
        return whole;
      }
    }
  );

  const tags = `<base href="${escapeAttr(publicUrl)}/" />\n`
    + `<link rel="canonical" href="${escapeAttr(publicUrl)}" />\n`
    + `<meta property="og:url" content="${escapeAttr(publicUrl)}" />`;
  return out.replace(/<\/head>/i, `${tags}\n</head>`);
}

async function readBranchFile(gh, ref, path) {
  const res = await gh(`/contents/${path}?ref=${encodeURIComponent(ref)}`, {
    headers: { Accept: 'application/vnd.github.raw' },
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) return { error: `Could not read ${path}: ${await res.text()}` };
  return { text: await res.text() };
}

// A missing marker means the branch predates ownership tracking: let this
// caller claim it (the marker is written on this same publish) rather than
// locking every existing customer out of their own site.
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

function sanitizeSlug(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9]+/g, '-')                      // replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '');                         // strip leading/trailing hyphens
}

// Pairing is automatic, so two sites built for different people on one browser
// must not cross-link: the sibling has to be a different site type and carry
// this person's name. Resume, portfolio and profile all pair with each other,
// never with another site of their own type.
// Branch names are truncated, so a sibling cut mid-word still matches as a
// prefix ("christopher-alexande-portfolio" pairs with the resume
// "christopher-alexander-montgom").
function siteTypeOf(id) {
  if (PROFILE_ID_PATTERN.test(id)) return 'profile';
  if (PORTFOLIO_ID_PATTERN.test(id)) return 'portfolio';
  return 'resume';
}

// Profiles are served at their indexable /p/<slug> URL; the other types at
// their branch host.
function siteUrlFor(id) {
  return siteTypeOf(id) === 'profile' ? profilePublicUrl(id) : siteUrl(id);
}

function siblingMatchesPerson(siblingId, fullSlug, selfType) {
  if (!fullSlug) return false;
  const siblingType = siteTypeOf(siblingId);
  if (siblingType === selfType) return false;
  const suffix = SITE_SUFFIXES[siblingType];
  let person = siblingId.replace(/-\d+$/, '');
  if (suffix) person = person.slice(0, -suffix.length);
  person = person.replace(/-+$/, '');
  if (!person) return false;
  if (fullSlug === person || fullSlug.startsWith(`${person}-`)) return true;
  const truncatedAt = MAX_SLUG_LENGTH - suffix.length - 1;
  return person.length >= truncatedAt && fullSlug.startsWith(person);
}

async function resolveSibling({ gh, ownerSecret, request, branchName, fullSlug, selfType }) {
  const siblingId = (request.headers.get('X-Sibling-Id') || '').trim().toLowerCase();
  if (!siblingId) return null;
  if (!SITE_ID_PATTERN.test(siblingId) || siblingId === branchName) {
    return { ok: false, reason: 'invalid_sibling' };
  }
  if (!siblingMatchesPerson(siblingId, fullSlug, selfType)) {
    return { ok: false, reason: 'different_name' };
  }

  const token = (request.headers.get('X-Sibling-Token') || '').trim();
  let proven = !!token && sameToken(token, await pairToken(ownerSecret, siblingId));
  if (!proven) {
    const siblingKey = (request.headers.get('X-Sibling-Key') || '').trim();
    if (siblingKey) {
      const owner = await readBranchOwner(gh, siblingId);
      if (owner.error) return { ok: false, reason: 'sibling_unreadable' };
      proven = !owner.missing && sameToken(owner.token, await ownerToken(ownerSecret, siblingKey));
    }
  }
  if (!proven) return { ok: false, reason: 'not_owner' };

  const head = await readBranchHead(gh, siblingId);
  if (head.missing) return { ok: false, reason: 'sibling_missing' };
  if (head.error) return { ok: false, reason: 'sibling_unreadable' };
  return { ok: true, id: siblingId, headSha: head.sha, type: siteTypeOf(siblingId) };
}

// The pair marker records every site this branch links to. Older markers hold
// a single { id }; new ones also carry { ids }, so a person with a resume, a
// portfolio and a profile keeps all three attached.
function pairMarker(ids) {
  const unique = [...new Set(ids)];
  return JSON.stringify(unique.length > 1 ? { id: unique[0], ids: unique } : { id: unique[0] });
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

function dedupeSiblings(siblings, selfType) {
  const seen = new Set();
  const out = [];
  for (const sibling of siblings) {
    if (!sibling || sibling.type === selfType || seen.has(sibling.type)) continue;
    seen.add(sibling.type);
    out.push(sibling);
  }
  return out;
}

// A proven sibling may already be linked to the person's third site. Pull that
// site in too, so publishing any one of the three reconnects the whole set.
async function addRelatedSiblings(gh, siblings, selfType, branchName) {
  const known = new Map(siblings.map((sibling) => [sibling.id, sibling]));
  const queue = [...siblings];
  while (queue.length) {
    const sibling = queue.shift();
    for (const id of await readPairIds(gh, sibling.headSha)) {
      if (id === branchName || known.has(id)) continue;
      const type = siteTypeOf(id);
      if (type === selfType) continue;
      const head = await readBranchHead(gh, id);
      if (!head.sha) continue;
      const entry = { id, headSha: head.sha, type };
      known.set(id, entry);
      queue.push(entry);
    }
  }
  return dedupeSiblings([...known.values()], selfType);
}

// An update without sibling headers keeps the pairing this branch already had.
async function readKeptSiblings(gh, ref, branchName, selfType) {
  const out = [];
  for (const id of await readPairIds(gh, ref)) {
    if (id === branchName) continue;
    const head = await readBranchHead(gh, id);
    if (!head.sha) continue;
    out.push({ id, headSha: head.sha, type: siteTypeOf(id), kept: true });
  }
  return out;
}

// One commit on the sibling branch: its data.json gains the link back to this
// site without dropping links it already has, and its pair marker records this
// branch, so the sibling's own next re-publish keeps the link even without
// sibling headers.
async function backfillSibling(gh, sibling, selfId, selfType) {
  const raw = await readBranchFile(gh, sibling.headSha, 'data.json');
  if (!raw.text) return { ok: false, reason: 'sibling_data_unreadable' };
  let data;
  try {
    data = JSON.parse(raw.text);
  } catch (_) {
    return { ok: false, reason: 'sibling_data_unreadable' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'sibling_data_unreadable' };
  }

  const selfUrl = siteUrlFor(selfId);
  const pairIds = await readPairIds(gh, sibling.headSha);
  const existingLinks =
    data.rpLinks && typeof data.rpLinks === 'object' && !Array.isArray(data.rpLinks) ? data.rpLinks : {};
  if (existingLinks[selfType] === selfUrl && pairIds.includes(selfId)) {
    return { ok: true, unchanged: true };
  }
  data.rpLinks = { ...existingLinks, [selfType]: selfUrl };

  const blob = async (content) => {
    const res = await gh(`/git/blobs`, { method: 'POST', body: JSON.stringify({ content, encoding: 'utf-8' }) });
    return res.ok ? (await res.json()).sha : null;
  };
  const dataSha = await blob(JSON.stringify(data, null, 2));
  const pairSha = await blob(pairMarker([...pairIds, selfId]));
  if (!dataSha || !pairSha) return { ok: false, reason: 'sibling_write_failed' };

  const headCommitRes = await gh(`/git/commits/${sibling.headSha}`);
  if (!headCommitRes.ok) return { ok: false, reason: 'sibling_write_failed' };
  const headCommit = await headCommitRes.json();

  const treeRes = await gh(`/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: headCommit.tree.sha,
      tree: [
        { path: 'data.json', mode: '100644', type: 'blob', sha: dataSha },
        { path: PAIR_FILE, mode: '100644', type: 'blob', sha: pairSha },
      ],
    }),
  });
  if (!treeRes.ok) return { ok: false, reason: 'sibling_write_failed' };

  const commitRes = await gh(`/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `Link ${sibling.id} to ${selfId}`,
      tree: (await treeRes.json()).sha,
      parents: [sibling.headSha],
    }),
  });
  if (!commitRes.ok) return { ok: false, reason: 'sibling_write_failed' };

  // Not forced: if the sibling was re-published a moment ago, keep that
  // publish rather than rolling it back to the head read above.
  const refRes = await gh(`/git/refs/heads/${sibling.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: (await commitRes.json()).sha, force: false }),
  });
  if (!refRes.ok) return { ok: false, reason: 'sibling_write_failed' };
  return { ok: true };
}

// Every template's data.json keeps the person's name somewhere different:
// name (style1..10, 12, 13, 15..17), profile.name (style14, style20),
// header (style19), hero.title (style18), or personalInfo.firstName +
// lastName (style11, 21, 22). Pick the first non-empty string instead of
// assuming one shape, otherwise those templates all collapse to the
// "resume" fallback URL.
function extractNameFromData(data) {
  if (!data || typeof data !== 'object') return '';

  const personName = (person) => {
    if (!person || typeof person !== 'object') return '';
    if (typeof person.name === 'string' && person.name.trim()) return person.name.trim();
    const first = typeof person.firstName === 'string' ? person.firstName.trim() : '';
    const last = typeof person.lastName === 'string' ? person.lastName.trim() : '';
    return [first, last].filter(Boolean).join(' ');
  };

  const candidates = [
    data.name,
    data.fullName,
    data.header,
    data.logo,
    data.siteName,
    data.siteDetails && data.siteDetails.logo,
    data.basicInfo && data.basicInfo.logo,
    data.profile && data.profile.name,
    data.hero && data.hero.name,
    data.hero && data.hero.title,
    personName(data.personalInfo),
    personName(data.personal),
    personName(data.basics),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  const title = typeof data.htmlTitle === 'string' ? data.htmlTitle
    : typeof data.pageTitle === 'string' ? data.pageTitle
    : '';
  return title ? title.split(/[—–|-]/)[0].trim() : '';
}

export async function onRequestPost({ request, env }) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    return Response.json({ error: 'Server is missing GITHUB_TOKEN.' }, { status: 500 });
  }

  const licenseKey = (request.headers.get('X-License-Key') || '').trim();
  const licenseTemplate = request.headers.get('X-License-Template') || '';
  const siteType = (request.headers.get('X-Site-Type') || '').trim().toLowerCase();
  const isProfile = siteType === 'profile' || /^profile\//i.test(licenseTemplate);
  const isPortfolio =
    siteType === 'portfolio' ||
    /^portfolio\//i.test(licenseTemplate);

  const license = await verifyLicense(env, licenseKey, licenseTemplate);
  if (!license.ok) {
    const serverError = license.status === 500;
    return Response.json(
      {
        error: license.reason || 'A valid license key is required to publish.',
        code: serverError ? 'license_server_error' : 'license_invalid',
      },
      { status: serverError ? 500 : 403 }
    );
  }

  const ownerSecret = env.PUBLISH_OWNER_SECRET;
  if (!ownerSecret) {
    return Response.json({ error: 'Server is missing PUBLISH_OWNER_SECRET.' }, { status: 500 });
  }
  const ownerHash = await ownerToken(ownerSecret, licenseKey);

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
    // files: { "index.html": { content, encoding }, "data.json": { content, encoding }, ... }
    const files = await request.json();
    if (!files || Object.keys(files).length === 0) {
      return Response.json({ error: 'No files received.' }, { status: 400 });
    }

    let data = null;
    if (files['data.json'] && typeof files['data.json'].content === 'string') {
      try {
        data = JSON.parse(files['data.json'].content);
      } catch (_) {}
    }

    // Determine clean personal branch name with collision protection
    const incomingId = request.headers.get('X-Resume-Id');
    let branchName = incomingId;

    // --- AUTOMATIC MIGRATION FOR OLD RANDOM IDS ---
    // If incoming ID is an old random string (e.g. "5f4ef677", "resume-5f4ef677", or 8-char hex),
    // automatically migrate them to their clean, real name slug!
    const isOldHexFormat = incomingId && (
      incomingId.startsWith('resume-') ||
      /^[a-f0-9]{8}$/i.test(incomingId)
    );
    if (isOldHexFormat) {
      branchName = null; // Forces creation of the clean personal name URL
    }

    // 1. Name slug from header or data.json, sanitized for DNS and Git branch
    //    compatibility. The untruncated form is kept for pairing.
    const rawName = request.headers.get('X-Resume-Slug') || extractNameFromData(data);
    const fullSlug = rawName ? sanitizeSlug(rawName) : '';
    const siteSuffix = isProfile
      ? PROFILE_BRANCH_SUFFIX
      : isPortfolio ? PORTFOLIO_BRANCH_SUFFIX : '';
    // Limit length so the auto-increment (and site-type) suffix fits.
    const slugRoom = MAX_SLUG_LENGTH - siteSuffix.length;
    const slug = fullSlug.slice(0, slugRoom).replace(/-+$/, '');
    const branchSlug = slug ? slug + siteSuffix : '';

    // 2. If candidate name changed completely (e.g. user previously published "john-doe"
    //    but now creates for "jane-smith"), treat as new site instead of overwriting!
    if (branchName && branchSlug) {
      const matchesName = branchName === branchSlug || branchName.startsWith(`${branchSlug}-`);
      if (!matchesName) {
        branchName = null;
      }
    }

    // 3. If creating a new site (not updating an existing branch), check collisions & auto-increment:
    //    john-doe -> john-doe-2 -> john-doe-3 (protecting existing resumes from overwrite)
    if (!branchName) {
      const baseSlug = branchSlug || (isProfile ? 'profile' : isPortfolio ? 'portfolio' : 'resume');
      let candidate = baseSlug;
      let counter = 1;
      let foundAvailable = false;

      while (!foundAvailable && counter <= 50) {
        const checkRes = await gh(`/git/ref/heads/${candidate}`);
        if (checkRes.status === 404) {
          foundAvailable = true;
          branchName = candidate;
        } else if (checkRes.ok) {
          // Branch already taken by previous resume/user, try next number
          counter++;
          candidate = `${baseSlug}-${counter}`;
        } else {
          // Break on unexpected API status (e.g. rate limit)
          break;
        }
      }

      // Safe fallback if loop encountered an issue
      if (!branchName) {
        branchName = `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`;
      }
    }

    const resumeId = branchName;

    // 4. Only the owner may update an existing branch -- checked before any
    //    upload, so a forbidden publish writes nothing.
    const existing = await readBranchHead(gh, branchName);
    if (existing.error) {
      return Response.json({ error: existing.error }, { status: 502 });
    }
    const branchExists = !existing.missing;
    if (branchExists) {
      const owner = await readBranchOwner(gh, branchName);
      if (owner.error) {
        return Response.json({ error: owner.error }, { status: 502 });
      }
      if (!owner.missing && !sameToken(owner.token, ownerHash)) {
        return Response.json(
          {
            error: 'This published site belongs to a different license key. Publish under a different name in your details, or use the key that created it.',
            code: 'branch_forbidden',
          },
          { status: 403 }
        );
      }
    }

    // 5. Site links. Resume, portfolio and profile pair with each other (never
    //    with their own type). A proven sibling from the headers wins;
    //    otherwise an update keeps the pairing this branch already had. The
    //    sibling's own links are pulled in too, so publishing any one of the
    //    three reconnects the whole set.
    const selfType = isProfile ? 'profile' : isPortfolio ? 'portfolio' : 'resume';
    const requested = await resolveSibling({
      gh, ownerSecret, request, branchName, fullSlug, selfType,
    });
    let siblings = requested && requested.ok ? [requested] : [];
    if (branchExists) {
      const known = new Set(siblings.map((sibling) => sibling.id));
      for (const sibling of await readKeptSiblings(gh, existing.sha, branchName, selfType)) {
        if (known.has(sibling.id)) continue;
        siblings.push(sibling);
        known.add(sibling.id);
      }
    }
    siblings = await addRelatedSiblings(gh, siblings, selfType, branchName);

    if (data && typeof data === 'object' && !Array.isArray(data)) {
      delete data.rpLinks;
      const links = {};
      for (const sibling of siblings) links[sibling.type] = siteUrlFor(sibling.id);
      if (Object.keys(links).length) data.rpLinks = links;
      files['data.json'] = { content: JSON.stringify(data, null, 2), encoding: 'utf-8' };
    }

    // 5b. Profiles: now that the branch name exists, the public URL does too.
    //     Add the tags that depend on it (canonical, og:url, JSON-LD url).
    if (isProfile && files['index.html'] && typeof files['index.html'].content === 'string') {
      files['index.html'].content = injectProfileCanonical(
        files['index.html'].content,
        profilePublicUrl(branchName)
      );
    }

    // 6. Get the base branch's latest commit + tree, to branch/build from
    const baseRefRes = await gh(`/git/ref/heads/${BASE_BRANCH}`);
    if (!baseRefRes.ok) {
      return Response.json(
        { error: `Could not read base branch "${BASE_BRANCH}": ${await baseRefRes.text()}` },
        { status: 502 }
      );
    }
    const baseRef = await baseRefRes.json();
    const baseCommit = await (await gh(`/git/commits/${baseRef.object.sha}`)).json();

    // 7. Create a blob for each file
    const treeItems = [];
    const addBlob = async (filePath, content, encoding) => {
      const blobRes = await gh(`/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content, encoding }),
      });
      if (!blobRes.ok) {
        throw Object.assign(new Error(`Failed to upload ${filePath}: ${await blobRes.text()}`), { status: 502 });
      }
      treeItems.push({ path: filePath, mode: '100644', type: 'blob', sha: (await blobRes.json()).sha });
    };

    for (const [filePath, file] of Object.entries(files)) {
      // Ownership and pairing markers are server-written only -- never let a
      // caller supply their own.
      if (filePath === OWNER_FILE || filePath === PAIR_FILE) continue;
      await addBlob(filePath, file.content, file.encoding === 'base64' ? 'base64' : 'utf-8');
    }
    await addBlob(OWNER_FILE, ownerHash, 'utf-8');
    if (siblings.length) await addBlob(PAIR_FILE, pairMarker(siblings.map((sibling) => sibling.id)), 'utf-8');

    // 8. Create a new tree based on the base tree (so nothing outside these
    //    files gets touched, but anything already on main that ISN'T
    //    overwritten here would still be inherited — keep main minimal)
    const treeRes = await gh(`/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeItems }),
    });
    const tree = await treeRes.json();

    // 9. Create a commit
    const commitRes = await gh(`/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: `Publish ${branchName}`,
        tree: tree.sha,
        parents: [baseCommit.sha],
      }),
    });
    const commit = await commitRes.json();

    // 10. Create the branch (first publish) or force-update it (re-publish)
    if (!branchExists) {
      const createRefRes = await gh(`/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commit.sha }),
      });
      if (!createRefRes.ok) {
        return Response.json({ error: `Failed to create branch: ${await createRefRes.text()}` }, { status: 502 });
      }
    } else {
      const updateRefRes = await gh(`/git/refs/heads/${branchName}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: true }),
      });
      if (!updateRefRes.ok) {
        return Response.json({ error: `Failed to update branch: ${await updateRefRes.text()}` }, { status: 502 });
      }
    }

    // 11. Link back from every sibling. This site is already live, so a
    //     failure here is reported rather than failing the publish.
    let linked = null;
    if (siblings.length) {
      const primary = siblings[0];
      linked = { id: primary.id, type: primary.type, url: siteUrlFor(primary.id), backlinked: true };
      const failures = [];
      for (const sibling of siblings) {
        const back = await backfillSibling(gh, sibling, branchName, selfType);
        if (back.ok) continue;
        if (sibling.id === primary.id) linked.backlinked = false;
        failures.push({ id: sibling.id, reason: back.reason });
      }
      if (failures.length) linked.failed = failures;
      if (siblings.length > 1) {
        linked.sites = siblings.map((sibling) => ({
          id: sibling.id,
          type: sibling.type,
          url: siteUrlFor(sibling.id),
        }));
      }
    }

    const branchUrl = siteUrl(branchName);
    return Response.json({
      // Profiles get the indexable /p/<slug> URL; the branch alias carries
      // x-robots-tag: noindex, so it is only a fallback.
      url: isProfile ? profilePublicUrl(branchName) : branchUrl,
      branch_url: branchUrl,
      resume_id: resumeId,
      pair_token: await pairToken(ownerSecret, branchName),
      linked,
      ...(requested && !requested.ok && !linked ? { link_skipped: requested.reason } : {}),
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
