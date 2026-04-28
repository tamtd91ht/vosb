package com.smpp.server.http.admin.partner;

import com.smpp.core.domain.Partner;
import com.smpp.core.domain.PartnerRate;
import com.smpp.core.domain.enums.DeliveryType;
import com.smpp.core.domain.enums.RateUnit;
import com.smpp.core.repository.PartnerRateRepository;
import com.smpp.core.repository.PartnerRepository;
import com.smpp.server.http.common.BlockingDispatcher;
import com.smpp.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class PartnerRateHandlers {

    private final PartnerRateRepository rateRepo;
    private final PartnerRepository partnerRepo;
    private final BlockingDispatcher dispatcher;

    public PartnerRateHandlers(PartnerRateRepository rateRepo,
                               PartnerRepository partnerRepo,
                               BlockingDispatcher dispatcher) {
        this.rateRepo = rateRepo;
        this.partnerRepo = partnerRepo;
        this.dispatcher = dispatcher;
    }

    // GET /api/admin/partners/:partnerId/rates
    public void list(RoutingContext ctx) {
        long partnerId = HandlerUtils.pathLong(ctx, "partnerId");
        String deliveryTypeParam = ctx.queryParams().get("delivery_type");
        dispatcher.executeAsync(() -> {
            partnerRepo.findById(partnerId)
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found: " + partnerId));
            List<PartnerRate> rates;
            if (deliveryTypeParam != null) {
                DeliveryType dt = DeliveryType.valueOf(deliveryTypeParam.toUpperCase());
                rates = rateRepo.findByPartnerIdAndDeliveryTypeOrderByPrefixDescEffectiveFromDesc(partnerId, dt);
            } else {
                rates = rateRepo.findByPartnerIdOrderByDeliveryTypeAscPrefixDescEffectiveFromDesc(partnerId);
            }
            return rates.stream().map(this::toResponse).toList();
        }).onSuccess(r -> HandlerUtils.respondJson(ctx, 200, r))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // POST /api/admin/partners/:partnerId/rates
    public void create(RoutingContext ctx) {
        long partnerId = HandlerUtils.pathLong(ctx, "partnerId");
        RateRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, RateRequest.class);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"" + escape(e.getMessage()) + "\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            Partner partner = partnerRepo.findById(partnerId)
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found: " + partnerId));
            PartnerRate r = new PartnerRate();
            r.setPartner(partner);
            r.setDeliveryType(req.delivery_type() != null
                    ? DeliveryType.valueOf(req.delivery_type().toUpperCase())
                    : DeliveryType.SMS);
            r.setCarrier(req.carrier() != null ? req.carrier().toUpperCase() : null);
            r.setPrefix(req.carrier() != null ? "" : (req.prefix() != null ? req.prefix() : ""));
            r.setRate(new BigDecimal(String.valueOf(req.rate())));
            r.setCurrency(req.currency() != null ? req.currency() : "VND");
            r.setUnit(req.unit() != null ? RateUnit.valueOf(req.unit().toUpperCase()) : RateUnit.MESSAGE);
            r.setEffectiveFrom(req.effective_from() != null ? LocalDate.parse(req.effective_from()) : LocalDate.now());
            r.setEffectiveTo(req.effective_to() != null ? LocalDate.parse(req.effective_to()) : null);
            return toResponse(rateRepo.save(r));
        }).onSuccess(r -> HandlerUtils.respondJson(ctx, 201, r))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // PUT /api/admin/partners/:partnerId/rates/:rateId
    public void update(RoutingContext ctx) {
        long partnerId = HandlerUtils.pathLong(ctx, "partnerId");
        long rateId = HandlerUtils.pathLong(ctx, "rateId");
        RateRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, RateRequest.class);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"" + escape(e.getMessage()) + "\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            PartnerRate r = rateRepo.findById(rateId)
                    .orElseThrow(() -> new EntityNotFoundException("Rate not found: " + rateId));
            if (!r.getPartner().getId().equals(partnerId))
                throw new EntityNotFoundException("Rate not found: " + rateId);
            if (req.delivery_type() != null) r.setDeliveryType(DeliveryType.valueOf(req.delivery_type().toUpperCase()));
            if (req.carrier() != null) {
                r.setCarrier(req.carrier().toUpperCase());
                r.setPrefix("");
            } else if (req.prefix() != null) {
                r.setPrefix(req.prefix());
                r.setCarrier(null);
            }
            if (req.rate() != null) r.setRate(new BigDecimal(String.valueOf(req.rate())));
            if (req.currency() != null) r.setCurrency(req.currency());
            if (req.unit() != null) r.setUnit(RateUnit.valueOf(req.unit().toUpperCase()));
            if (req.effective_from() != null) r.setEffectiveFrom(LocalDate.parse(req.effective_from()));
            r.setEffectiveTo(req.effective_to() != null ? LocalDate.parse(req.effective_to()) : null);
            return toResponse(rateRepo.save(r));
        }).onSuccess(r -> HandlerUtils.respondJson(ctx, 200, r))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // DELETE /api/admin/partners/:partnerId/rates/:rateId
    public void delete(RoutingContext ctx) {
        long partnerId = HandlerUtils.pathLong(ctx, "partnerId");
        long rateId = HandlerUtils.pathLong(ctx, "rateId");
        dispatcher.executeAsync(() -> {
            PartnerRate r = rateRepo.findById(rateId)
                    .orElseThrow(() -> new EntityNotFoundException("Rate not found: " + rateId));
            if (!r.getPartner().getId().equals(partnerId))
                throw new EntityNotFoundException("Rate not found: " + rateId);
            rateRepo.delete(r);
            return null;
        }).onSuccess(ignored -> ctx.response().setStatusCode(204).end())
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    private Map<String, Object> toResponse(PartnerRate r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.getId());
        m.put("partner_id", r.getPartner().getId());
        m.put("delivery_type", r.getDeliveryType().name());
        m.put("carrier", r.getCarrier());
        m.put("prefix", r.getPrefix());
        m.put("rate", r.getRate());
        m.put("currency", r.getCurrency());
        m.put("unit", r.getUnit().name());
        m.put("effective_from", r.getEffectiveFrom() != null ? r.getEffectiveFrom().toString() : null);
        m.put("effective_to", r.getEffectiveTo() != null ? r.getEffectiveTo().toString() : null);
        m.put("created_at", r.getCreatedAt() != null ? r.getCreatedAt().toString() : null);
        return m;
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public record RateRequest(String delivery_type, String carrier, String prefix, Object rate, String currency,
                              String unit, String effective_from, String effective_to) {}
}
