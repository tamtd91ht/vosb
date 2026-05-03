package com.vosb.gateway.server.http.admin.partner;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vosb.gateway.core.domain.Partner;
import com.vosb.gateway.core.domain.enums.PartnerStatus;
import com.vosb.gateway.core.repository.AdminUserRepository;
import com.vosb.gateway.core.repository.MessageRepository;
import com.vosb.gateway.core.repository.PartnerRepository;
import com.vosb.gateway.server.http.admin.dto.PageResponse;
import com.vosb.gateway.server.http.common.BlockingDispatcher;
import com.vosb.gateway.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.List;
import java.util.Map;

@Component
public class PartnerHandlers {

    private static final ObjectMapper MAPPER = HandlerUtils.mapper();
    private static final List<String> ALLOWED_WEBHOOK_METHODS = List.of("GET", "POST", "PUT", "PATCH");

    private final PartnerRepository partnerRepo;
    private final MessageRepository messageRepo;
    private final AdminUserRepository adminUserRepo;
    private final BlockingDispatcher dispatcher;

    public PartnerHandlers(PartnerRepository partnerRepo,
                           MessageRepository messageRepo,
                           AdminUserRepository adminUserRepo,
                           BlockingDispatcher dispatcher) {
        this.partnerRepo = partnerRepo;
        this.messageRepo = messageRepo;
        this.adminUserRepo = adminUserRepo;
        this.dispatcher = dispatcher;
    }

