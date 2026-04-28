package com.smpp.server.http.admin.user;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.smpp.core.domain.AdminUser;
import com.smpp.core.domain.Partner;
import com.smpp.core.domain.enums.AdminRole;
import com.smpp.core.repository.AdminUserRepository;
import com.smpp.core.repository.PartnerRepository;
import com.smpp.core.security.PasswordHasher;
import com.smpp.server.http.admin.dto.PageResponse;
import com.smpp.server.http.common.BlockingDispatcher;
import com.smpp.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class UserHandlers {

    private final AdminUserRepository userRepo;
    private final PartnerRepository partnerRepo;
    private final PasswordHasher passwordHasher;
    private final BlockingDispatcher dispatcher;

    public UserHandlers(AdminUserRepository userRepo,
                        PartnerRepository partnerRepo,
                        PasswordHasher passwordHasher,
                        BlockingDispatcher dispatcher) {
        this.userRepo = userRepo;
        this.partnerRepo = partnerRepo;
        this.passwordHasher = passwordHasher;
        this.dispatcher = dispatcher;
    }

    // GET /api/admin/users
    public void list(RoutingContext ctx) {
        int page = HandlerUtils.getPage(ctx);
        int size = HandlerUtils.getSize(ctx);
        dispatcher.executeAsync(() -> {
            Page<AdminUser> paged = userRepo.findAll(PageRequest.of(page, size));
            List<Map<String, Object>> items = paged.getContent().stream().map(this::toResponse).toList();
            return PageResponse.of(items, paged.getTotalElements(), page, size);
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/admin/users/:id
    public void get(RoutingContext ctx) {
        long id = HandlerUtils.pathLong(ctx, "id");
        dispatcher.executeAsync(() -> {
            AdminUser user = userRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("User not found: " + id));
            return toResponse(user);
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // POST /api/admin/users
    public void create(RoutingContext ctx) {
        CreateUserRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, CreateUserRequest.class);
            validateCreate(req);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"" + escape(e.getMessage()) + "\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            if (userRepo.existsByUsername(req.username())) {
                throw new IllegalArgumentException("Username already exists: " + req.username());
            }
            AdminRole role = AdminRole.valueOf(req.role().toUpperCase());
            AdminUser user = new AdminUser();
            user.setUsername(req.username());
            user.setPasswordHash(passwordHasher.hash(req.password()));
            user.setRole(role);

            if (role == AdminRole.PARTNER) {
                if (req.partnerId() == null) throw new IllegalArgumentException("partner_id required for PARTNER role");
                Partner partner = partnerRepo.findById(req.partnerId())
                        .orElseThrow(() -> new EntityNotFoundException("Partner not found: " + req.partnerId()));
                user.setPartner(partner);
            }
            return toResponse(userRepo.save(user));
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 201, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // PUT /api/admin/users/:id
    public void update(RoutingContext ctx) {
        long id = HandlerUtils.pathLong(ctx, "id");
        UpdateUserRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, UpdateUserRequest.class);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"Invalid request body\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            AdminUser user = userRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("User not found: " + id));
            if (req.password() != null && !req.password().isBlank()) {
                user.setPasswordHash(passwordHasher.hash(req.password()));
            }
            if (req.enabled() != null) user.setEnabled(req.enabled());
            return toResponse(userRepo.save(user));
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private void validateCreate(CreateUserRequest req) {
        if (req.username() == null || req.username().isBlank()) throw new IllegalArgumentException("username required");
        if (req.password() == null || req.password().isBlank()) throw new IllegalArgumentException("password required");
        if (req.role() == null || req.role().isBlank()) throw new IllegalArgumentException("role required");
        try {
            AdminRole.valueOf(req.role().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid role: " + req.role() + ". Must be ADMIN or PARTNER");
        }
    }

    private Map<String, Object> toResponse(AdminUser u) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", u.getId());
        m.put("username", u.getUsername());
        m.put("role", u.getRole().name());
        m.put("partner_id", u.getPartner() != null ? u.getPartner().getId() : null);
        m.put("enabled", u.isEnabled());
        m.put("last_login_at", u.getLastLoginAt() != null ? u.getLastLoginAt().toString() : null);
        m.put("created_at", u.getCreatedAt() != null ? u.getCreatedAt().toString() : "");
        return m;
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public record CreateUserRequest(
            String username,
            String password,
            String role,
            @JsonProperty("partner_id") Long partnerId
    ) {}

    public record UpdateUserRequest(
            String password,
            Boolean enabled
    ) {}
}
