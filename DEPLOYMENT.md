# Deploying Goldilox to Vercel

Complete guide to deploy alongside briefica-web.

## Prerequisites

- ✅ GitHub account
- ✅ Vercel account (same one you use for briefica-web)
- ✅ Anthropic API key
- ✅ Git installed on your Mac

## Step-by-Step Deployment

### Step 1: Push to GitHub

```bash
cd ~/Projects/goldilox

# Initialize git
git init

# Add all files
git add .

# Make first commit
git commit -m "Initial commit: Goldilox RAG Controller"

# Create GitHub repo:
# Go to github.com/new
# Repository name: goldilox
# Description: "Patent-protected constrained legal reasoning"
# Public or Private
# DO NOT initialize with README
# Click "Create repository"

# Back in terminal, link to GitHub:
git remote add origin https://github.com/YOUR_USERNAME/goldilox.git
git branch -M main
git push -u origin main
```

### Step 2: Import to Vercel

1. Go to **vercel.com** (where briefica-web is)
2. Click **"Add New..."** (top right)
3. Select **"Project"**
4. Click **"Import Git Repository"**
5. Find **goldilox** in the list
6. Click **"Import"**

### Step 3: Configure Project

On the configuration screen:

```
Project Name: goldilox
Framework Preset: Next.js (auto-detected)
Root Directory: ./
Build Command: npm run build
Output Directory: .next
Install Command: npm install
```

**Scroll to Environment Variables**:

1. Click **"Add"**
2. Key: `ANTHROPIC_API_KEY`
3. Value: `sk-ant-your-actual-key-here`
4. Select environments:
   - ✅ Production
   - ✅ Preview
   - ✅ Development

5. Click **"Deploy"**

### Step 4: Wait for Build

- Build takes 1-2 minutes
- You'll see: Building → Deploying → ✓ Ready

### Step 5: Verify

You should now see in your Vercel dashboard:

```
Projects
├── briefica-web-ctdj
│   briefica.com
└── goldilox              ← NEW!
    goldilox.vercel.app
```

### Step 6: Test

1. Click "Visit" or go to your deployment URL
2. Upload a `.bset` file
3. Test a query
4. Verify Goldilox responds correctly!

## Custom Domain (Optional)

### Add Domain to Goldilox

1. Go to your goldilox project in Vercel
2. Click **"Settings"** → **"Domains"**
3. Add domain: `goldilox.yourdomain.com`
4. Update DNS records as instructed:
   - Type: CNAME
   - Name: goldilox
   - Value: cname.vercel-dns.com

## Environment Variables Management

### View/Edit Variables

```bash
# Via Vercel Dashboard:
Project → Settings → Environment Variables

# Via CLI:
npm i -g vercel
vercel env ls
vercel env add ANTHROPIC_API_KEY production
```

### Update Variables

After changing environment variables in Vercel:
1. Go to "Deployments"
2. Click "..." on latest deployment
3. Click "Redeploy"

## Continuous Deployment

Now every time you push to GitHub, Vercel auto-deploys:

```bash
cd ~/Projects/goldilox

# Make changes...
git add .
git commit -m "Improve validation logic"
git push

# Vercel automatically builds and deploys!
```

## Troubleshooting

### Build Fails

**Error:** `Cannot find module '@anthropic-ai/sdk'`
```bash
# Test locally first:
npm install
npm run build

# If it works locally, check Vercel build logs
```

**Error:** `ANTHROPIC_API_KEY is not defined`
```bash
# Add environment variable in Vercel dashboard
# Then redeploy
```

### API Errors

**Error:** `429 Rate Limit`
- You're hitting Anthropic API limits
- Upgrade your Anthropic tier
- Or reduce usage

### Port Conflicts Locally

**Error:** `Port 3001 already in use`
```bash
# Stop other servers or use different port:
npm run dev -- -p 3002
```

## Performance Tips

### Enable Edge Runtime (Optional)

Add to `src/app/api/generate/route.ts`:

```typescript
export const runtime = 'edge';
```

### Monitor Performance

Enable Vercel Analytics:
1. Project → Analytics tab
2. Enable Web Analytics
3. Monitor response times

## Cost Estimates

### Anthropic API
- Claude Sonnet 4: ~$3/million tokens
- Average query: ~2,500 tokens
- Cost per query: ~$0.0075

### Vercel
- Hobby (Free): 100GB bandwidth
- Pro ($20/mo): 1TB bandwidth

## Security

### Protect API Key

- ✅ Never commit `.env.local` to Git
- ✅ Only use Vercel environment variables for production
- ✅ Rotate API keys regularly

### Rate Limiting (Optional)

To prevent abuse, add rate limiting:

```typescript
// Install: npm install @upstash/ratelimit
import { Ratelimit } from "@upstash/ratelimit";
```

## Support

- Vercel Support: vercel.com/support
- GitHub Issues: github.com/YOUR_USERNAME/goldilox/issues

---

Made with 🐻 by Goldilox
