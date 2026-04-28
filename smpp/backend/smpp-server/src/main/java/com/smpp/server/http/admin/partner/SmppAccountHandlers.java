package com.smpp.server.http.admin.partner;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.smpp.core.domain.Partner;
import com.smpp.core.domain.PartnerSmppAccount;
import com.smpp.core.domain.enums.SmppAccountStatus;
import com.smpp.core.repository.PartnerRepository;
import com.smpp.core.repository.PartnerSmppAccountRepository;
import com.smpp.core.security.PasswordHasher;
import com.smpp.server.http.common.BlockingDispatcher;
import com.smpp.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

@Component
public class SmppAccountHandlers {

    private static final ObjectMapper MAPPER = HandlerUtils.mapper();

    private final PartnerRepository partnerRepo;
    private final PartnerSmppAccountRepository accountRepo;
    private final PasswordHasher passwordHasher;
    private final BlockingDispatcher dispatcher;

    public SmppAccountHandlers(PartnerRepository partnerRepo,
                               PartnerSmppAccountRepository accountRepo,
                               PasswordHasher passwordHasher,
                               BlockingDispatcher dispatcher) {
        this.partnerRepo = partnerRepo;
        this.accountRepo = accountRepo;
        this.passwordHasher = passwordHasher;
        this.dispatcher = dispatcher;
    }

    // POST /api/admin/partners/:partnerId/smpp-accounts
    public void create(RoutingContext ctx) {
        long partnerId = HandlerUtils.pathLong(ctx, "partnerId");
        CreateSmppAccountRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, CreateSmppAccountRequest.class);
            if (req.systemId() == null || req.systemId().isBlank()) throw new IllegalArgumentException("system_id required");
            if (req.password() == null || req.password().isBlank()) throw new IllegalArgumentException("password required");
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"" + escape(e.getMessage()) + "\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            Partner partner = partnerRepo.findById(partnerId)
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found: " + partnerId));
            if (accountRepo.existsBySystemId(req.systemId())) {
                throw new IllegalArgumentException("system_id already exists: " + req.systemId());
            }
            PartnerSmppAccount acc = new PartnerSmppAccount();
            acc.setPartner(partner);
            acc.setSystemId(req.systemId());
            acc.setPasswordHash(passwordHasher.hash(req.password()));
            acc.setMaxBinds(req.maxBinds() != null ? req.maxBinds() : 5);
            ArrayNode ipList = MAPPER.createArrayNode();
            if (req.ipWhitelist() != null) {
                req.ipWhitelist().forEach(ipList::add);
            }
            acc.setIpWhitelist(ipList);
            return toResponse(accountRepo.save(acc));
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 201, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/admin/partners/:partnerId/smpp-accounts
    public void list(RoutingContext ctx) {
        long partnerId = HandlerUtils.pathLong(ctx, "partnerId");
        dispatcher.executeAsync(() -> {
            partnerRepo.findById(partnerId)
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found: " + partnerId));
            List<Map<String, Object>> items = accountRepo.findByPartnerId(partnerId)
                    .stream().map(this::toResponse).toList();
            return items;
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/admin/partners/:partnerId/smpp-accounts/:id
    public void get(RoutingContext ctx) {
        long partnerId = HandlerUtils.pathLong(ctx, "partnerId");
        long id = HandlerUtils.pathLong(ctx, "id");
        dispatcher.executeAsync(() -> {
            PartnerSmppAccount acc = accountRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("SMPP account not found: " + id));
            if (!acc.getPartner().getId().equals(partnerId)) {
                throw new EntityNotFoundException("SMPP account not found: " + id);
            }
            return toResponse(acc);
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // DELETE /api/admin/partners/:partnerId/smpp-accounts/:id  (soft-delete → DISABLED)
    public void delete(RoutingContext ctx) {
        long partnerId = HandlerUtils.pathLong(ctx, "partnerId");
        long id = HandlerUtils.pathLong(ctx, "id");
        dispatcher.executeAsync(() -> {
            PartnerSmppAccount acc = accountRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("SMPP account not found: " + id));
            if (!acc.getPartner().getId().equals(partnerId)) {
                throw new EntityNotFoundException("SMPP account not found: " + id);
            }
            acc.setStatus(SmppAccountStatus.DISABLED);
            accountRepo.save(acc);
            return null;
        }).onSuccess(ignored -> ctx.response().setStatusCode(204).end())
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    private Map<String, Object> toResponse(PartnerSmppAccount acc) {
        return Map.of(
                "id", acc.getId(),
                "partner_id", acc.getPartner().getId(),
                "system_id", acc.getSystemId(),
                "max_binds", acc.getMaxBinds(),
                "ip_whitelist", acc.getIpWhitelist() != null ? acc.getIpWhitelist() : MAPPER.createArrayNode(),
                "status", acc.getStatus().name(),
                "created_at", acc.getCreatedAt() != null ? acc.getCreatedAt().toString() : ""
        );
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public record CreateSmppAccountRequest(
            @JsonProperty("system_id") String systemId,
            String password,
            @JsonProperty("max_binds") Integer maxBinds,
            @JsonProperty("ip_whitelist") List<String> ipWhitelist
    ) {}
}
