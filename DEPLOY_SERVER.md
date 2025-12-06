# Railway deployment
Deploy the `server` folder to Railway.app

## Quick Deploy Steps:

1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your `Walkie-Talkie` repository
5. Click "Add variables" and set:
   - `PORT` = `3001` (or Railway will auto-assign)
6. In Settings → Set root directory to: `server`
7. Deploy

Your server will be live at: `https://your-app.railway.app`

## Update Vercel environment:

In Vercel dashboard, add environment variable:
- `VITE_SERVER_URL` = `https://your-app.railway.app`

Redeploy Vercel and it will connect to your Railway server.
