# Clerk Dev Application Setup

## Steps to complete before running Phase 3 code

### 1. Create a Clerk application
- Go to https://dashboard.clerk.com and sign in
- Click "Create application"
- Name: `Guru (dev)`
- Enable social providers: Google, GitHub

### 2. Copy API keys into .env.local
After creating the app, Clerk shows your keys. Add them to `.env.local`:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...   # set after step 3
```

### 3. Configure redirect URLs in Clerk dashboard
Under "Paths" in your Clerk app settings:
- Sign-in URL:         /sign-in
- Sign-up URL:         /sign-up
- After sign-in URL:   /chat
- After sign-up URL:   /chat

### 4. Set up the Clerk webhook (for user lifecycle)
- In Clerk dashboard → Webhooks → Add endpoint
- URL: http://localhost:3000/api/webhooks/clerk  (use ngrok for local testing)
- Events to subscribe: `user.created`, `user.updated`, `user.deleted`
- Copy the signing secret → set as `CLERK_WEBHOOK_SECRET` in `.env.local`

### 5. Social provider OAuth credentials (optional for dev)
Clerk provides shared OAuth credentials for development — you don't need
to create Google/GitHub OAuth apps until production. The shared credentials
show a "Clerk" branding on the OAuth consent screen.

For production, create dedicated OAuth apps:
- Google: https://console.cloud.google.com → Credentials → OAuth client ID
- GitHub: https://github.com/settings/developers → OAuth Apps

## Clerk v7 notes
- @clerk/nextjs v7 uses ClerkProvider from `@clerk/nextjs`
- Middleware uses `clerkMiddleware` from `@clerk/nextjs/server`
- `auth()` is async in v7 — always `await auth()`
- `currentUser()` returns full user object including email addresses
