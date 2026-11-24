// functions/sitemap-profiles.xml.js
// GET /sitemap-profiles.xml
//
// Lists every published profile at its indexable /p/<slug> URL, so search
// engines discover new identity pages without waiting for a backlink. Branch
// names live in the resumepro-builds repo, which is private-ish to us: only
// the "-profile" branches are exposed here, and only as public slugs.
//
// Cached for 30 minutes at the edge: a new publish shows up on the next crawl
// refresh, and the GitHub API is not hit on every sitemap request.

const OWNER = 'apdg21';
const REPO = 'resumepro-builds';
const PUBLIC_ORIGIN = 'https://resumepro.pages.dev';
const PROFILE_BRANCH_PATTERN = /^(.*)-profile(?:-(\d+))?$/;

function publicSlug(branch) {
  const match = PROFILE_BRANCH_PATTERN.exec(branch);
  if (!match) return null;
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}

export async function onRequestGet({ env }) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    return new Response('Server is missing GITHUB_TOKEN.', { status: 500 });
  }

  const branches = [];
  for (let page = 1; page <= 10; page++) {
    let res;
    try {
      res = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/branches?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'resumepro-sitemap',
          },
        }
      );
    } catch (_) {
      return new Response('Could not read published profiles.', { status: 502 });
    }
    if (!res.ok) {
      return new Response('Could not read published profiles.', { status: 502 });
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const entry of batch) {
      if (entry && typeof entry.name === 'string') branches.push(entry.name);
    }
    if (batch.length < 100) break;
  }

  const urls = branches
    .map(publicSlug)
    .filter(Boolean)
    .map((slug) => `  <url><loc>${PUBLIC_ORIGIN}/p/${slug}</loc></url>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
}
