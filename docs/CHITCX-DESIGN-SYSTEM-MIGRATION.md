# Chitcx Design System Migration — shadcn/ui + Tailwind

Status: **complete.** Every frontend feature has been migrated off UIkit + Sass
onto Tailwind CSS + shadcn/ui. The `uikit` and `sass` npm dependencies have
been removed. Zero `.sass`/`.scss` files remain in `src/`. (`styled-components`
was briefly removed too, but had to be reinstalled — see the correction note
below.)

## Why this migration

The inherited template (see `README.md`'s attribution note) used UIkit 3.18.3 for
both styling (utility classes) and behavior (JS-driven dropdowns, modals, toggles
via `data-uk-*` attributes) plus 49 colocated `.sass` files. That combination has
real, specific costs:

- **UIkit's JS widgets have no accessibility semantics by default** — the
  dropdown/modal/toggle patterns in this codebase had no keyboard navigation, no
  focus trapping, no ARIA wiring. Radix primitives (which shadcn/ui wraps) provide
  all of that out of the box.
- **Two styling systems already existed simultaneously** — UIkit utility classes
  plus per-component Sass — with no shared design tokens and no dark-mode
  plumbing.
- **CSS bundle bloat**: UIkit's full theme import (`App.sass`) shipped the entire
  framework regardless of how much of it any given page actually used.

## Why shadcn/ui specifically (not another component library)

shadcn/ui isn't a package dependency — components are generated into the repo
(`src/components/ui/`) via `npx shadcn add <component>`, built on Radix UI
primitives and styled with Tailwind utility classes using CSS custom-property
tokens (`--primary`, `--background`, etc., defined once in `src/index.css`).

- **No black-box runtime dependency to version-bump or audit** — the component
  source lives in this repo, reviewable and editable like any other code.
- **Radix underneath means real accessibility for free** — focus management,
  keyboard nav, ARIA attributes are handled by the primitive, not hand-rolled.
- **Token-based theming** — swapping the token values in `index.css` re-themes
  every component at once; no per-component color literals to hunt down.

## Migration approach

Feature-by-feature, smallest/lowest-risk first, each verified independently
(production build + ESLint + Prettier + manual dev-server check) before moving to
the next:

1. NotFound, Welcome, Admin, Details, Group (established the pattern)
2. Login, ForgotPassword (the one genuinely risky piece deferred until the
   pattern was proven — replacing a real `data-uk-toggle` auth-flow switcher with
   controlled React state + shadcn `Tabs`)
3. Panel (10 files, the app's core navigation shell)
4. Meeting (9 files, the largest and functionally riskiest — live WebRTC/mediasoup
   call UI). Styling-only boundary held strictly here: every mediasoup transport,
   producer, and consumer call is byte-identical to the original; only markup,
   classNames, and icon imports changed.
5. Conversation, Home, App shell (outside the original planned scope, but still
   depended on UIkit and had to be migrated before UIkit could be removed at all)

## What changed structurally, not just cosmetically

- **Every real UIkit behavioral widget became a genuine Radix component**, not a
  styled `<div>`: `Dialog` (7 modals — Admin/Panel password-change, group-creation
  confirmations, Meeting's add-peers overlay), `DropdownMenu` (7 menus — Panel's
  account menu, room-remove menus, Conversation's room-info menu), `Tabs`
  (Login's login/register switch), `Switch` (Meeting's join-screen audio/video
  toggles, replacing a hand-rolled CSS checkbox).
- **`Group/Create` and `Group/Create2` consolidation**: their `TopBar`/
  `SearchBar`/`User` sub-components were byte-identical duplicates (confirmed via
  diff, not assumed from filenames) — consolidated into `Group/components/`,
  cutting 6 files to 3. The two step components themselves (user-selection vs.
  group-naming) are genuinely different and were kept separate.
- **The shared `Picture.jsx` component required zero changes** — it was never
  coupled to UIkit, only to ambient parent CSS providing sizing/color for its bare
  `.img`/`.picture` classNames. Every migrated consumer now provides that styling
  locally via Tailwind child-selector utilities (`[&_.img]:...`), so the shared
  component stayed untouched by design.
- **Custom keyframe animations** (ring-pulse on incoming calls, mobile
  panel slide-in/out, typing-indicator wave dots) registered once in
  `src/index.css` rather than duplicated per-component.

## Real bugs found and fixed while migrating (not scope creep — same files, same pass)

- `Ringing.jsx` always displayed the literal string "Delta Honey" as the caller
  name instead of the actual `counterpart` data it had already computed.
- `Login/components/Logo.jsx` had its actual logo `<img>` commented out and
  rendered a hardcoded personal name instead.
- A CSS class-name mismatch (`.active-meeting` in JSX vs. `.img-content.active`
  in Sass) silently broke the "active meeting" green indicator in `Panel/Meeting.jsx`.
- A click-target bubbling bug in `Panel/Room.jsx`: clicking the "call" or "more
  options" button on a room row also triggered the row's own navigate-to-room
  click handler, since there was no `stopPropagation()`. Fixed as a natural
  consequence of restructuring the nested buttons — not a separate task.
- Roughly a dozen stray debug `console.log`/`console.warn` statements left in
  production code paths (Meeting's WebRTC consume/produce logic, Streams.jsx,
  AddPeers.jsx, Messages.jsx, Home/index.jsx) — removed.
- Several dangling `honeyside.it` outbound links in app footer chrome, found
  during migration passes on `Admin` and `NotFound` that the initial rebrand pass
  missed.

## What deliberately did NOT change

Per the styling-only boundary held throughout: no Redux/reactn state shape
changes, no API contract changes, no Socket.IO event changes, no mediasoup/WebRTC
call changes. The one exception, called out explicitly rather than left
ambiguous: `Message.jsx`'s bubble-tail rendering was changed to not show a
pointed tail on a bubble whose top corner is already flattened by
`attach-previous` grouping — the original CSS rendered the tail unconditionally,
which looked visually broken in that combination. This is a visual-correctness
fix to the CSS translation, not a change to any application behavior.

## Measured result

| Metric | Before | After |
|---|---|---|
| Production CSS bundle | ~318 KB | ~53 KB |
| Production JS bundle (minified) | ~1.31 MB | ~1.10 MB |
| `.sass`/`.scss` files in `src/` | 49 | 0 |
| npm dependencies removed | — | `uikit`, `sass` |

**Correction:** `styled-components` was initially removed alongside `uikit`
and `sass` on the belief it had zero usages in `src/` — true for this
codebase's own components, but it's a genuine transitive peer dependency of
`react-data-table-component` (used by `Admin`'s user table, untouched by this
migration). Removing it broke `npx vite build` outright; it was reinstalled.
Full story in `DECISIONS.md` D-021.

Re-run `npm run bench:bundle` (see `frontend/scripts/bench-bundle.js`) after any
further dependency or code-splitting changes to compare against these numbers.
