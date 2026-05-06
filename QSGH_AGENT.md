# QSGH Agent Manual

This file defines the operating rules, privacy rules, deployment workflow, QA checklist, and Codex behavior expectations for the Granada Hills Quiet Skies / Aircraft Noise Logger project.

## 1. Project Identity

- Project name: Granada Hills Quiet Skies
- Alternate working name: Quiet Skies / Aircraft Noise Logger
- Primary role of this agent: Manage planning, QA, code-change requests, deployment checks, copy edits, and feature specifications for the app.
- GitHub repo: `JNOSystems/quiet-skies-gh`
- Netlify site: `quiet-skies-gh.netlify.app`
- Primary maintainer: Jon

## 2. App Purpose

- The app exists to help Granada Hills residents document community aircraft noise.
- The app is for local community logging and documentation first.
- The app may point users to official complaint systems, but it must not blur local logging with official filing.
- The app must maintain civic credibility through clear copy, limited data collection, and careful handling of official references.

## 3. Core User Workflow

- User opens the app on mobile first.
- User selects one required zone:
  - North
  - Central
  - South
- User taps the main CTA: `I Heard a Plane`
- App stores a community report using timestamp and selected zone only.
- After logging, the app may direct the user to the official LAWA complaint flow.
- Local logging must remain separate from official complaint filing.

## 4. Privacy and Data Collection Rules

- Do not collect name, email, address, login, precise location, or aircraft ID.
- Store only timestamp and selected zone unless Jon explicitly approves a change.
- Do not add user identity collection.
- Do not add precise geolocation.
- Do not add aircraft identification unless Jon explicitly approves.
- Do not add hidden analytics or passive personal data collection.
- Any proposed schema or logging change must be reviewed against the privacy model before implementation.

## 5. Dashboard Rules

- The dashboard must show exactly these three stats:
  - `Last 24 Hrs`
  - `Last 7 Days`
  - `All Time`
- The `All Time` stat must count every logged report.
- Do not revert the third stat back to `Top zone`.
- Dashboard copy should stay short, clear, and mobile-readable.
- Recent Reports should remain useful and lightweight, showing recent activity without exposing personal data.

## 6. Visual Design Rules

- Keep the app mobile-first.
- Preserve the dark sky/orange civic warning visual identity.
- Preserve the bold headline style and strong CTA emphasis.
- Preserve the current community-documentation tone.
- Keep the logging workflow fast and simple.
- Make zone state visually obvious.
- Avoid adding clutter, complex flows, or desktop-first spacing that slows mobile use.

## 7. Official Complaint Routing Rules

- Keep local community logging separate from official complaint filing.
- Never invent FAA, LAWA, ANCIR, or official complaint functionality.
- Do not add FAA ANCIR unless technically feasible and explicitly approved by Jon.
- Do not modify official complaint links without verifying current public sources.
- Official complaint routing must remain clearly optional but visible after logging.
- The app may guide users to official systems, but must not claim to submit on their behalf unless that functionality is real, tested, and approved.

## 8. Netlify Deployment Rules

- This site may be deployed manually by drag-and-drop rather than GitHub continuous deployment.
- The deploy-ready folder should contain production-root files, preferably:
  - `index.html`
  - `manifest.json`
  - `sw.js`
  - `icon.svg`
- Do not include `.git`, `node_modules`, cache files, temp files, OneDrive files, or workspace files in deploy packages.
- Do not include source folders or unrelated project artifacts in deploy bundles.
- Verify the deploy package contains the current production text before upload.
- Require review before any production deploy.

## 9. GitHub Workflow Rules

- Show `git status` before push or deploy-related approval.
- Show `git diff` before push or deploy-related approval.
- Do not push or deploy without showing git status and git diff first.
- Do not force push.
- Use small, understandable commits when possible.
- Keep the repo copy and any manual deploy folder aligned before release.
- If deployment is manual, confirm the deploy-ready files match the intended repo state.

## 10. Codex Change Protocol

- Translate Jon's app ideas into precise Codex-ready implementation prompts.
- Protect the app's privacy model.
- Keep the logging workflow fast and simple.
- Maintain civic credibility in wording and feature scope.
- Verify visual changes before deployment.
- Maintain a changelog of app changes.
- Create QA checklists after each update.
- Never invent FAA, LAWA, ANCIR, or official complaint functionality.
- Keep local community logging separate from official complaint filing.
- Require review before any production deploy.
- Service worker or cache changes require extra testing.

### Required response format for code-change planning

1. Goal
2. Files likely affected
3. Exact Codex prompt
4. QA checklist
5. Deployment checklist
6. Rollback note

## 11. Pre-Deploy QA Checklist

- Confirm the correct repo and branch are being used.
- Run `git status`.
- Run `git diff`.
- Confirm the primary logging flow still works:
  - zone selection required
  - `I Heard a Plane` logs successfully
  - LAWA follow-through remains available
- Confirm privacy copy is visible near the logging action.
- Confirm no name, email, address, login, precise location, or aircraft ID is being collected.
- Confirm dashboard labels read:
  - `Last 24 Hrs`
  - `Last 7 Days`
  - `All Time`
- Confirm `All Time` uses total report count.
- Confirm mobile-first layout still feels fast and uncluttered.
- Confirm selected zone state is visually obvious.
- Confirm official complaint links were not changed unless publicly verified.
- If service worker or cache behavior changed, test fresh load, repeat load, and cache invalidation behavior.
- If using a manual Netlify deploy, inspect the exact deploy folder contents before upload.

## 12. Post-Deploy QA Checklist

- Open the live site and verify the expected release is actually visible.
- Confirm the live page text matches the intended dashboard copy.
- Confirm `Top zone` is not present if the release should show `All Time`.
- Confirm the live CTA appears early enough on mobile.
- Confirm logging still works end to end.
- Confirm official LAWA complaint routing remains visible after logging.
- Confirm recent reports display the intended simplified output.
- Confirm no broken assets, missing icons, or service worker regressions.
- Add a short changelog note summarizing:
  - what changed
  - when it went live
  - any follow-up checks still needed

## 13. Rollback Procedure

- Identify the last known-good version in Git or the last known-good deploy bundle.
- Confirm the rollback target before acting.
- If Git-based rollback is needed, prefer a normal revert commit over history rewriting.
- Do not force push.
- If Netlify deployment is manual, prepare the last known-good deploy folder and redeploy that package.
- After rollback, verify the live site reflects the intended prior version.
- Document why the rollback happened and what must be fixed before redeploy.
