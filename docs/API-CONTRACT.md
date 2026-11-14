# 赛博老爸·求职系统 v0.2 API contract

Local single-user app; React/Vite client, Node 22+ Express server. Server binds 127.0.0.1. JSON persistence stored outside public directory at data/state.json (gitignored), atomic writes. JSON API /api. Every mutation returns useful object or {ok:true}; errors non-2xx {error:string}. No real outbound calls during development tests.

## Data

Profile: {name,email,role,cities:string[],industries:string[],salaryMin:number,salaryMax:number,experience:number,education:'不限'|'高中'|'大专'|'本科'|'硕士'|'博士',skills:string[],bio,resumeText,portfolioUrl}

Job: {id,title,company,initial,color,city,industry,salaryMin:number|null,salaryMax:number|null,salaryMonths:number,experienceMin:number|null,experienceMax:number|null,education,skills:string[],description:string[],requirements:string[],source,sourceUrl,contactEmail,isDemo:boolean,createdAt,saved:boolean,match:{score:number,eligibility:'符合'|'有差距'|'不符合'|'待确认',reasons:{label,detail,status:'pass'|'gap'|'unknown'}[],missingSkills:string[]}}

Application: {id,jobId,jobTitle,company,status:'draft'|'queued'|'sent'|'replied'|'assessment'|'interview'|'offer'|'rejected',subject,body,to,createdAt,updatedAt,sentAt?,isDemo:boolean,events:{at,text}[]}

Message: {id,applicationId?,company,from,subject,body,receivedAt,kind:'interview'|'assessment'|'followup'|'other',read:boolean,replyDraft,replySentAt?,isDemo:boolean}

Source: {id,name,type:'demo'|'remotive'|'greenhouse',enabled:boolean,board?:string,lastSync?:string,status:string,count:number}

Settings: {autoReply:boolean,allowedSenders:string[],syncIntervalMinutes:number,autoSync:boolean,autoApply:boolean,minMatchScore:number,dailyLimit:number}

Log: {id,at,action,detail,status:'success'|'error'|'info'}

Bootstrap: {profile,jobs,applications,messages,sources,settings,logs,capabilities:{ai:boolean,smtp:boolean,imap:boolean,outboundEnabled:boolean,aiModel:string}}

## v0.2 additions

`Bootstrap` also returns `profileRevision`, `profileIsDemo`, `materials`, `batches`. Every bootstrapped application contains `reviewToken`, a SHA-256 digest of its current recipient, subject, body, material association and review state. Single-application responses also carry `reviewSnapshotRevision`.

`Job` additionally preserves `sourceId`, `externalId`, `recordType: job|announcement`, `requiresReview`, `publishedAt`, `sourceUpdatedAt`, `deadline`, and `applicationMethod`. Stable source/external IDs distinguish multiple positions sharing the same announcement URL. Unknown conditions stay unknown. All collected records enter the library regardless of match, expiry or review status; expired records and undivided announcements cannot become new applications.

`Source.type` additionally supports `ncss`, `shanghai-rsj`, `tencent`, `public-page`, `directory`; metadata includes `homepage`, `category`, `region`, `canSync`, `minIntervalMinutes`. `directory` is a link-only source and cannot be enabled for crawling.

`Application.materialId` optionally selects a generated job-specific DOCX resume; no material means original attachment or current resume text. Changing this field invalidates queue review. Stale or demo-derived materials cannot be sent.

