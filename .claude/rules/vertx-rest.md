# Rule: Vert.x for REST, Spring Boot for lifecycle

**HTTP/REST layer phải dùng Vert.x Web. KHÔNG dùng Spring MVC.**

## Phân vai trò

Spring Boot trong project chỉ giữ vai trò:
- Bootstrap (`@SpringBootApplication`, `SpringApplication.run`).
- Quản lý vòng đời bean (`@Component`, `@Service`, `@Repository`, `@Configuration`).
- Dependency injection (constructor injection ưu tiên, `@Autowired` chỉ khi cần).
- Load + binding config (`@ConfigurationProperties`, `application.yml`, `application-<profile>.yml`).
- Tích hợp ecosystem: Spring Data JPA, Spring AMQP (`@RabbitListener`), Flyway, Jackson `ObjectMapper`, Spring Boot Actuator.

Vert.x đảm nhận:
- HTTP server (`io.vertx.core.http.HttpServer`) lắng nghe `app.http.port` (default 8080).
- Routing (`io.vertx.ext.web.Router`).
- Body parsing (`BodyHandler`).
- Auth (`AuthenticationHandler` cho từng sub-router).
- Failure handler (`failureHandler` chuyển exception → RFC 7807 JSON).
- Outbound HTTP gọi 3rd-party (`io.vertx.ext.web.client.WebClient`) — **KHÔNG** dùng Spring `WebClient` của WebFlux.

## Layout chuẩn

```
smpp-server/src/main/java/com/smpp/server/
├── ServerApplication.java                // @SpringBootApplication, main()
├── config/
│   └── VertxConfig.java                  // @Configuration: @Bean Vertx, HttpServer, root Router; mount sub-routers
└── http/
    ├── partner/PartnerRouterFactory.java // @Component, exposes @Bean Router cho /api/v1/*
    ├── admin/AdminRouterFactory.java     // @Component, exposes @Bean Router cho /api/admin/*
    ├── portal/PortalRouterFactory.java   // @Component, exposes @Bean Router cho /api/portal/*
    ├── internal/InternalRouterFactory.java
    ├── auth/                             // ApiKeyHmacAuthHandler, JwtAuthHandler (Vert.x AuthenticationHandler)
    └── error/ProblemJsonFailureHandler.java
```

## Ví dụ skeleton

```java
@Configuration
public class VertxConfig {

    @Bean(destroyMethod = "close")
    public Vertx vertx() {
        return Vertx.vertx(new VertxOptions().setEventLoopPoolSize(Runtime.getRuntime().availableProcessors()));
    }

    @Bean
    public HttpServer httpServer(Vertx vertx,
                                 Router rootRouter,
                                 @Value("${app.http.port:8080}") int port) {
        HttpServer server = vertx.createHttpServer().requestHandler(rootRouter);
        server.listen(port).toCompletionStage().toCompletableFuture().join();
        return server;
    }

    @Bean
    public Router rootRouter(Vertx vertx,
                             @Qualifier("partnerRouter") Router partner,
                             @Qualifier("adminRouter")   Router admin,
                             @Qualifier("portalRouter")  Router portal,
                             @Qualifier("internalRouter") Router internal,
                             ObjectMapper mapper) {
        DatabindCodec.mapper().registerModules(mapper.getRegisteredModuleIds().stream().toList());

        Router root = Router.router(vertx);
        root.route().handler(BodyHandler.create());
        root.route("/api/v1/*").subRouter(partner);
        root.route("/api/admin/*").subRouter(admin);
        root.route("/api/portal/*").subRouter(portal);
        root.route("/api/internal/*").subRouter(internal);
        return root;
    }
}
```

## Cấm

- `spring-boot-starter-web` (kéo Tomcat + Spring MVC).
- `spring-boot-starter-webflux` trừ trường hợp duy nhất: cần Actuator endpoint qua HTTP server riêng (xem ADR-010 cho cách cuối cùng đã chọn).
- Annotation/class trong `org.springframework.web.*`: `@RestController`, `@GetMapping`, `@PostMapping`, `@RequestMapping`, `ResponseEntity`, `RestTemplate`, `MockMvc`, `WebClient` (WebFlux).
- `SecurityFilterChain`, `HttpSecurity`, `UsernamePasswordAuthenticationFilter` cho HTTP filter chain.
- Đặt handler trong package `controller/` — phải là `http/`.
- Block event loop (synchronous JPA/JDBC/file I/O ngay trong handler) — phải `vertx.executeBlocking(...)` hoặc dispatch sang `@Service` chạy trên thread pool riêng.

## Test

- Endpoint test dùng `vertx-junit5` + `WebClient` (Vert.x), KHÔNG `MockMvc`.
- Integration test khởi `Vertx` thật + Testcontainers cho Postgres/Redis/RabbitMQ.

Tham chiếu: ADR-010 trong `gateway/docs/decisions.md`.
