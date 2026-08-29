# E2EE Threat Model — zeph.

Status: **design doc, no E2EE code implemented yet.** Per the engineering plan, E2EE
ships only after this document, and only after a device-identity concept exists in
auth. **That prerequisite is now built** (see D-024 in `DECISIONS.md`): every login
creates a `Session` document, the JWT carries its id as `deviceId`, and both the HTTP
and Socket.IO auth paths check it — giving a natural per-device place to eventually
attach a public key. §3 below is kept as a historical record of the gap that existed
and is now closed; §4 onward (the actual E2EE design sketch) is otherwise unchanged
and still not implemented. This remains a design doc, not a checklist to implement
immediately — the reasoning below must still hold before any encryption code is written.

## 1. What problem E2EE solves here

Today, message content is protected only in transit (TLS) and at rest by whoever
controls the MongoDB instance and the server process. The server can read every
message: `message.js` stores `content` as plaintext (after XSS-sanitizing it), and
any DB access, backup, or server compromise exposes full conversation history.

E2EE moves the trust boundary from "trust the server operator" to "trust the
sender and recipient's devices, plus the cryptographic library." For a portfolio
project this is a legitimate, well-scoped feature *if the trade-offs below are
accepted and designed for*, not bolted on as a UI checkbox.

## 2. What the server can and cannot see (target state)

