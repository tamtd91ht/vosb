package com.vosb.gateway.server.http.partner;

import com.vosb.gateway.core.domain.Partner;
import com.vosb.gateway.core.domain.PartnerRate;
import com.vosb.gateway.core.domain.enums.DeliveryType;
import com.vosb.gateway.core.repository.PartnerRateRepository;
import com.vosb.gateway.core.repository.PartnerRepository;
import com.vosb.gateway.server.auth.ApiKeyHmacAuthHandler;
import com.vosb.gateway.server.auth.PartnerContext;
import com.vosb.gateway.server.http.common.BlockingDispatcher;
import com.vosb.gateway.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Self-service endpoints cho partner: balance + rates.
 */
@Component
public class PartnerAccountHandlers {

    private final PartnerRepository partnerRepo;
    private final PartnerRateRepository partnerRateRepo;
    private final BlockingDispatcher blocking;

    public PartnerAccountHandlers(PartnerRepository partnerRepo,
                                  PartnerRateRepository partnerRateRepo,
                                  BlockingDispatcher blocking) {
        this.partnerRepo = partnerRepo;
        this.partnerRateRepo = partnerRateRepo;
        this.blocking = blocking;
    }

    // GET /api/v1/account
    public void account(RoutingContext ctx) {
        PartnerContext pc = ApiKeyHmacAuthHandler.from(ctx);
        blocking.executeAsync(() -> {
            Partner p = partnerRepo.findByIdAndIsDeletedFalse(pc.partnerId())
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found"));
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("partner_id", p.getId());
            r.put("code", p.getCode());
            r.put("name", p.getName());
            r.put("status", p.getStatus().name());
            r.put("balance", p.getBalance());
            r.put("currency", "VND");
            return r;
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/v1/rates?delivery_type=SMS|VOICE_OTP
    public void rates(RoutingContext ctx) {
        PartnerContext pc = ApiKeyHmacAuthHandler.from(ctx);
        String dtParam = ctx.queryParams().get("delivery_type");

        DeliveryType filter = null;
        if (dtParam != null && !dtParam.isBlank()) {
            try {
                filter = DeliveryType.valueOf(dtParam.toUpperCase());
            } catch (IllegalArgumentException e) {
                ctx.fail(400, new IllegalArgumentException(
                        "delivery_type must be SMS or VOICE_OTP"));
                return;
            }
        }
        final DeliveryType fFilter = filter;

        blocking.executeAsync(() -> {
            List<PartnerRate> all = partnerRateRepo.findAll();
            List<Map<String, Object>> items = all.stream()
                    .filter(r -> r.getPartner().getId().equals(pc.partnerId()))
                    .filter(r -> fFilter == null || r.getDeliveryType() == fFilter)
                    .map(this::toResponse)
                    .toList();
            return Map.of("items", items, "total", items.size());
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    private Map<String, Object> toResponse(PartnerRate r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("delivery_type", r.getDeliveryType().name());
        if (r.getCarrier() != null) {
            m.put("carrier", r.getCarrier());
        } else {
            m.put("prefix", r.getPrefix());
        }
        m.put("rate", r.getRate());
        m.put("currency", r.getCurrency());
        m.put("unit", r.getUnit().name());
        m.put("effective_from", r.getEffectiveFrom().toString());
        m.put("effective_to",
                r.getEffectiveTo() != null ? r.getEffectiveTo().toString() : null);
        return m;
    }
}
