package com.smpp.core.service;

import com.smpp.core.domain.ChannelRate;
import com.smpp.core.domain.PartnerRate;
import com.smpp.core.domain.enums.DeliveryType;
import com.smpp.core.repository.ChannelRateRepository;
import com.smpp.core.repository.PartnerRateRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Resolves applicable rates using a three-level fallback hierarchy that mirrors RouteResolver:
 *
 *   1. Carrier-specific rate  (carrier = X)
 *   2. Prefix-specific rate   (carrier IS NULL, prefix = Y)   — for prefix-based routes
 *   3. Wildcard/default rate  (carrier IS NULL, prefix = '')
 *
 * Used both for billing lookup (worker, Phase 5+) and for advisory coverage checks
 * at route-creation time (smpp-server admin API).
 */
@Service
public class RateResolver {

    private final ChannelRateRepository channelRateRepo;
    private final PartnerRateRepository partnerRateRepo;

    public RateResolver(ChannelRateRepository channelRateRepo,
                        PartnerRateRepository partnerRateRepo) {
        this.channelRateRepo = channelRateRepo;
        this.partnerRateRepo = partnerRateRepo;
    }

    // ── Channel rate (cost: VSO → provider) ──────────────────────────────────

    @Transactional(readOnly = true)
    public Optional<ChannelRate> resolveChannelRate(Long channelId, String carrier, String msisdnPrefix) {
        LocalDate today = LocalDate.now();

        // 1. Carrier-specific
        if (carrier != null && !carrier.isBlank()) {
            List<ChannelRate> rates = channelRateRepo.findActiveByChannelAndCarrier(channelId, carrier, today);
            if (!rates.isEmpty()) return Optional.of(rates.get(0));
        }
        // 2. Prefix-specific
        if (msisdnPrefix != null && !msisdnPrefix.isBlank()) {
            List<ChannelRate> rates = channelRateRepo.findActiveByChannelAndPrefix(channelId, msisdnPrefix, today);
            if (!rates.isEmpty()) return Optional.of(rates.get(0));
        }
        // 3. Wildcard default
        List<ChannelRate> wildcards = channelRateRepo.findActiveWildcardByChannel(channelId, today);
        return wildcards.isEmpty() ? Optional.empty() : Optional.of(wildcards.get(0));
    }

    // ── Partner rate (revenue: partner → VSO) ────────────────────────────────

    @Transactional(readOnly = true)
    public Optional<PartnerRate> resolvePartnerRate(Long partnerId, DeliveryType deliveryType,
                                                    String carrier, String msisdnPrefix) {
        LocalDate today = LocalDate.now();

        // 1. Carrier-specific
        if (carrier != null && !carrier.isBlank()) {
            List<PartnerRate> rates = partnerRateRepo
                    .findActiveByPartnerAndTypeAndCarrier(partnerId, deliveryType, carrier, today);
            if (!rates.isEmpty()) return Optional.of(rates.get(0));
        }
        // 2. Prefix-specific
        if (msisdnPrefix != null && !msisdnPrefix.isBlank()) {
            List<PartnerRate> rates = partnerRateRepo
                    .findActiveByPartnerAndTypeAndPrefix(partnerId, deliveryType, msisdnPrefix, today);
            if (!rates.isEmpty()) return Optional.of(rates.get(0));
        }
        // 3. Wildcard default
        List<PartnerRate> wildcards = partnerRateRepo
                .findActiveWildcardByPartnerAndType(partnerId, deliveryType, today);
        return wildcards.isEmpty() ? Optional.empty() : Optional.of(wildcards.get(0));
    }

    // ── Advisory coverage check ───────────────────────────────────────────────

    /**
     * Returns human-readable warning strings for any rate gaps.
     * Empty list = fully covered.
     * Called at route creation time — does NOT block the operation.
     */
    @Transactional(readOnly = true)
    public List<String> checkCoverage(Long channelId, Long partnerId, DeliveryType deliveryType,
                                      String carrier, String msisdnPrefix) {
        List<String> warnings = new ArrayList<>();
        String target = buildTargetLabel(carrier, msisdnPrefix);

        if (resolveChannelRate(channelId, carrier, msisdnPrefix).isEmpty()) {
            warnings.add("No active channel rate for " + target
                    + " — provider cost will not be tracked");
        }
        if (resolvePartnerRate(partnerId, deliveryType, carrier, msisdnPrefix).isEmpty()) {
            warnings.add("No active partner rate for " + target
                    + " — messages will not be billed");
        }
        return warnings;
    }

    private static String buildTargetLabel(String carrier, String msisdnPrefix) {
        if (carrier != null && !carrier.isBlank()) return "carrier=" + carrier;
        if (msisdnPrefix != null && !msisdnPrefix.isBlank()) return "prefix=" + msisdnPrefix;
        return "wildcard (default)";
    }
}
