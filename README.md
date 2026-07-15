# DuGuud — Last Stock, Honestly Priced

## How to run

1. Open PowerShell / Terminal
2. `cd C:\Users\theun\OneDrive\Documents\DuGuud\server`
3. `npm install` (only needed once or after adding packages)
4. `npm start`
5. Open http://localhost:3000 in your browser

## Admin login

- http://localhost:3000/admin.html
- Email: `admin@duguud.com`
- Password: `admin123`

## Project structure

```
DuGuud/
├── server/           ← Backend (Node.js + Express)
│   ├── src/
│   │   ├── index.js        ← Server entry point
│   │   ├── db.js           ← Database
│   │   ├── email.js        ← Email notifications
│   │   ├── seed.js         ← Product data
│   │   ├── middleware/
│   │   ├── routes/         ← API routes
│   │   └── ...
│   ├── data/               ← SQLite database file
│   ├── .env                ← Config (credentials)
│   └── package.json
├── index.html         ← Storefront
├── admin.html         ← Admin panel
├── product.html       ← Product detail pages
├── register.html      ← Login / Register
├── store.js           ← Cart, checkout, shared logic
├── api.js             ← Connects frontend to backend
└── images/            ← Product images
```

## Current features

- Product storefront with cart
- User registration + login
- Admin panel (manage products, orders, users)
- PayFast payments (sandbox mode — switch to live when ready)
- R85 shipping (free over R850)
- Order tracking at /track
- Password reset for users
- SEO (sitemap, robots.txt, structured data)

## To-do before going live

See the full checklist in memory file at:
`.claude\projects\C--Users-theun-OneDrive-Documents-DuGuud\memory\duguud-project.md`

But the short version:
1. Buy domain at **domains.co.za** (~R150/year for .co.za)
2. Deploy to **Railway.app** (easiest, ~$5/month)
3. Set PayFast passphrase on PayFast's website
4. Switch PayFast to live mode
5. Submit sitemap to Google Search Console
