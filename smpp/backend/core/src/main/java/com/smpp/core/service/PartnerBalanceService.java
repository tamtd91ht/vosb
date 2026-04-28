package com.smpp.core.service;

import com.smpp.core.domain.PartnerRate;
import com.smpp.core.domain.enums.DeliveryType;
import com.smpp.core.repository.PartnerRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

/**
 * Charges a partner for a successfully dispatched message by deducting
 * the matching {@link PartnerRate#getRate()} from {@code partner.balance}.
 *
 * No throw on missing rate or insufficient balance — those cases log a warning
 * and leave the message in {@code SUBMITTED} state. Strict pre-paid enforcement
 * (reject when balance is too low) belongs to a later phase.
 */
@Service
public class PartnerBalanceService {

    private static final Logger log = LoggerFactory.getLogger(PartnerBalanceService.class);

    private final RateResolver rateResolver;
    private final PartnerRepository partnerRepo;

    public PartnerBalanceService(RateResolver rateResolver, PartnerRepository partnerRepo) {
        this.rateResolver = rateResolver;
        this.partnerRepo = partnerRepo;
    }

    public void deductForMessage(UUID messageId,
                                 Long partnerId,
                                 DeliveryType deliveryType,
                                 String carrier,
                                 String msisdnPrefix) {
        Optional<PartnerRate> rateOpt = rateResolver.resolvePartnerRate(
                partnerId, deliveryType, carrier, msisdnPrefix);
        if (rateOpt.isEmpty()) {
            log.warn("No partner rate: msg={} partner={} type={} carrier={} prefix={}",
                    messageId, partnerId, deliveryType, carrier, msisdnPrefix);
            return;
        }

        BigDecimal amount = rateOpt.get().getRate();
        int affected = partnerRepo.deductBalance(partnerId, amount);
        if (affected == 0) {
            log.warn("Insufficient balance: msg={} partner={} amount={}",
                    messageId, partnerId, amount);
        } else {
            log.debug("Deducted {} from partner {} (msg {})", amount, partnerId, messageId);
        }
    }
}
