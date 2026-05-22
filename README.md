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


## 5) Admin user

On `npm run dev` or `npm start`, the server creates the first admin automatically when none exists, using `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env.development`.

Optional manual seed (same logic):

```bash
npm run seed:admin
```

