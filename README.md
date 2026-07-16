# DuGuud — Last Stock, Honestly Priced

## Live site
- **Render:** https://duguud.onrender.com (working)
- **Domain:** https://www.duguud.co.za (propagating)

## How to run locally
1. Open PowerShell in the project folder
2. `cd server`
3. `npm install`
4. `npm start`
5. Open http://localhost:3000

## Admin login
- http://localhost:3000/admin.html (or /admin.html on live)
- Email: `admin@duguud.com`
- Password: `admin123`

## Quick reference
| Task | How |
|---|---|
| Add products | Admin panel → ✚ New Listing or 🔗 Fetch from URL |
| View orders | Admin panel → 📋 Orders |
| Reset user password | Admin panel → 👥 Users → 🔑 Reset |
| Change admin password | Admin panel → ⚙️ Settings |
| Customer tracking | Go to /track on the site |
| Update code + redeploy | `git add -A` → `git commit -m "message"` → `git push` (Render auto-deploys) |

## Current features
- Storefront with product grid + cart + cart drawer
- User registration & login
- Admin panel (manage products, orders, users, passwords)
- PayFast payments (sandbox — switch to live when verified)
- R85 shipping (free over R850)
- Order tracking at /track
- SEO (sitemap.xml, robots.txt, JSON-LD product schema)
- Product URL scraper (fetch-product.ps1)

## To-do before accepting real payments
1. ✅ ITN URL set to `https://duguud.onrender.com/api/payments/itn`
2. ✅ Sandbox test transaction successful — order marked as **paid** end-to-end
3. ☐ Switch to live PayFast credentials + set `PAYFAST_MODE=live` in Render env vars
4. ☐ Set PayFast passphrase on payfast.co.za to match `PAYFAST_PASSPHRASE` in Render env vars
5. ☐ Add SMTP env vars to Render for email notifications (order confirmations, shipping updates)
6. ☐ Update ITN URL to `https://duguud.co.za/api/payments/itn` once the custom domain is live
7. ☐ Manually mark the 3 old test orders as **paid** or **cancelled** in the admin panel

## Project structure
```
DuGuud/
├── server/           ← Backend (Node.js + Express)
│   ├── src/          ← All server code
│   │   ├── index.js         — Main app
│   │   ├── db.js            — Database
│   │   ├── email.js         — Email notifications
│   │   ├── seed.js          — Product data
│   │   ├── middleware/      — Auth
│   │   └── routes/          — API endpoints
│   ├── data/               — SQLite database (auto-created)
│   ├── .env                — Config (not on GitHub)
│   └── package.json
├── index.html         ← Storefront
├── admin.html         ← Admin panel
├── product.html       ← Product detail
├── register.html      ← Login / Register
├── store.js           ← Cart, checkout, shared logic
├── api.js             ← Frontend → backend connector
└── images/            ← Product images
```