**Can see (metadata, unavoidable and necessary for the app to function):**
- Who is in a conversation (`Room.people`)
- When a message was sent (`Message.date`)
- Message size/type (text vs image vs file — needed to render the right UI)
- Sender identity (`Message.author` — needed for delivery routing)
- Read receipts (`Message.readBy` — this is already server-visible today and stays that way; it's routing metadata, not content)

**Cannot see (post-E2EE):**
- Message plaintext content
- File/image plaintext content (the file itself, not just the caption)
- Search index built from plaintext (see §5 — this is the sharpest trade-off)

**Explicitly out of scope for this project's E2EE:** hiding the *social graph*
(who talks to whom). That's a much harder problem (metadata-resistant routing,
Signal's sealed sender, etc.) and isn't what "E2EE" is being asked to deliver here.
Scope is: **message content is unreadable to the server; who's talking to whom is not hidden.**

## 3. Prerequisite gap — CLOSED (see D-024)

Originally confirmed in this codebase (`backend/src/routes/login.js`, `backend/src/init.js`):
- Auth was a single JWT per login, 60-day expiry, no refresh token, no device identifier in the token payload
- No concept of "this is device #2 for user X" anywhere in `User` model or JWT claims
- Login from a new browser/device did not create a distinguishable session
- (Found during the fix, worth recording: there was also no server-side logout at
  all — "logout" only deleted the client's local token copy, so a leaked token
  remained valid for its full 60-day life regardless of the user "logging out.")

**As of D-024, this is fixed:** every login creates a `Session` document
(`backend/src/models/Session.js`), the JWT carries that session's id as `deviceId`,
and both the HTTP (passport-jwt strategy) and Socket.IO (`authenticate` handshake)
auth paths reject a token whose session has been revoked. There is now a real,
working per-device logout (`POST /api/logout`) and a sessions-list/revoke UI
(`Settings > Manage Sessions`). Pre-existing tokens without a `deviceId` claim are
still trusted (backward-compatible, no forced re-login) — they simply predate the
session system and age out naturally.

This closes the *identity* half of the gap: there is now a natural place to attach
a device's public key, and a way to know how many devices a user has. It does
**not** implement key exchange, key storage, or any of the cryptography in §4 below
— those remain fully unimplemented. The remaining prerequisite work before E2EE
itself could start is entirely within §4-6 below (primitives, key exchange, group
key distribution, rotation/revocation, backup/recovery) — genuine cryptographic
engineering, not auth plumbing.

## 4. Design sketch (once the prerequisite above is addressed)

Not an implementation plan — a sketch of the shape, to make the trade-offs in §5-6
concrete rather than abstract.

- **Primitives:** libsodium (via `libsodium-wrappers` or a maintained Node binding) —
  X25519 for key exchange, XSalsa20-Poly1305 or XChaCha20-Poly1305 for symmetric
  encryption. **No custom cryptography, no hand-rolled protocol.** If a more complete
  protocol is warranted later (multi-device fan-out, forward secrecy, deniability),
  the reference is the Signal protocol / Double Ratchet — but adopting that wholesale
  is a multi-week undertaking on its own and should be a separate, later decision,
  not assumed here.
- **Key generation:** client-side, on first use per device. Private key never leaves
  the device (not even encrypted-at-rest on the server).
- **Key storage:** private key in browser storage (IndexedDB, not localStorage —
  same XSS-exposure reasoning already flagged for the JWT token in this codebase's
  security audit applies doubly here). Public key registered with the server per
  device-identity record (§3 dependency).
- **Key exchange:** for a 1:1 room, standard X25519 ECDH between the two members'
  device keys. For group rooms (`Room.isGroup: true`), this needs a group-key
  distribution scheme (e.g., a per-room symmetric key, itself encrypted individually
  to each member's device public key) — group E2EE is meaningfully harder than 1:1
  and should be scoped as a distinct milestone, not assumed to fall out of the 1:1 design for free.
- **Multi-device:** each device independently registers a public key; sending a
  message means encrypting it once per recipient device, not once per recipient
  user. This is where the device-identity prerequisite becomes non-negotiable —
  without it, there's no list of devices to encrypt to.
- **Key rotation/revocation:** if a device is removed (user logs out, or reports a
  device lost), its public key must be revoked and other members' clients must stop
  encrypting to it. Requires a revocation list or epoch counter per room — not designed
  in detail here, flagged as a required piece of the eventual real design.
- **Backup/recovery:** if a user loses their only device, message history encrypted
  to that device's key is unrecoverable by design (that's the point of E2EE). Whether
  to offer an optional, explicitly-opt-in encrypted key backup (trading some security
  for recoverability) is a product decision to make explicitly, not a default.

## 5. What E2EE breaks in this codebase, and how that's handled

| Feature | Why E2EE breaks it | Handling |
|---|---|---|
| Server-side search (`search.js` searches user fields, not message content today — but any future message-content search) | Server never sees plaintext, so it cannot build or query a content index | Out of scope to fix generally. If message search is wanted later, it must be **client-side only**, decrypting locally and searching in-browser — no server-side message search feature should be built once E2EE ships. |
| AI summarize / translate / draft-reply (`src/ai/assistant.js`, built in this session) | These routes currently fetch plaintext `Message.content` server-side and send it to the AI provider | **Must become opt-in per use**, not automatic. The user explicitly triggers "summarize this conversation," and *at that moment* the client decrypts locally and sends plaintext to the AI route for that one call — the server still never stores or logs it, but the user has explicitly chosen to let *that specific request* be processed in the clear. This is the "explicit plaintext opt-in" gate the plan requires. Passive/automatic AI processing of E2EE'd content must never happen. |
| Moderation (not built in this codebase, but worth naming since chat apps often want it) | Automated content moderation needs to read content | Cannot be done server-side on E2EE'd content. If moderation is ever required (e.g. abuse reports), it would have to be client-side reporting (\"user submits decrypted content as part of a report\"), not passive scanning. Not building this now — flagged so a future \"add moderation\" request doesn't silently assume server-side scanning still works. |
| Multi-device sync (built in this session as `messages/sync`) | The sync route returns `Message.content` directly from MongoDB, encrypted or not, but if encrypted, the *new* device needs a way to decrypt history that was encrypted before it existed | This is the hardest unresolved item in this sketch: a new device joining an account cannot decrypt prior message history unless either (a) history isn't E2EE'd retroactively, or (b) some mechanism re-encrypts to the new device's key on join (expensive, and only possible if another already-authorized device is online to do the re-encryption). No clean solution is asserted here — this is exactly the kind of gap a real implementation must resolve before shipping, not discover after. |
| Read receipts, presence, typing indicators (built this session) | Unaffected — these are metadata, not content, and stay server-visible under this threat model (§2) | No change needed. |

## 6. Honest limitations to state, not hide

- This design does not hide who is talking to whom (§2).
- Group E2EE key distribution is materially harder than 1:1 and is not solved in
  this sketch — treat 1:1 E2EE as the actually-buildable v1, group E2EE as a
  separate, later, harder milestone.
- New-device history access (§5, last row) has no clean answer here.
- Backup/recovery trades security for convenience; whichever way it's decided, that
  trade-off must be visible to the user, not silently defaulted.
- **Do not implement any of this until the device-identity/auth-session prerequisite
  (§3) is built.** Attempting E2EE key management on top of today's single-JWT
  auth model would mean either fudging "device" as "browser session" (weak, doesn't
  survive the stated multi-device requirement) or blocking on the auth rework anyway
  — better to name the dependency now than discover it mid-implementation.

## 7. Recommendation

**Updated per D-024:** the device-identity prerequisite (§3) is now built — session
management, JWT-per-device, a device list UI, and real revocation all shipped as
their own milestone, exactly as originally recommended here. What remains before
E2EE itself is the cryptographic engineering in §4-6: primitives/library choice,
client-side key generation and storage, key exchange, group-room key distribution
(materially harder than 1:1, its own milestone), rotation/revocation, and the
unresolved new-device-history-access gap (§5, last row).

**Still the recommendation for this pass: do not implement the encryption layer
yet.** It remains the hardest, highest-scrutiny item in the whole plan, and
"here's the threat model, here's the prerequisite we deliberately built first, and
here's exactly what's left and why it's hard" is a stronger interview answer at
every stage than a rushed, partially-correct crypto implementation would be at any
stage. If and when this is picked up, §4's design sketch is the starting point —
scope 1:1 E2EE as the buildable v1 before attempting group E2EE.
