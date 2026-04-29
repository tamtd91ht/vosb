package com.vosb.gateway.server.http.portal.smpp;

import com.vosb.gateway.core.domain.PartnerSmppAccount;
import com.vosb.gateway.core.repository.PartnerSmppAccountRepository;
import com.vosb.gateway.core.security.PasswordHasher;
import com.vosb.gateway.server.auth.AuthContext;
import com.vosb.gateway.server.auth.JwtAuthHandler;
import com.vosb.gateway.server.http.common.BlockingDispatcher;
import com.vosb.gateway.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class PortalSmppHandlers {

    private final PartnerSmppAccountRepository smppRepo;
    private final PasswordHasher passwordHasher;
    private final BlockingDispatcher dispatcher;

    public PortalSmppHandlers(PartnerSmppAccountRepository smppRepo,
                              PasswordHasher passwordHasher,
                              BlockingDispatcher dispatcher) {
        this.smppRepo = smppRepo;
        this.passwordHasher = passwordHasher;
        this.dispatcher = dispatcher;
    }

    // GET /api/portal/smpp-accounts
    public void list(RoutingContext ctx) {
        AuthContext auth = JwtAuthHandler.from(ctx);
        Long partnerId = auth.partnerId();
        if (partnerId == null) { ctx.fail(403); return; }

        dispatcher.executeAsync(() -> {
            List<Map<String, Object>> items = smppRepo.findByPartnerId(partnerId)
                    .stream().map(this::toResponse).toList();
            return items;
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // POST /api/portal/smpp-accounts/:id/change-password
    public void changePassword(RoutingContext ctx) {
        AuthContext auth = JwtAuthHandler.from(ctx);
        Long partnerId = auth.partnerId();
        if (partnerId == null) { ctx.fail(403); return; }

        long id = HandlerUtils.pathLong(ctx, "id");
        Map<?, ?> body;
        try {
            body = HandlerUtils.parseBody(ctx, Map.class);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"Invalid request body\"}");
            return;
        }

        String newPassword = body.get("new_password") != null ? body.get("new_password").toString() : null;
        if (newPassword == null || newPassword.length() < 8) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"new_password must be at least 8 characters\"}");
            return;
        }
        final String finalPassword = newPassword;

        dispatcher.executeAsync(() -> {
            PartnerSmppAccount account = smppRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("SMPP account not found: " + id));
            // IDOR guard
            if (!account.getPartner().getId().equals(partnerId)) {
                throw new EntityNotFoundException("SMPP account not found: " + id);
            }
            account.setPasswordHash(passwordHasher.hash(finalPassword));
            smppRepo.save(account);
            return null;
        }).onSuccess(ignored -> HandlerUtils.respondJson(ctx, 200, Map.of("message", "Password updated successfully")))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    private Map<String, Object> toResponse(PartnerSmppAccount a) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", a.getId());
        m.put("system_id", a.getSystemId());
        m.put("max_binds", a.getMaxBinds());
        m.put("ip_whitelist", a.getIpWhitelist());
        m.put("status", a.getStatus().name());
        m.put("created_at", a.getCreatedAt() != null ? a.getCreatedAt().toString() : null);
        return m;
    }
}
