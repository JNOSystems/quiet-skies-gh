# Custom Domain Setup - Completed

Status: completed. The approved custom public domain is live. No app behavior, logging workflow, privacy model, Supabase configuration, manifest behavior, or service-worker behavior was changed by this documentation update.

## Current Public URLs

- Primary public URL: `https://www.quietskiesgh.org`
- Apex redirect: `https://quietskiesgh.org` redirects to `https://www.quietskiesgh.org`
- Netlify fallback URL: `https://quiet-skies-gh.netlify.app`

## Domain Decision

Approved domain:

- `quietskiesgh.org`

Primary host:

- `www.quietskiesgh.org`

Previous candidate domains no longer selected for this setup:

- `granadahillsquietskies.org`
- Other pending candidate domains

## Repo Findings

- `QSGH_AGENT.md`
  - Updated to list the approved public site, apex redirect, and Netlify fallback.
- `README.md`
  - Updated with the approved public site and apex redirect note.
- `manifest.json`
  - Uses relative values only: `start_url: "/"` and `scope: "/"`.
  - No custom-domain code change was required.
- `sw.js`
  - Caches same-origin local paths only: `/`, `/manifest.json`, `/icon.svg`.
  - No custom-domain code change was required.
- `quiet_skies_granada_hills.html`
  - No canonical URL, Open Graph URL, Twitter URL, or hardcoded Netlify public URL was added.
  - Existing absolute URLs remain external service links and were not changed.

## Files Updated For Domain Documentation

- `QSGH_AGENT.md`
- `README.md`
- `docs/notes/custom_domain_preflight.md`

## Files Not Changed

- `quiet_skies_granada_hills.html`
- `manifest.json`
- `sw.js`
- Supabase SQL, grants, or schema files

## Netlify And DNS State

The approved custom domain is live outside Codex:

- `https://www.quietskiesgh.org`
- `https://quietskiesgh.org` redirects to the primary `www` domain.

Netlify and DNS remain external operational configuration. Do not add DNS assumptions, redirects, or domain-specific routing into app code unless explicitly approved later.

Reference docs:

- Netlify external DNS: https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/
- Netlify DNS records: https://docs.netlify.com/manage/domains/configure-domains/dns-records/

## Post-Change QA Checklist

- Confirm `https://www.quietskiesgh.org` resolves.
- Confirm `https://quietskiesgh.org` redirects to `https://www.quietskiesgh.org`.
- Confirm HTTPS is active for the primary public domain.
- Open the primary domain on mobile and desktop.
- Confirm the app loads without mixed-content warnings.
- Confirm manifest loads from the primary domain.
- Confirm `icon.svg` loads from the primary domain.
- Confirm `sw.js` loads from the primary domain.
- Confirm service worker does not cache any obsolete absolute public URL.
- Confirm dashboard labels remain:
  - `Last 24 Hrs`
  - `Last 7 Days`
  - `All Time`
- Confirm North, Central, and South zone selection still works.
- Confirm `I Heard a Plane` logging behavior is unchanged.
- Confirm the privacy copy remains visible.
- Confirm no name, email, address, login, precise location, aircraft ID, analytics, cookies, or tracking was added.
- Confirm official external links still open:
  - LAWA complaint link
  - VNY WebTrak link
  - AirNoise link
  - JNO Systems link
  - Quiet Skies Network link
  - GHNNC link

## Rollback Note

If the custom domain causes resolution, HTTPS, or routing problems:

1. In Netlify, set the primary domain back to `quiet-skies-gh.netlify.app`.
2. Remove or pause the custom-domain DNS records at the registrar/DNS provider.
3. Wait for DNS propagation.
4. Hard refresh browsers and clear service-worker state if needed.
5. Verify logging, dashboard labels, privacy copy, and official external links still work.
