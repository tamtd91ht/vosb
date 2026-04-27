# Rule: Server safety constraints

Server prod: `116.118.2.74` (Ubuntu 24.04). SSH user `tamtd`, key `D:\works\tkc-02\.ssh\tamtd`.

## Cấm (trừ khi user yêu cầu rõ ràng từng lần)

- SSH chạy lệnh ghi/restart trên server (`sudo`, `systemctl restart`, `docker restart`, `docker compose up`, ...).
- `docker compose down -v` (mất volume, mất data Postgres/Redis/RabbitMQ).
- Sửa file trong `~/apps/infrastructure/` trên server.
- Mở port mới ngoài `80`, `443`, `2775` ra public qua UFW.
- Expose Postgres `5432`, Redis `6379`, RabbitMQ AMQP `5672` ra public.
- Expose `/actuator/*` qua Nginx public — chỉ cho phép qua loopback `127.0.0.1`.
- `git push --force` lên `main`.

## Được phép tự động

- SSH read-only: `docker compose ps`, `docker compose logs --tail`, `df -h`, `free -m`, `uptime`, `journalctl --no-pager -n 100`.
- SSH tunnel cho UI nội bộ: `ssh -L 15672:127.0.0.1:15672 ...` (RabbitMQ Management).
- `git log`, `git diff`, `git status` ở mọi repo.

## Khi không chắc

→ Hỏi user trước khi chạy lệnh có thể ghi/restart/mất data. Cost của 1 câu hỏi là thấp; cost của 1 lệnh sai trên server prod là rất cao.
