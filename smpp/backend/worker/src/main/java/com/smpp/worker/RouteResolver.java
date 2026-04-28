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

@Service
public class RouteResolver {

    private static final Logger log = LoggerFactory.getLogger(RouteResolver.class);

    private final RouteRepository routeRepo;

    public RouteResolver(RouteRepository routeRepo) {
        this.routeRepo = routeRepo;
    }

    /**
     * Finds the best channel for a given partner + destination address.
     * Routes are pre-sorted: priority DESC, msisdnPrefix DESC (longest prefix wins on tie).
     * Matches if destAddr starts with route.msisdnPrefix, or prefix is empty (wildcard).
     */
    @Transactional(readOnly = true)
    public Optional<Channel> resolve(Long partnerId, String destAddr) {
        List<Route> routes = routeRepo
                .findByPartnerIdAndEnabledTrueOrderByPriorityDescMsisdnPrefixDesc(partnerId);

        for (Route r : routes) {
            String prefix = r.getMsisdnPrefix();
            if (prefix.isEmpty() || destAddr.startsWith(prefix)) {
                Channel ch = r.getChannel();
                // Access fields to hydrate the entity inside this transaction.
                ch.getId();
                ch.getDeliveryType();
                ch.getConfig();
                ch.getType();
                log.debug("Resolved route id={} channel={} for partner={} dest={}",
                        r.getId(), ch.getCode(), partnerId, destAddr);
                return Optional.of(ch);
            }
        }

        log.warn("No route found for partner={} dest={}", partnerId, destAddr);
        return Optional.empty();
    }
}
