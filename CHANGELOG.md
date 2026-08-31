## [Unreleased]

## [0.3.0] - 2026-08-31

### Added

- Azure Functions v4 programming model with real streaming SSR. The build generates an `entry.mjs` that registers all functions in code (`app.http`, `app.storageQueue`) with `enableHttpStream` on, so the response shell reaches the client while Next is still rendering. Measured on Azure: 0.47s to first byte on a page whose full render takes 1.9s.
- Next 16 support via @opennextjs/aws 4.1.x. The example app runs Next 16.3; `init --scaffold` uses create-next-app@16.
- Committed e2e harness (`scripts/e2e.sh`) that builds the example, runs it under the real Functions host with Azurite, and asserts the full matrix: HTTP semantics, ISR, on-demand and queue-driven revalidation, and streaming (with a timing assertion). CI runs it on every push.

### Changed

- Default Node runtime is 22 (Node 20 is EOL April 2026; the v3 model didn't run on 22 at all). Existing apps move to Node 22 on their next deploy: if the app has native dependencies, rebuild before deploying.
- The `optimized-images` container is private; the image function reads and writes it with the SDK. Image caching now requires `AZURE_STORAGE_CONNECTION_STRING` (the default bicep sets it) and warns once when it is missing.
- Function-app CORS dropped: pages are served same-origin and need none.
- Error responses include details only when `NODE_ENV=development`, instead of whenever it isn't exactly "production".
- Windows: az `--query` arguments quoted for cmd, deploy zips with Compress-Archive. Builds pass on the Windows CI leg; a real Windows deploy has not been exercised yet.

### Fixed

- A response stream that was never ended (source destroyed mid-render) held the invocation open until the host timeout. The wrapper now closes it when the handler finishes or fails.
- `SameSite` cookie values outside Lax/Strict/None made the platform's serializer throw and fail the whole response; they are normalized or dropped.
- The revalidation consumer copies `prerender-manifest.json` before the handler, so a missing manifest skips the consumer cleanly instead of registering one that poison-queues every message.
- The bundle installs a loud warning instead of silently pulling `latest` when next/react are missing from the app's package.json.

## [0.2.0] - 2026-08-30

### Fixed

- POST/PUT/PATCH/DELETE requests returned 500. The converter called the v4-only `request.arrayBuffer()`; it now reads `bufferBody`/`rawBody` under the v3 model and handles both models' header shapes.
- Multiple `Set-Cookie` headers were comma-joined into one invalid header, breaking apps that set more than one cookie (next-auth). They now go out as structured cookies via `context.res.cookies`.
- Binary and compressed response bodies were corrupted by a utf8 decode round-trip. Bodies now pass through as raw bytes.
- `revalidateTag`/`revalidatePath` never worked. Four separate bugs: table keys contained `/`, which Azure Tables forbids, so every tag write failed silently; the `getLastModified` filter queried a property that doesn't exist (`RevalidatedAt` vs `revalidatedAt`) with an Int64 literal against a Double; OData filter values weren't quote-escaped; and nothing seeded the tag table or prerendered ISR entries at deploy. All fixed, and deploy now seeds both from the build output.
- Blob cache keys came out as `nextjs-cache/nextjs-cache/<buildId>//index.cache`. Keys now match the build output layout; set `AZURE_CACHE_KEY_PREFIX` if you want a prefix.
- Account-name/key auth passed a plain object where the SDK expects a credential, which silently downgraded to anonymous access. It now builds a `StorageSharedKeyCredential`.
- Blob uploads declared UTF-16 `content.length` as the byte length, truncating non-ASCII payloads. Now `Buffer.byteLength`.
- With `AZURE_STORAGE_ACCOUNT_NAME` unset, static assets got long-cached redirects to `https://undefined.blob.core.windows.net/...`. The redirect is skipped without the account name, and App Router metadata routes (`/opengraph-image.png`, `/icon.png`) are no longer treated as assets.
- The function bundle installed only next/react/react-dom, which crashed any app with other server-side runtime deps on import. All production dependencies install now.
- A leftover `function-app.zip` from a failed deploy merged into the next one (`zip -r` appends), shipping deleted files. The zip is removed before creation.
- `az storage blob upload-batch` ran with Node's 1 MB `maxBuffer` and died on medium asset sets. Raised to 100 MB.
- The staging quota check validated EP1 while the template deploys Y1 for staging.
- `--no-wait` on `delete` did nothing (commander maps it to `wait: false`, the code read `noWait`).
- `--version` was hardcoded and stale. It reads package.json now.
- `appName`, `resourceGroup`, `location`, and `environment` are validated against Azure naming rules before reaching `az` shell commands, in every command including `health` and `tail`. A cloned repo's `azure.config.json` could previously inject shell commands.
- A response stream that errored before finishing hung the invocation until the host timeout. The stream now resolves on destroy.

### Added

- Revalidation queue consumer. The build wires OpenNext's revalidation function as a queue trigger (wrapper/converter pair `azure-queue-revalidate`), so time-based ISR expiry regenerates pages instead of piling up unread messages. The binding resolves `%AZURE_QUEUE_NAME%` so it always follows the queue the producer writes to. Failed revalidations throw, so the runtime retries and poison-queues them.
- Static-asset routing decides from the build, not filename patterns: the build writes `static-assets.json` listing root-level files actually uploaded, and the wrapper redirects only those. Server-rendered lookalikes (`app/sitemap.ts`, `app/robots.ts`, hashed metadata images) reach the server instead of 301ing to a blob 404.
- Unit tests (vitest) for the HTTP converter, Set-Cookie parsing, blob key layout, and table key encoding. `pnpm test` runs `vitest run`.

### Performance & scaling

- Deployment payload halved, 102 MB to 52 MB zipped. Installs now target the Functions runtime (`--os=linux --cpu=x64 --libc=glibc`) so npm resolves the right platform builds for every package, with a prune pass as a safety net; the build previously shipped ~139 MB of macOS binaries.
- Tag cache reads were full table scans (one round trip per 1,000 rows, on every cached page hit). Pairs are written in both directions, (PK=tag, RK=path) and (PK=path#..., RK=tag), so `getByPath` and `getLastModified` are single partition queries at any table size. Keys strip the leading slash so runtime lookups match seeded rows, the timestamp filter uses a double literal (Azure rejects bare epoch-ms integers with a 400), writes are capped at 16 concurrent with the reverse row first, and the seeder honors the same `AZURE_*` name and prefix env vars the runtime reads.
- Bicep: `maximumElasticWorkerCount` set on the plan. Omitted, Elastic Premium defaults to 1, which pinned prod to a single instance. Prod also gets `minimumElasticInstanceCount` and `preWarmedInstanceCount` for always-ready SSR, plus `FUNCTIONS_WORKER_PROCESS_COUNT=2`. Removed `WEBSITE_RUN_FROM_PACKAGE='1'` (unsupported on Linux Consumption) and the Windows-only `WEBSITE_NODE_DEFAULT_VERSION`. The deploy captures the run-from-package URL before provisioning and restores it right after, so a deploy that fails before the zip push leaves the running package intact.
- host.json caps per-instance queueing (`maxConcurrentRequests: 16`, `maxOutstandingRequests: 100`). The Consumption defaults queue ~200 requests on a single-core worker before scale-out relieves it; the cap leaves enough queue to ride out scale-out without shedding 429s.
- Storage SDK retries fail fast on the hot path (blob: 3 tries, 300 ms initial delay, 10 s per-try timeout; tables: 3 retries, 2 s max delay). The defaults waited 4 s before the first retry.
- Image optimization: one `download()` instead of `exists()` plus `download()`, one client per worker, cache key varies on the Accept-negotiated format, the stored content type is served instead of hardcoded `image/webp`, `Vary: Accept` is emitted, and non-200 responses are never cached.

### Changed

- Minimum Node version raised to 20 (Node 18 is end-of-life). esbuild target raised to node20.
- Removed the unwired `azure-cached` image-cache duplicate and its adapter; the maintained implementation is the `azure-image-optimization` wrapper.

## [0.1.3] - 2025-11-03

### Added

- Health check now validates static asset cache headers are configured correctly.
- Health check now performs HTTP request to verify Function App is responding (with response time).
- Added image optimization support using Azure Blob Storage as cache and sharp for processing.

### Fixed

- Static assets on Azure Blob Storage now have proper cache-control headers (\_next/static files have `immutable` with 1-year cache, other assets have `must-revalidate`).
- Static asset redirects now conditionally set cache headers based on file path (only \_next/static files get immutable cache).
- `_next/data` files are no longer redirected to blob storage, allowing proper ISR cache handling through the function app.
- CSS files are now patched during deployment to include `/assets` container path in font URLs, fixing 400 errors for fonts referenced in stylesheets.
- View logs quick action now recommends using `npx opennextjs-azure@latest tail` to access live logs in the Azure Portal.

## [0.1.2] - 2025-10-30

### Added

- Health check command for validating deployment status.
- Delete command for removing resource groups with confirmation prompt.

### Fixed

- Only return error message and stack trace in HTTP response in development mode.

## [0.1.1] - 2025-10-29

### Added

- CI workflow for building library.
- CI workflow for building example application.
- Application Insights integration for logs and monitoring.
- Log stream quick access from CLI via `tail` command.
- Auto-registration of `Microsoft.AlertsManagement` resource provider.
- Basic example application demonstrating usage.
- README and LICENSE documentation.
- Documentation on Azure resources used by the project.
- Documentation noting Application Insights as default monitoring solution.
- Instructions for how basic-app example was generated.

### Fixed

- `.open-next` folder now properly cleaned on each build.
- Bundler issues with `console.error` statements.
- Bicep template synchronization during deployment.
- Relative paths for configuration imports.
- `create-next-app` usage must avoid using turbopack flag.
- Stream handling now properly awaited.
