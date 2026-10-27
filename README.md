# LeadPilot AI — Starter Project

Skill-based lead discovery dashboard for Excel/data work, video editing, websites, social media management, graphic design, and bookkeeping.

## What works in this starter

- Responsive dashboard with skill-specific search queries.
- Local browser lead storage when Supabase is not connected.
- Supabase email/password authentication and per-user lead storage.
- CSV export, lead status tracking, and personalised outreach drafts.
- Supabase Edge Function that queries Brave Search API and/or Google Places API.
- WhatsApp opens a prefilled draft; the user reviews and sends manually.

## Important: not every source is connected automatically

The app uses explicit provider integrations, not unrestricted scraping. The web search connector currently implemented is Brave Search API; Google Places API is optional for business listings. Other platforms (LinkedIn, Instagram, Facebook, freelance marketplaces, etc.) require their own permitted APIs, partner integrations, or approved search access. A search result is not proof that a prospect needs your service.

No fake live leads are bundled. Before a provider API key is configured, the interface can generate query links but does not claim to have fetched actual leads.

## 1. Publish the frontend on GitHub Pages

1. Create a GitHub repository named `leadpilot-ai`.
2. Upload `index.html`, `styles.css`, `app.js`, and `config.js` to the repository root.
3. Open **Settings → Pages**.
4. Select **Deploy from a branch**, choose `main` and `/ (root)`, then Save.
5. Wait for GitHub Pages to publish the URL.

GitHub Pages serves only the static frontend. Do not put provider secret keys in frontend files.

## 2. Create the Supabase backend

1. Create a project at https://supabase.com/.
2. In **Project Settings → API**, copy the Project URL and the public anon/publishable key.
3. Edit `config.js` and paste those two public values. The anon key is designed for frontend use only when Row Level Security is correctly configured.
4. In Supabase **SQL Editor**, run `supabase/schema.sql`.
5. In **Authentication → Providers**, enable Email. Configure email confirmation to your preference.
6. In **Authentication → URL Configuration**, add your GitHub Pages URL to the Site URL / Redirect URLs.
7. Deploy the Edge Function below.

### Deploy the Edge Function

Install the Supabase CLI and sign in, then from this project folder run:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy search-leads
```

The function is configured to require a valid user JWT. Keep that setting enabled.

## 3. Configure source providers

### Brave Search API (web search)

1. Create an account at https://brave.com/search/api/ and create an API key.
2. In Supabase Dashboard → **Edge Functions → Secrets**, add:
   - Name: `BRAVE_SEARCH_API_KEY`
   - Value: your private Brave API key
3. The starter requests up to three skill-specific queries per search. Check the current provider pricing, quota and account requirements before use.

### Google Places API (optional business listings)

1. In Google Cloud, enable **Places API (New)** and configure billing/restrictions.
2. Create a server-side key restricted to the relevant API where possible.
3. In Supabase Edge Function Secrets, add `GOOGLE_PLACES_API_KEY`.
4. Select **Business listings API** or **Web + business listings** in the dashboard.

Google Places has its own terms, attribution requirements, field-based billing and usage restrictions. Review them before storing or exporting Places data at scale. The example asks only for business name, address, website/maps URI and phone. It does not harvest private/personal numbers.

## 4. First test

1. Open your GitHub Pages URL.
2. Click **Connect account**, create an account, and sign in.
3. Run `supabase/schema.sql` before trying to save leads.
4. Configure at least one source API secret and deploy `search-leads`.
5. Select a skill, set a location, and click **Find relevant leads**.
6. Open each source link and verify the business is a genuine fit.
7. Save relevant leads, update status, and export CSV.
8. Use **Outreach drafts** to create a message. The WhatsApp button opens a draft; it does not automatically send it.

## 5. Security checklist

- Never put `service_role`, provider API tokens, or WhatsApp access tokens in `config.js`, `app.js`, or a public GitHub repo.
- Keep RLS enabled. Each user's rows must remain private.
- Keep `verify_jwt = true` for `search-leads`.
- Add rate limits and usage caps before inviting other users.
- For a public production service, add bot protection, logging, quotas, and monitoring.
- This starter uses localStorage as a browser fallback; that is not a secure or cross-device database.
- API keys and providers may incur costs. Confirm current terms and pricing first.

## 6. WhatsApp and compliant outreach

The WhatsApp button uses a `wa.me` link to open a prefilled message. It intentionally does not automate sending or target arbitrary phone numbers. For programmatic sending, register and configure the official WhatsApp Business Platform/Cloud API, store tokens only as backend secrets, handle opt-outs, and follow applicable consent, template and messaging rules.

## 7. Scheduled automation (next stage)

This starter performs a search when you click the button. For recurring searches, add a scheduled Supabase Cron job or external scheduler that invokes a protected backend worker. Do not expose a service-role key in the browser. The scheduled job should use a user's saved skill/location settings, enforce provider quotas, deduplicate results, and record run logs. Add this only after manual search is tested successfully.

## Project layout

```text
leadpilot-ai/
├── index.html
├── styles.css
├── app.js
├── config.js
├── README.md
└── supabase/
    ├── config.toml
    ├── schema.sql
    └── functions/
        └── search-leads/
            └── index.ts
```

## Troubleshooting

- **"Local preview mode"**: edit `config.js` with the Supabase project URL and public key.
- **Cannot sign in**: check Supabase Auth email settings and redirect URLs.
- **Permission denied / RLS error**: confirm you ran `schema.sql`, are signed in, and the table policies exist.
- **Function returns 401**: sign in again and ensure `verify_jwt = true`.
- **No source API configured**: add one of the provider secrets in Supabase Edge Function Secrets.
- **Provider error / quota**: verify key, billing, enabled API, plan and quota in that provider's dashboard.
