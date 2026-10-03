# polina-shvedko.art

Static portfolio site of the artist Polina Shvedko, generated from `data.json` into `app/`.
Details: `CLAUDE.md` (architecture, commands, data model) and `ADR/` (decisions).

## Docker

- `docker-compose up -d` (installs the dependencies, builds the site, serves http://localhost:7000)
- `docker ps` -> container ID
- `docker exec -it CONTAINER_ID bash`
- `npm run server-watch`

## Without Docker (Node 22)

- `npm ci --legacy-peer-deps`
- `npm run build:site` (pages, CSS, JS, hosting files) or `npm run build` (also the image variants)
- `npm run serve` -> http://127.0.0.1:7001
- `npm test` (static checks, Playwright browser checks, Apache redirect checks in Docker)

A push to `main` deploys the site.
