# Investco / EDP – Portal Corporativo
- `public/` com páginas do site (PWA).
- API Express em `server.js`.
- Docker Compose com MySQL.

## Local (mock)
npm install
MOCK_DB=1 node server.js
# http://localhost:8080/index.html

## Docker (MySQL)
docker compose up --build
# Web: http://localhost:8088/index.html
# Inventário: http://localhost:8088/inventario.html
