# Infrastructure and CI

## 17. Production infrastructure

```mermaid
flowchart TB
  User["User browser"]

  subgraph App["Application"]
    FE["Frontend<br/>Vercel"]
    BE["Backend API + Socket.IO + workers<br/>Render"]
  end

  subgraph DB["Data stores"]
    Mongo[("MongoDB Atlas")]
    Redis[("Upstash Redis")]
  end

  subgraph CF["Cloudflare infrastructure"]
    R2[("R2 storage")]
    Worker["CDN Worker"]
    RT["Realtime SFU"]
  end

  subgraph Ext["External providers"]
    AI["AI: Gemini / Groq / Ollama (optional)"]
    Mail["Transactional mail"]
  end

  User --> FE
  User --> BE
  User --> Worker
  User --> R2
  User --> RT
  BE --> Mongo
  BE --> Redis
  BE --> R2
  BE --> RT
  BE --> AI
  BE --> Mail
  Worker --> R2
```

Edge caching of media is not active yet (planned with a DNS move to Cloudflare). Ollama, when used, is self-hosted and not part of the managed footprint above.

**Why this design?** Managed free/low-cost services keep recurring cost small and deliberate, and the only components that need special network access (calls, bulk media) are delegated to Cloudflare, which the API host cannot provide.

---

## 16. CI / verification

This is a **verification** pipeline. There is no automated production deployment step in CI; hosting platforms deploy separately.

```mermaid
flowchart LR
  Push["Git push / pull request"] --> GA["GitHub Actions"]
  GA --> Scan["Secret scanning"]
  Scan --> BE["Backend job<br/>format check, dependency audit, tests"]
  Scan --> FE["Frontend job<br/>format check, lint, dependency audit, tests"]
  BE --> Docker["Docker smoke builds<br/>(not published)"]
  FE --> Docker
  Docker --> Result{"All required<br/>steps pass?"}
  Result -- "yes" --> Pass["Green"]
  Result -- "no" --> Fail["Red — fix before merge"]
```

The dependency audits are reported but do not block the build. The CDN Worker's own tests are run locally rather than in this workflow.

**Why this design?** Secret scanning gates everything else so a leaked credential is caught before tests even matter, and the Docker smoke build verifies the images still assemble without publishing anything.