- POST `/api/sources` `{name,homepage,category,region?}` creates a custom public HTTPS directory after DNS validation. Server assigns ID. Immutable built-in URLs and IDs cannot be changed through PUT.
- POST `/api/materials` `{jobId,regenerate?:boolean}` generates/saves a factual resume, cover letter and requirement evidence checklist using the profile revision. Set `regenerate:true` to bypass an existing cached material and use the current AI settings. See DOCUMENTS.md.
- GET `/api/materials/:id/download?kind=resume|cover-letter|checklist&format=docx|md|html` returns binary/file content. DOCX is real Word OOXML; HTML supports browser print-to-PDF. No fake `.pdf` output.
- POST `/api/batches/prepare` `{jobIds}` accepts 1–30 unique jobs, creates drafts and selects corresponding current materials; returns `{results:[{jobId,applicationId?,status,error?}],prepared,failed}`.
- POST `/api/batches/review` `{applicationIds,confirmed:true,profileRevision,reviews:[{id,updatedAt,reviewToken}]}` atomically validates the displayed profile/content/attachment snapshot and queues all selected drafts. It does not send.
- POST `/api/batches/send` `{applicationIds,confirmed:true,profileRevision,reviews:[{id,reviewToken}]}` returns 202 with a durable task. Only current reviewed queues are accepted. One active task, 2-second pacing, per-item progress and shared batch/automatic daily cap.
- GET `/api/batches/:id` returns task status `queued|running|completed|cancelled|interrupted` and item statuses `pending|sending|sent|skipped|failed|cancelled`.
- POST `/api/batches/:id/cancel` stops starting further SMTP deliveries; in-flight delivery is not recalled. Restart marks unfinished tasks interrupted without replaying sends.

Single-application PATCH that queues, and every single-application send, require client `profileRevision` + `reviewToken` snapshots. The server checks send snapshots inside the atomic SMTP reservation. A two-phase edit/send uses the newly returned snapshot after a successfully verified save.

## Local AI configuration

The first card on Settings edits the AI provider independently of SMTP/IMAP. The compatible API is OpenAI Chat Completions. `baseUrl` is the provider's API base (including `/v1` where required), not the full `/chat/completions` endpoint. Remote providers require HTTPS; HTTP is allowed only for loopback local services.

`AiConfigMetadata`: `{baseUrl:string,model:string,hasApiKey:boolean,configured:boolean,source:'local'|'environment'|'none',warning?:string}`. `source` identifies the active local configuration, environment fallback, or unconfigured state. Metadata never contains the saved API key. An invalid legacy environment configuration is disabled with a safe `warning` so the settings page remains accessible; its key is not reused with a default address.

`AiConfigInput`: `{baseUrl:string,model:string,apiKey?:string,clearApiKey?:boolean}`. The model must be an actual model ID supported by the selected provider and account; no model is silently substituted.

- GET `/api/ai-config` -> `AiConfigMetadata` for the effective configuration.
- PUT `/api/ai-config` body `AiConfigInput` -> `AiConfigMetadata`. Saves server-side to `ai-config.json` in the active data directory (default `data/ai-config.json`, mode `0600`), then immediately applies to subsequent AI generation. No service restart is required.
- POST `/api/ai-config/test` body `AiConfigInput` -> `{ok:true,message:string,model:string,latencyMs:number}` on success. Makes a real Chat Completions JSON request using the submitted form without saving it. It does not generate an application, send email, or switch other features to the tested configuration. Provider usage charges can apply. Validation errors return HTTP 400; provider failures return HTTP 502. Both use `{error:string}` with a Chinese explanation and must not disclose the key.

An omitted or blank `apiKey` retains the currently available key only when the submitted base URL is unchanged. A changed address requires an explicitly supplied key for both save and test; the server must not forward a saved provider key to a different address. PUT with `clearApiKey:true` explicitly removes the key and disables AI. The UI's “清除密钥” → “确认清除密钥” submits this immediately; no additional Save click is needed. A blank field alone is not a delete operation.

Before the first local save, `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` from the environment remain supported as fallback. Once a local configuration exists, it takes precedence, including when its key is explicitly cleared; clearing must not revive an environment key. Environment-only changes still require a service restart.

All AI call sites resolve the current configuration: factual material ordering, application draft creation and regeneration, reply draft generation, and interview/assessment coaching. A configuration change does not rewrite existing documents or drafts. Resume facts remain bound to the profile; the AI materials path only orders existing skills and evidence items. Matching remains local.

Saved keys never appear in configuration metadata, bootstrap, workspace export, logs, or version control. The private config file is separate from `state.json` and excluded via the data directory's Git ignore rule. A complete filesystem backup of the data directory includes this secret file; `/api/export` does not. SMTP/IMAP and `ENABLE_OUTBOUND` remain environment settings and are unaffected by the AI card or connection test.