    // POST /api/admin/partners
    public void create(RoutingContext ctx) {
        CreatePartnerRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, CreatePartnerRequest.class);
            validateCreate(req);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json; charset=utf-8")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"" + escape(e.getMessage()) + "\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            if (partnerRepo.existsByCode(req.code())) {
                throw new IllegalArgumentException("Partner code already exists: " + req.code());
            }
            Partner p = new Partner();
            p.setCode(req.code().toUpperCase());
            p.setName(req.name());
            if (req.dlrWebhook() != null) {
                p.setDlrWebhook(webhookToJson(req.dlrWebhook()));
            }
            return toResponse(partnerRepo.save(p));
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 201, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/admin/partners
    // Mặc định ẩn các đối tác đã soft-delete (is_deleted = true).
    public void list(RoutingContext ctx) {
        int page = HandlerUtils.getPage(ctx);
        int size = HandlerUtils.getSize(ctx);
        String statusParam = ctx.queryParams().get("status");

        dispatcher.executeAsync(() -> {
            PageRequest pr = PageRequest.of(page, size);
            Page<Partner> paged;
            if (statusParam != null && !statusParam.isBlank()) {
                PartnerStatus status = PartnerStatus.valueOf(statusParam.toUpperCase());
                paged = partnerRepo.findByIsDeletedFalseAndStatus(status, pr);
            } else {
                paged = partnerRepo.findByIsDeletedFalse(pr);
            }
            List<Map<String, Object>> items = paged.getContent().stream().map(this::toResponse).toList();
            return PageResponse.of(items, paged.getTotalElements(), page, size);
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/admin/partners/:id
    public void get(RoutingContext ctx) {
        long id = HandlerUtils.pathLong(ctx, "id");
        dispatcher.executeAsync(() -> {
            Partner p = partnerRepo.findByIdAndIsDeletedFalse(id)
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found: " + id));
            return toResponse(p);
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // PUT /api/admin/partners/:id
    public void update(RoutingContext ctx) {
        long id = HandlerUtils.pathLong(ctx, "id");
        UpdatePartnerRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, UpdatePartnerRequest.class);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json; charset=utf-8")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"Invalid request body\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            Partner p = partnerRepo.findByIdAndIsDeletedFalse(id)
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found: " + id));
            if (req.name() != null) p.setName(req.name());
            if (req.status() != null) p.setStatus(PartnerStatus.valueOf(req.status().toUpperCase()));
            if (req.dlrWebhook() != null) {
                validateWebhook(req.dlrWebhook());
                p.setDlrWebhook(webhookToJson(req.dlrWebhook()));
            }
            return toResponse(partnerRepo.save(p));
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // DELETE /api/admin/partners/:id
    //   ?hard=true  → hard delete (CASCADE smpp_account/api_key/route/partner_rate);
    //                 returns 409 if any message or admin_user still references the partner.
    //   default     → soft delete: set is_deleted = true.
    //                 Đối tác bị ẩn khỏi list/get/update; dữ liệu vẫn còn trong DB cho audit.
    public void delete(RoutingContext ctx) {
        long id = HandlerUtils.pathLong(ctx, "id");
        boolean hard = "true".equalsIgnoreCase(ctx.queryParams().get("hard"));

        dispatcher.executeAsync(() -> {
            Partner p = partnerRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found: " + id));
            if (hard) {
                long msgCount = messageRepo.countByPartnerId(id);
                long userCount = adminUserRepo.countByPartnerId(id);
                if (msgCount > 0 || userCount > 0) {
                    throw new IllegalStateException(
                            "Không thể xóa đối tác '" + p.getCode() + "': còn "
                                    + msgCount + " tin nhắn, "
                                    + userCount + " tài khoản tham chiếu. "
                                    + "Hãy tạm dừng hoặc xóa các phụ thuộc trước."
                    );
                }
                partnerRepo.deleteById(id);
            } else {
                if (p.isDeleted()) {
                    return null; // idempotent
                }
                p.setDeleted(true);
                partnerRepo.save(p);
            }
            return null;
        }).onSuccess(ignored -> ctx.response().setStatusCode(204).end())
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // ── Validation ────────────────────────────────────────────────────────────

    private void validateCreate(CreatePartnerRequest req) {
        if (req.code() == null || req.code().isBlank()) throw new IllegalArgumentException("code is required");
        if (req.name() == null || req.name().isBlank()) throw new IllegalArgumentException("name is required");
        if (req.dlrWebhook() != null) validateWebhook(req.dlrWebhook());
    }

    private void validateWebhook(DlrWebhookDto w) {
        if (w.url() == null || w.url().isBlank()) throw new IllegalArgumentException("dlr_webhook.url is required");
        try {
            URI uri = URI.create(w.url());
            String scheme = uri.getScheme();
            if (scheme == null || (!scheme.equals("http") && !scheme.equals("https"))) {
                throw new IllegalArgumentException("dlr_webhook.url must be http or https");
            }
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("dlr_webhook.url is not a valid URL: " + w.url());
        }
        if (w.method() != null && !ALLOWED_WEBHOOK_METHODS.contains(w.method().toUpperCase())) {
            throw new IllegalArgumentException("dlr_webhook.method must be one of: " + ALLOWED_WEBHOOK_METHODS);
        }
    }

    private JsonNode webhookToJson(DlrWebhookDto w) {
        return MAPPER.valueToTree(Map.of(
                "url", w.url(),
                "method", w.method() != null ? w.method().toUpperCase() : "POST",
                "headers", w.headers() != null ? w.headers() : Map.of()
        ));
    }

    private Map<String, Object> toResponse(Partner p) {
        return Map.of(
                "id", p.getId(),
                "code", p.getCode(),
                "name", p.getName(),
                "status", p.getStatus().name(),
                "dlr_webhook", p.getDlrWebhook() != null ? p.getDlrWebhook() : Map.of(),
                "balance", p.getBalance(),
                "created_at", p.getCreatedAt() != null ? p.getCreatedAt().toString() : "",
                "updated_at", p.getUpdatedAt() != null ? p.getUpdatedAt().toString() : ""
        );
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    // ── DTOs ─────────────────────────────────────────────────────────────────

    public record DlrWebhookDto(
            String url,
            String method,
            Map<String, String> headers
    ) {}

    public record CreatePartnerRequest(
            String code,
            String name,
            @JsonProperty("dlr_webhook") DlrWebhookDto dlrWebhook
    ) {}

    public record UpdatePartnerRequest(
            String name,
            String status,
            @JsonProperty("dlr_webhook") DlrWebhookDto dlrWebhook
    ) {}
}
