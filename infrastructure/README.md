# infrastructure — Local dev data services

Docker Compose stack chạy **Postgres 16**, **Redis 7**, **RabbitMQ 3.13** trên máy
dev. Gateway backend (`gateway/backend/`) kết nối qua `localhost:<port>` mà không
cần override env — credential default đã khớp.

> Stack này **chỉ dùng cho local dev**. Prod có infra riêng trên server, mô tả
> trong `gateway/docs/infras.md` — KHÔNG động vào.

## Yêu cầu

- Docker Desktop (Windows) hoặc Docker Engine + Compose v2.
- Port `5432`, `6379`, `5672`, `15672` không bị chiếm trên `127.0.0.1`.

## Khởi động

```bash
cd infrastructure
docker compose up -d
docker compose ps
```

Kiểm tra health:

```bash
docker compose exec postgres pg_isready -U smpp_user -d smpp_db
docker compose exec redis redis-cli ping
docker compose exec rabbitmq rabbitmq-diagnostics -q ping
```

## Endpoint

| Service     | Host                | Port    | Credential                |
|-------------|---------------------|---------|---------------------------|
| Postgres    | `127.0.0.1`         | `5432`  | `smpp_user` / `smpp_pass` (db `smpp_db`) |
| Redis       | `127.0.0.1`         | `6379`  | (no password)             |
| RabbitMQ    | `127.0.0.1`         | `5672`  | `smpp_admin` / `smpp_pass` (vhost `/`) |
| RabbitMQ UI | http://127.0.0.1:15672 |      | `smpp_admin` / `smpp_pass` |

## Tắt / xoá

```bash
docker compose down          # stop, GIỮ data trong named volume
docker compose down -v       # CẨN THẬN: xoá volume → mất toàn bộ data
```

## Override credential

```bash
cp .env.example .env
# chỉnh sửa .env
docker compose up -d
```

Nếu đổi password ở đây, phải truyền cùng env vars khi chạy backend (
`DB_PASSWORD`, `REDIS_PASSWORD`, `RABBITMQ_PASSWORD`).

## Backend chạy trong Docker

Compose tạo network `infra-net` (Docker name = `infra-net`, không prefix).
File `gateway/backend/docker-compose.yml` đã khai báo `networks.infra-net.external: true`,
nên có thể up backend chung network. Khi đó backend dùng DNS name để kết nối:

- `DB_HOST=vosb-postgres` (hoặc đổi container_name về `postgres` trùng prod).
- `REDIS_HOST=vosb-redis`
- `RABBITMQ_HOST=vosb-rabbitmq`

> Lưu ý: backend prod compose dùng tên `postgres`/`redis`/`rabbitmq`. Local đặt
> prefix `vosb-` để tránh đụng container khác đang chạy. Nếu muốn align hoàn toàn
> với prod, đổi `container_name` trong `docker-compose.yml`.

## Data persistence

Dùng Docker named volume:

- `vosb-infra_postgres-data`
- `vosb-infra_redis-data`
- `vosb-infra_rabbitmq-data`

`docker volume ls` để xem; data còn cho tới khi `down -v`.
