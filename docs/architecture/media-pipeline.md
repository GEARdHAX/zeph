# Media Pipeline

Upload, delivery and deletion of attachments. The browser is never trusted: it proposes a file, the server decides.

## 6. Secure upload flow

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant API as Backend
  participant DB as MongoDB
  participant R2 as Object storage

  B->>API: request upload (file name, size)
  API->>API: authenticate user
  API->>API: check extension, category,<br/>size policy, blocked types
  API->>API: generate server-controlled object key<br/>(random ID, user folder)
  API->>API: decide the content type from the extension<br/>(not from the browser)
  API->>DB: create media record (UPLOADING)
  API-->>B: signed upload URL + exact headers to send
  B->>R2: PUT file with only the signed headers
  R2-->>B: stored
  B->>API: finalize upload
  API->>DB: media record belongs to this user and is UPLOADING?
  API->>R2: read stored size and content type
  API->>API: real size within limit?<br/>stored type equals the signed type?
  API->>R2: read file header
  API->>API: content matches category?<br/>executable signature rejected
  opt archive or Office file
    API->>API: inspect archive structure
  end
  opt image
    API->>R2: write thumbnail
  end
  alt all checks pass
    API->>DB: media record READY
    API-->>B: media (usable in a message)
  else any check fails
    API->>R2: delete object(s)
    API->>DB: mark FAILED
    API-->>B: rejection, no usable media
  end
```

**What the browser is not trusted for:** file type, file size, extension, the storage key, ownership, and any thumbnail reference it supplies. Each is derived or re-verified by the server.

**Why this design?** Direct-to-storage upload keeps large files off the application server. The cost is that the server never sees the bytes in transit, so it re-checks the stored object at finalization before anything becomes available. Binding the content headers into the signature means a client cannot upload under a different type than the one the server approved.

---

## 7. Media delivery

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant API as Backend
  participant W as CDN Worker
  participant R2 as Object storage

  B->>API: request link for a media item
  API->>API: authenticate and check the user<br/>belongs to the conversation
  API-->>B: short-lived signed URL<br/>(type and download behaviour included)
  B->>W: GET signed URL (optionally with Range)
  W->>W: verify signature and expiry
  alt invalid or expired
    W-->>B: rejected
  else valid
    W->>R2: read object (internal binding)
    alt full request
      R2-->>W: bytes
      W-->>B: 200 + headers
    else valid byte range
      W-->>B: 206 Partial Content
    else range past end of file
      W-->>B: 416 Range Not Satisfiable
    else unchanged since last fetch
      W-->>B: 304 Not Modified
    end
  end
```

| Behaviour | Detail |
|---|---|
| No direct storage exposure | The storage bucket is private; only the Worker reads it, and only for valid signed links |
| Range / video seeking | Single byte ranges are served as 206; unsatisfiable ranges get 416; malformed range headers fall back to a full response |
| HEAD and conditional requests | Supported (headers without body, 304) |
| Download-only types | Documents, archives and text files are always served as attachments, never rendered inline |
| Cache headers | Private media is not publicly cached; public avatars are cacheable |

**Edge caching status.** Responses carry cache headers, but edge caching of media is **not yet active**: it requires the domain to be on Cloudflare DNS, which is a planned step.

**Why this design?** Authorization stays in the main backend (it knows about conversations), while byte-serving is offloaded to a Worker next to the storage. Signed, expiring links let the Worker validate requests without calling back to the backend.

---

## 8. Media deletion lifecycle

```mermaid
flowchart TD
  Del["User deletes a message<br/>for everyone"] --> Opt["UI hides it immediately<br/>(optimistic)"]
  Opt --> Req["Delete request"]
  Req --> Auth{"Author, within the<br/>deletion window?"}
  Auth -- "no" --> Fail["Request rejected"]
  Fail --> Rollback["UI restores the message<br/>and shows an error"]
  Auth -- "yes" --> Detach["Message saved as deleted<br/>media reference removed<br/>(access to the file stops)"]
  Detach --> Job["Queue a cleanup job<br/>BullMQ"]
  Job --> Ref{"Does any other message<br/>still use this media?"}
  Ref -- "yes" --> Keep["Keep the file"]
  Ref -- "no" --> Del2["Delete stored objects"]
  Del2 --> Err{"Storage call failed?"}
  Err -- "yes" --> Retry["Retry with backoff"]
  Retry --> Del2
  Err -- "no" --> Meta["Delete media record"]
```

Deleting an entire one-to-one conversation runs the same cleanup for each attachment in it. Deleting a message **for me only** hides it for that user and never touches the file.

**Why this design?** The reference is detached before the file is removed, so access stops immediately even if storage is slow or failing. Deletion of the bytes is a retried background job, so a transient storage error never fails the user's delete, and the shared-media check prevents removing a file another message still needs. The optimistic UI means the interface feels instant, with a rollback if the server rejects the request.