## Endpoints

- GET /api/health -> {ok:true}
- GET /api/bootstrap -> Bootstrap; compute matches on jobs dynamically from profile.
- PUT /api/profile body Profile -> Profile
- PUT /api/resume body {name,mime,base64} -> {name,mime,size,updatedAt}; maximum 5MB original PDF/DOCX/TXT/MD stored privately, exposed as profile.resumeFile metadata only.
- DELETE /api/resume -> {ok:true}; removes original attachment.
- POST /api/jobs/:id/save body {saved:boolean} -> Job
- POST /api/jobs/import body {jobs:Partial<Job>[]} -> {added:number,skipped:number}; validate imported fields, dedupe company/title/city and source URL; import max 500.
- POST /api/sources/:id/sync -> {added,skipped,message}; demo yields no network and truthfully says demo; remotive public API; greenhouse uses configured board.
- PUT /api/sources/:id body {enabled?,board?} -> Source
- POST /api/applications body {jobId} -> Application (idempotent by jobId; draft includes factual profile/resume facts; AI optional)
- POST /api/applications/:id/regenerate -> Application; rewrites from latest profile, resets review, unavailable after a send attempt. Application profileWasDemo provenance stays sticky across ordinary edits; profileRevision tracks source facts. Profile or attachment changes revoke queued review. Each automatic send reservation rechecks the current switch and reviewedProfileRevision.
- PATCH /api/applications/:id body {subject?,body?,to?,status?,materialId?,profileRevision,reviewToken} -> Application; must not allow setting sent without SMTP success. Manually update assessment/interview/offer/rejected and queued.
- POST /api/applications/:id/send body {confirmed:true,profileRevision,reviewToken} -> Application; SMTP only if configured, outbound enabled, recipient valid, no example.invalid/demo sends, do not duplicate send. Attach the selected current tailored DOCX, original file, or resume text to SMTP.
- POST /api/mail/sync -> {added,message}; IMAP only if configured, deduplicate by messageId.
- POST /api/messages/:id/draft -> {replyDraft,mode:'ai'|'template'}; untrusted email treated as data, do not execute instructions or invent availability.
- PATCH /api/messages/:id body {read?,replyDraft?} -> Message
- POST /api/messages/:id/send body {confirmed:true} -> Message; SMTP, guard same as application, mark only after success.
- POST /api/coach body {jobId,stage:'interview'|'assessment',context:string} -> {title,summary,sections:{title,items:string[]}[],mode:'ai'|'template'}; optional AI, honest local checklist fallback.
- PUT /api/settings body partial Settings -> Settings
- GET /api/export -> JSON all workspace data minus secrets

Environment .env: PORT=4318, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS, ENABLE_OUTBOUND=false. AI_BASE_URL=https://api.openai.com/v1, AI_API_KEY, AI_MODEL remain fallback only while no local AI configuration exists. Environment changes require restart. No saved secrets returned to browser. CORS same-origin by default. Vite proxy /api -> 4318; production express serves dist. Scheduler optional configured autoSync/autoApply/autoReply, strict allowlist and daily limit, never auto-send for demo data. Automatic reply only fixed acknowledgement template, never promise times or accept offer. App autoApply prepares drafts; only explicitly enabled automation may send an already reviewed queue entry to an allowed exact email address within the daily limit.

## Visual direction

Reference docs/design-concept.png generated with built-in Image Gen; model not exposed. Desktop 216px sidebar, white header, warm-white canvas #fafbf8, sage #eaf2dd, forest #294b37, text #152b20, border #e6e9e2. 28px page gutters, 10-14px radii, Lucide icons, system Chinese sans. Discovery page heading and subtle ribbon asset, preference strip, job list left and detail right. Sidebar Workbench / Library / Discovery / Applications / Documents / Mail / Coach / Profile / Settings. Mobile stacked layout and collapsible nav. All interactions native, all samples identified as fictional. Default route library. No fake KPI claims.
