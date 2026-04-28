package com.smpp.server.http.admin.carrier;

import com.smpp.core.domain.CarrierPrefix;
import com.smpp.core.repository.CarrierPrefixRepository;
import com.smpp.server.http.common.BlockingDispatcher;
import com.smpp.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.stream.Collectors;

@Component
public class CarrierHandlers {

    private final CarrierPrefixRepository repo;
    private final BlockingDispatcher dispatcher;

    public CarrierHandlers(CarrierPrefixRepository repo, BlockingDispatcher dispatcher) {
        this.repo = repo;
        this.dispatcher = dispatcher;
    }

    // GET /api/admin/carriers
    public void list(RoutingContext ctx) {
        dispatcher.executeAsync(() -> {
            List<CarrierPrefix> all = repo.findAll();
            Map<String, List<String>> grouped = new LinkedHashMap<>();
            // canonical order
            for (String c : List.of("VIETTEL", "MOBIFONE", "VINAPHONE", "VIETNAMOBILE", "GMOBILE", "REDDI")) {
                grouped.put(c, new ArrayList<>());
            }
            for (CarrierPrefix cp : all) {
                grouped.computeIfAbsent(cp.getCarrier(), k -> new ArrayList<>()).add(cp.getPrefix());
            }
            List<Map<String, Object>> result = grouped.entrySet().stream()
                    .filter(e -> !e.getValue().isEmpty())
                    .map(e -> {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("code", e.getKey());
                        m.put("name", carrierDisplayName(e.getKey()));
                        m.put("prefixes", e.getValue().stream().sorted().toList());
                        return m;
                    })
                    .toList();
            return result;
        }).onSuccess(r -> HandlerUtils.respondJson(ctx, 200, r))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    private static String carrierDisplayName(String code) {
        return switch (code) {
            case "VIETTEL"      -> "Viettel";
            case "MOBIFONE"     -> "MobiFone";
            case "VINAPHONE"    -> "VinaPhone";
            case "VIETNAMOBILE" -> "Vietnamobile";
            case "GMOBILE"      -> "Gmobile";
            case "REDDI"        -> "Reddi";
            default             -> code;
        };
    }
}
