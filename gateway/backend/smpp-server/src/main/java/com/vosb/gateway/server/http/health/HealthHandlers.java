package com.vosb.gateway.server.http.health;

import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.connection.Connection;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * /healthz — ping Postgres + Redis + RabbitMQ song song trên worker pool, return 200 nếu all UP, 503 nếu bất kỳ DOWN.
 * /readyz — flag set bởi {@link ApplicationReadyEvent} listener; trả 200 sau khi context lên đủ.
 *
 * KHÔNG dùng Spring Boot Actuator (xem ADR-011 + .claude/rules/vertx-rest.md).
 */
@Component
public class HealthHandlers {

    private static final Logger log = LoggerFactory.getLogger(HealthHandlers.class);

    private final DataSource dataSource;
    private final RedisConnectionFactory redisConnectionFactory;
    private final ConnectionFactory rabbitConnectionFactory;
    private final AtomicBoolean ready = new AtomicBoolean(false);

    public HealthHandlers(DataSource dataSource,
                          RedisConnectionFactory redisConnectionFactory,
                          ConnectionFactory rabbitConnectionFactory) {
        this.dataSource = dataSource;
        this.redisConnectionFactory = redisConnectionFactory;
        this.rabbitConnectionFactory = rabbitConnectionFactory;
    }

    @EventListener
    public void onApplicationReady(ApplicationReadyEvent event) {
        ready.set(true);
        log.info("Application is ready — /readyz will return 200.");
    }

    public void healthz(RoutingContext ctx) {
        ctx.vertx().<JsonObject>executeBlocking(promise -> {
            JsonObject status = new JsonObject();
            String db = checkDb();
            String redis = checkRedis();
            String rabbit = checkRabbit();
            status.put("db", db).put("redis", redis).put("rabbit", rabbit);
            boolean allUp = "UP".equals(db) && "UP".equals(redis) && "UP".equals(rabbit);
            status.put("status", allUp ? "UP" : "DOWN");
            promise.complete(status);
        }, false).onComplete(ar -> {
            if (ar.failed()) {
                ctx.fail(503, ar.cause());
                return;
            }
            JsonObject result = ar.result();
            int code = "UP".equals(result.getString("status")) ? 200 : 503;
            ctx.response()
                    .setStatusCode(code)
                    .putHeader("Content-Type", "application/json")
                    .end(result.encode());
        });
    }

    public void readyz(RoutingContext ctx) {
        boolean isReady = ready.get();
        ctx.response()
                .setStatusCode(isReady ? 200 : 503)
                .putHeader("Content-Type", "application/json")
                .end(new JsonObject().put("ready", isReady).encode());
    }

    private String checkDb() {
        try (var conn = dataSource.getConnection();
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery("SELECT 1")) {
            return rs.next() ? "UP" : "DOWN";
        } catch (Exception e) {
            log.debug("DB health check failed: {}", e.getMessage());
            return "DOWN";
        }
    }

    private String checkRedis() {
        try (RedisConnection conn = redisConnectionFactory.getConnection()) {
            String pong = conn.ping();
            return "PONG".equalsIgnoreCase(pong) ? "UP" : "DOWN";
        } catch (Exception e) {
            log.debug("Redis health check failed: {}", e.getMessage());
            return "DOWN";
        }
    }

    private String checkRabbit() {
        try {
            Connection conn = rabbitConnectionFactory.createConnection();
            try {
                return conn.isOpen() ? "UP" : "DOWN";
            } finally {
                conn.close();
            }
        } catch (Exception e) {
            log.debug("RabbitMQ health check failed: {}", e.getMessage());
            return "DOWN";
        }
    }
}
