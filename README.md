# Event Tracking API

Node.js + Express + MySQL starter setup using TypeScript.

## 1) Setup

1. Copy `.env` to `.env`
2. Update DB credentials in `.env`
3. Install dependencies:

```bash
npm install
```

## 2) Run

```bash
npm run dev
```

## 3) Build + Start

```bash
npm run build
npm start
```

## 4) Test endpoint

- `GET /health`


## 5) Default admin (automatic)

On startup, if there is **no** user with role `admin`, the API creates one using `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env.development` (see `src/seed/ensureDefaultAdmin.ts`). Set those before the first run.

Optional manual seed (same logic):

```bash
npm run seed:admin
```

