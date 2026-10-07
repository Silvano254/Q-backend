# Binti Events Management System — Backend

Backend services for the Binti Events frontend. The primary production API is implemented as Supabase Edge Functions backed by PostgreSQL. The repository also contains migration utilities and legacy/supporting artifacts; deployment guidance below describes the active Edge Functions setup.

- **Repository:** See your organization's source control configuration.
- **Supabase project ref:** Configure your own project reference locally; do not commit project-specific identifiers here.
- **Frontend:** Configure your application's deployment URL in your own environment.

## Architecture

- Supabase PostgreSQL stores tenant-scoped business records.
- Supabase Edge Functions run on Deno and expose API endpoints under `/functions/v1/`.
- Shared function modules provide database access, authentication/authorization, tenant scoping, validation, CORS, and response helpers.
- The frontend sends authenticated requests to these functions; the service-role key is server-side only.
- AI endpoints use Google Gemini when configured; email delivery uses Resend when configured.

## Edge Functions

| Function | Responsibility |
| --- | --- |
| `auth-login`, `auth-verify`, `auth-logout`, `auth-reset` | Login, token validation, logout, and password reset |
| `auth-biometric-login`, `auth-register-biometric`, `auth-profile-update`, `auth-seed-admin` | Biometric and administrative account flows |
| `clients` | Client records |
| `products`, `import-products` | Product catalog and imports |
| `quotes` | Quote lifecycle and terms |
| `invoices` | Invoice lifecycle, balances, and terms |
| `payments` | Invoice payment records and balance updates |
| `expenses`, `analytics` | Expense and reporting data |
| `settings` | Company profile and configuration |
| `email-send` | Email delivery |
| `ai-chat`, `ai-analyze`, `ai-email-draft` | AI chat, analysis, and email drafting |
| `limiter` | Rate-limiting support |

Functions are invoked at `https://<project-ref>.supabase.co/functions/v1/<function-name>`. Authenticated requests use `Authorization: Bearer <access-token>` and the Supabase anon key in the `apikey` header. The auth endpoints issue and validate the app's session token.

## Requirements

- Supabase CLI (`npx supabase` can run the repository-pinned CLI)
- Access to the target Supabase project
- Deno-compatible Supabase Edge Functions runtime

For normal Edge Function development, the Supabase CLI is the primary tool. The root `package.json` also provides convenience scripts for database push, deploy, and TypeScript checking.

## Configuration and secrets

The frontend requires `VITE_API_URL` and `VITE_SUPABASE_ANON_KEY`; configure those in the frontend repository/hosting provider. Configure backend secrets through Supabase project secrets, not frontend environment variables:

| Secret | Used for |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL (normally provided to functions by Supabase) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side database access; never expose to a browser |
| `JWT_SECRET` | Signing and validating application session tokens |
| `GEMINI_API_KEY` | Gemini-powered AI functions |
| `RESEND_API_KEY` | Email delivery |
| `RESEND_FROM_EMAIL` | Sender identity for transactional email |

Set function secrets using the Supabase dashboard or CLI, for example:

```sh
npx supabase secrets set JWT_SECRET=<strong-random-secret> GEMINI_API_KEY=<key> RESEND_API_KEY=<key> RESEND_FROM_EMAIL="Binti Events <billing@example.com>" --project-ref <your-project-ref>
```

Do not commit real credentials, `.env` files, anon/service keys, or secrets to source control. Use `.env.example` only as a template; never use its placeholders as deployed secrets.

## Local setup and validation

```sh
npm install
npm run lint
```

The `lint` script runs `tsc --noEmit` over the repository's TypeScript configuration. For local function development, use Supabase CLI commands and a local Supabase stack if configured:

```sh
npx supabase start
npx supabase functions serve
```

Check the Supabase CLI help/version if a subcommand differs between installed CLI versions.

## Database

The canonical schema and guarded indexes are in `supabase/schema.sql`. Review schema changes before applying them to a live project. Push linked migrations/schema changes only after confirming the target project and reviewing the diff:

```sh
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

The schema creates unique indexes for quote and invoice numbers when existing data permits those indexes. If legacy duplicates prevent index creation, resolve those records before relying on the database constraint as a uniqueness guarantee.

## Deploy Edge Functions

Link the project once, then deploy all functions or a selected function:

```sh
npx supabase link --project-ref <your-project-ref>
npx supabase functions deploy
```

Deploy one function when only it changed:

```sh
npx supabase functions deploy invoices
npx supabase functions deploy quotes
```

The project config currently sets `verify_jwt = false` at the Supabase gateway for functions. The application performs its own authentication checks inside the functions; retain those checks and do not interpret this gateway setting as making business endpoints public.

## API reference and operations

- [API quick reference](API_QUICK_REFERENCE.md)
- [Edge Functions guide](EDGE_FUNCTIONS_GUIDE.md)
- [Supabase deployment checklist](SUPABASE_DEPLOYMENT_CHECKLIST.md)
- [Validation guide](VALIDATION_GUIDE.md)

## License

Copyright © 2026 Binti Events. All rights reserved.
