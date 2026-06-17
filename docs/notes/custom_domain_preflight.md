# Custom Domain Preflight - Pending Custom Domain

Status: pending final custom domain approval. No domain purchase, Netlify configuration, DNS change, deploy, app behavior change, or service-worker change has been made.

## Current Public URL

- Netlify URL: `https://quiet-skies-gh.netlify.app`

## Candidate Domains

Pending approval:

- `quietskiesgh.org`
- `granadahillsquietskies.org`
- Another approved domain selected by the project owner

## Repo Findings

- `QSGH_AGENT.md`
  - Contains the current Netlify site reference: `quiet-skies-gh.netlify.app`
  - Safe to update only after the final domain is approved, so the operating manual does not point to a speculative domain.
- `manifest.json`
  - Uses relative values only: `start_url: "/"` and `scope: "/"`
  - No custom-domain change is needed before domain selection.
- `sw.js`
  - Caches same-origin local paths only: `/`, `/manifest.json`, `/icon.svg`
  - No custom-domain change is needed before domain selection.
- `quiet_skies_granada_hills.html`
  - No canonical URL, Open Graph URL, Twitter URL, or hardcoded Netlify public URL was found.
  - Existing absolute URLs are external service links and should not be changed as part of the custom-domain move.
- `README.md`
  - No current public URL was found.

## Files That May Need Updates After Final Domain Selection

- `QSGH_AGENT.md`
  - Update the Netlify site reference if the custom domain becomes the primary public URL.
- `README.md`
  - Optional: add the approved public URL for operator reference.
- `quiet_skies_granada_hills.html`
  - Optional only if social sharing metadata is later added, such as canonical URL, `og:url`, or `twitter:url`.
- `manifest.json`
  - No change expected if the app remains hosted at the domain root.
  - Revisit only if the app moves under a path such as `/quiet-skies/`.
- `sw.js`
  - No change expected because it caches same-origin paths only.
  - Revisit only if future cache entries include absolute public URLs.

## Netlify Dashboard Steps Outside Codex

1. Select and acquire the approved domain outside Codex.
2. In Netlify, open the Quiet Skies Granada Hills site.
3. Go to Domain management / Production domains.
4. Add the approved custom domain.
5. Set the intended primary domain.
6. Let Netlify provision HTTPS for the new domain.
7. Keep `quiet-skies-gh.netlify.app` available as the Netlify fallback unless there is a reason to change that default behavior.

Reference docs:

- Netlify external DNS: https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/
- Netlify DNS records: https://docs.netlify.com/manage/domains/configure-domains/dns-records/

## DNS Records Likely Needed

Use Netlify's domain-specific instructions after adding the domain in the dashboard.

For external DNS, likely records are:

- `www` subdomain:
  - Type: `CNAME`
  - Name/host: `www`
  - Target: `quiet-skies-gh.netlify.app`
- Apex/root domain:
  - Preferred if supported by DNS provider: `ALIAS`, `ANAME`, or flattened `CNAME`
  - Name/host: `@` or blank, depending on provider
  - Target: `apex-loadbalancer.netlify.com`
  - Fallback if ALIAS/ANAME/flattened CNAME is not supported:
    - Type: `A`
    - Name/host: `@` or blank
    - Target: `75.2.60.5`

## Post-Change QA Checklist

- Confirm the approved custom domain resolves.
- Confirm `www` and apex/root behavior matches the selected primary-domain policy.
- Confirm HTTPS certificate is active in Netlify.
- Open the custom domain on mobile and desktop.
- Confirm the app loads without mixed-content warnings.
- Confirm manifest loads from the custom domain.
- Confirm `icon.svg` loads from the custom domain.
- Confirm `sw.js` loads from the custom domain.
- Confirm service worker does not cache any old absolute public URL.
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
