package com.vosb.gateway.server.smpp;

import com.fasterxml.jackson.databind.JsonNode;
import com.vosb.gateway.core.domain.PartnerSmppAccount;
import com.vosb.gateway.core.domain.enums.SmppAccountStatus;
import com.vosb.gateway.core.repository.PartnerSmppAccountRepository;
import com.vosb.gateway.core.security.PasswordHasher;
import org.jsmpp.SMPPConstant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;

@Component
public class BindAuthenticator {

    private static final Logger log = LoggerFactory.getLogger(BindAuthenticator.class);
    private static final Duration CACHE_TTL = Duration.ofSeconds(300);
    private static final String CACHE_PREFIX = "smpp:bindok:";

    private final PartnerSmppAccountRepository accountRepo;
    private final PasswordHasher passwordHasher;
    private final StringRedisTemplate redis;
    private final SessionRegistry sessionRegistry;

    public BindAuthenticator(PartnerSmppAccountRepository accountRepo,
                             PasswordHasher passwordHasher,
                             StringRedisTemplate redis,
                             SessionRegistry sessionRegistry) {
        this.accountRepo = accountRepo;
        this.passwordHasher = passwordHasher;
        this.redis = redis;
        this.sessionRegistry = sessionRegistry;
    }

    /**
     * Authenticates a bind request.
     *
     * @param systemId  SMPP system_id from bind PDU
     * @param password  plaintext password from bind PDU
     * @param remoteIp  remote IP string, null means unknown/skip whitelist
     * @return the authenticated account
     * @throws BindRejected with SMPP error code on failure
     */
    public PartnerSmppAccount authenticate(String systemId, String password, String remoteIp) {
        PartnerSmppAccount acc = accountRepo.findBySystemId(systemId)
                .orElseThrow(() -> {
                    log.warn("SMPP bind rejected: systemId '{}' not found", systemId);
                    return new BindRejected(SMPPConstant.STAT_ESME_RBINDFAIL, "Unknown system_id");
                });

        if (acc.getStatus() != SmppAccountStatus.ACTIVE) {
            log.warn("SMPP bind rejected: systemId '{}' is {}", systemId, acc.getStatus());
            throw new BindRejected(SMPPConstant.STAT_ESME_RBINDFAIL, "Account inactive");
        }

        verifyPassword(systemId, password, acc.getPasswordHash());
        checkIpWhitelist(systemId, remoteIp, acc.getIpWhitelist());
        checkMaxBinds(systemId, acc.getMaxBinds());

        return acc;
    }

    private void verifyPassword(String systemId, String password, String passwordHash) {
        String cacheKey = CACHE_PREFIX + systemId + ":" + sha256hex(password);
        String cached = redis.opsForValue().get(cacheKey);
        if ("1".equals(cached)) {
            return;
        }

        if (!passwordHasher.matches(password, passwordHash)) {
            log.warn("SMPP bind rejected: wrong password for systemId '{}'", systemId);
            throw new BindRejected(SMPPConstant.STAT_ESME_RBINDFAIL, "Invalid credentials");
        }

        redis.opsForValue().set(cacheKey, "1", CACHE_TTL);
    }

    private void checkIpWhitelist(String systemId, String remoteIp, JsonNode whitelist) {
        if (remoteIp == null || whitelist == null || whitelist.isEmpty()) {
            return;
        }
        for (JsonNode entry : whitelist) {
            if (cidrContains(entry.asText(), remoteIp)) {
                return;
            }
        }
        log.warn("SMPP bind rejected: IP '{}' not in whitelist for systemId '{}'", remoteIp, systemId);
        throw new BindRejected(SMPPConstant.STAT_ESME_RBINDFAIL, "IP not whitelisted");
    }

    private void checkMaxBinds(String systemId, int maxBinds) {
        int active = sessionRegistry.countActive(systemId);
        if (active >= maxBinds) {
            log.warn("SMPP bind rejected: systemId '{}' at max binds ({}/{})", systemId, active, maxBinds);
            throw new BindRejected(SMPPConstant.STAT_ESME_RTHROTTLED, "Max binds exceeded");
        }
    }

    private static boolean cidrContains(String cidr, String ip) {
        try {
            if (!cidr.contains("/")) {
                return InetAddress.getByName(cidr).getHostAddress().equals(
                        InetAddress.getByName(ip).getHostAddress());
            }
            String[] parts = cidr.split("/", 2);
            int prefixLen = Integer.parseInt(parts[1]);
            InetAddress network = InetAddress.getByName(parts[0]);
            InetAddress target = InetAddress.getByName(ip);
            byte[] netBytes = network.getAddress();
            byte[] tgtBytes = target.getAddress();
            if (netBytes.length != tgtBytes.length) return false;

            int fullBytes = prefixLen / 8;
            int remainBits = prefixLen % 8;
            for (int i = 0; i < fullBytes; i++) {
                if (netBytes[i] != tgtBytes[i]) return false;
            }
            if (remainBits > 0 && fullBytes < netBytes.length) {
                int mask = 0xFF << (8 - remainBits);
                return (netBytes[fullBytes] & mask) == (tgtBytes[fullBytes] & mask);
            }
            return true;
        } catch (UnknownHostException | NumberFormatException e) {
            log.warn("Invalid CIDR entry '{}': {}", cidr, e.getMessage());
            return false;
        }
    }

    private static String sha256hex(String input) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
