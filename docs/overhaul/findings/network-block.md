# Evidence: reference sites unreachable from this environment

Date: 2026-07-21. The overhaul brief asked for both reference sites to be
studied live in Phase 0. The session environment's network egress policy
denies both hosts at the proxy gateway; only package registries and GitHub
are reachable. Direction was therefore synthesized from the brief's own
translation + public design-press coverage via web search (see
`design-language.md` header note).

Probe log (agent proxy status, verbatim `recentRelayFailures`):

```
{"kind":"connect_rejected","detail":"gateway answered 403 to CONNECT (policy denial or upstream failure)","host":"oryzo.ai:443"}
{"kind":"connect_rejected","detail":"gateway answered 403 to CONNECT (policy denial or upstream failure)","host":"terminal-industries.com:443"}
```

Also denied (curl exit 000 via proxy): web.archive.org, animejs.com,
cdn.jsdelivr.net, unpkg.com. Reachable: registry.npmjs.org (200) — used to
vendor anime.js 4.5.0 from the official npm tarball; WebFetch of both sites
returned the same 403.

Search-derived reference notes used in synthesis:
- Oryzo (Lusion / Edan Kwan): premium launch treatment of a single object;
  dark, spacious layout; live Three.js render with inertia/weight;
  physics-mimicking easing; true Z-depth parallax and orbital camera paths;
  hover states, encode/decode toggles, comparison cards.
- Terminal Industries (Propagande): Yard OS positioning; dark green field,
  white/orange accents (banned as skin); aerial product imagery; clean
  typography at large scale; modular layout; confident technical voice.
