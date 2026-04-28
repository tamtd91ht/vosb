package com.smpp.worker;

import com.smpp.core.domain.Channel;
import com.smpp.core.domain.Route;
import com.smpp.core.repository.RouteRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/**
 * Two-phase route resolution:
 *
 *  Phase 1 — carrier-based: look up carrier from destAddr (in-memory, O(32)),
 *             then find a route with matching (partner_id, carrier). Fast path.
 *
 *  Phase 2 — prefix-based fallback: find all enabled, carrier-less routes for
 *             the partner sorted by (priority DESC, msisdnPrefix DESC) and pick
 *             the first whose prefix matches the destAddr (longest prefix wins).
 *             Empty prefix "" acts as wildcard.
 */
@Service
public class RouteResolver {

    private static final Logger log = LoggerFactory.getLogger(RouteResolver.class);

    private final RouteRepository routeRepo;
    private final CarrierResolver carrierResolver;

    public RouteResolver(RouteRepository routeRepo, CarrierResolver carrierResolver) {
        this.routeRepo = routeRepo;
        this.carrierResolver = carrierResolver;
    }

    @Transactional(readOnly = true)
    public Optional<Channel> resolve(Long partnerId, String destAddr) {
        // Phase 1: carrier-based route
        Optional<String> carrier = carrierResolver.resolve(destAddr);
        if (carrier.isPresent()) {
            Optional<Route> carrierRoute =
                    routeRepo.findByPartnerIdAndCarrierAndEnabledTrue(partnerId, carrier.get());
            if (carrierRoute.isPresent()) {
                Channel ch = carrierRoute.get().getChannel();
                hydrate(ch);
                log.debug("Carrier route matched: partner={} carrier={} channel={}",
                        partnerId, carrier.get(), ch.getCode());
                return Optional.of(ch);
            }
            log.debug("No carrier route for partner={} carrier={}, falling back to prefix",
                    partnerId, carrier.get());
        }

        // Phase 2: prefix-based fallback (carrier IS NULL routes only)
        List<Route> prefixRoutes =
                routeRepo.findByPartnerIdAndCarrierIsNullAndEnabledTrueOrderByPriorityDescMsisdnPrefixDesc(partnerId);
        for (Route r : prefixRoutes) {
            String prefix = r.getMsisdnPrefix();
            if (prefix.isEmpty() || destAddr.startsWith(prefix)) {
                Channel ch = r.getChannel();
                hydrate(ch);
                log.debug("Prefix route matched: partner={} prefix='{}' channel={}",
                        partnerId, prefix.isEmpty() ? "*" : prefix, ch.getCode());
                return Optional.of(ch);
            }
        }

        log.warn("No route found for partner={} dest={}", partnerId, destAddr);
        return Optional.empty();
    }

    private void hydrate(Channel ch) {
        // Access all fields used downstream while still inside the JPA session.
        ch.getId();
        ch.getCode();
        ch.getType();
        ch.getDeliveryType();
        ch.getConfig();
    }
}
