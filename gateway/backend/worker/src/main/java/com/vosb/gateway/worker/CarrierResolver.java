package com.vosb.gateway.worker;

import com.vosb.gateway.core.domain.CarrierPrefix;
import com.vosb.gateway.core.repository.CarrierPrefixRepository;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * Resolves a normalized E.164 destination address (e.g. "84905123456") to a carrier name
 * (VIETTEL / MOBIFONE / VINAPHONE / VIETNAMOBILE / GMOBILE / REDDI).
 *
 * Prefix table is small (~32 rows) and rarely changes, so it is loaded once at startup
 * into a sorted in-memory list — no Redis needed for this lookup.
 * Sorted by prefix length DESC so the longest match is always found first.
 */
@Service
public class CarrierResolver {

    private static final Logger log = LoggerFactory.getLogger(CarrierResolver.class);

    private final CarrierPrefixRepository repo;
    private volatile List<CarrierPrefix> sortedPrefixes = List.of();

    public CarrierResolver(CarrierPrefixRepository repo) {
        this.repo = repo;
    }

    @PostConstruct
    void init() {
        List<CarrierPrefix> all = repo.findAll();
        sortedPrefixes = all.stream()
                .sorted(Comparator.comparingInt((CarrierPrefix cp) -> cp.getPrefix().length()).reversed())
                .toList();
        log.info("CarrierResolver loaded {} prefix entries", sortedPrefixes.size());
    }

    /**
     * @param destAddr normalized E.164 without '+', e.g. "84905123456"
     * @return carrier name string, e.g. "MOBIFONE", or empty if no prefix matches
     */
    public Optional<String> resolve(String destAddr) {
        if (destAddr == null || destAddr.isBlank()) return Optional.empty();
        for (CarrierPrefix cp : sortedPrefixes) {
            if (destAddr.startsWith(cp.getPrefix())) {
                return Optional.of(cp.getCarrier());
            }
        }
        return Optional.empty();
    }
}
