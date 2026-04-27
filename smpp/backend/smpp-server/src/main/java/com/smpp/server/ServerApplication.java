package com.smpp.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Spring Boot bootstrap. KHÔNG sử dụng Spring MVC — toàn bộ HTTP layer dùng Vert.x Web
 * (xem ADR-010 + .claude/rules/vertx-rest.md). Spring Boot ở đây chỉ giữ vai trò:
 * lifecycle, DI, config binding, JPA/AMQP/Redis auto-config từ module `core`.
 */
@SpringBootApplication
public class ServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(ServerApplication.class, args);
    }
}
