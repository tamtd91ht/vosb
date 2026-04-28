package com.smpp.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.smpp.core.domain.Channel;
import com.smpp.core.domain.Route;
import com.smpp.core.domain.enums.ChannelStatus;
import com.smpp.core.domain.enums.ChannelType;
import com.smpp.core.domain.enums.DeliveryType;
import com.smpp.core.repository.RouteRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.lang.reflect.Field;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
 *
 *  Cached resolution (Phase 5+): a successful lookup is cached in Redis under
 *  {@code route:partner:<partnerId>:<destAddr>} for 60s. Cache is invalidated
 *  by RouteHandlers on create/update/delete and by ChannelHandlers when a
 *  channel config changes. Redis outage falls back to the DB path silently.
 */
@Service
public class RouteResolver {

    private static final Logger log = LoggerFactory.getLogger(RouteResolver.class);
    private static final Duration CACHE_TTL = Duration.ofSeconds(60);

    private final RouteRepository routeRepo;
    private final CarrierResolver carrierResolver;
    private final RedisTemplate<String, Object> redisTemplate;
    private final ObjectMapper objectMapper;

    public RouteResolver(RouteRepository routeRepo,
                         CarrierResolver carrierResolver,
                         RedisTemplate<String, Object> redisTemplate,
                         ObjectMapper objectMapper) {
        this.routeRepo = routeRepo;
        this.carrierResolver = carrierResolver;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public Optional<Channel> resolve(Long partnerId, String destAddr) {
        String cacheKey = cacheKey(partnerId, destAddr);

        // Cache lookup
        Optional<Channel> cached = readCache(cacheKey);
        if (cached.isPresent()) {
            log.debug("Route CACHE_HIT partner={} dest={} channel={}",
                    partnerId, destAddr, cached.get().getCode());
            return cached;
        }

        Optional<Channel> resolved = resolveFromDb(partnerId, destAddr);
        resolved.ifPresent(ch -> writeCache(cacheKey, ch));
        return resolved;
    }

    private Optional<Channel> resolveFromDb(Long partnerId, String destAddr) {
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
        ch.getStatus();
    }

    // ── Cache helpers ─────────────────────────────────────────────────────────

    static String cacheKey(Long partnerId, String destAddr) {
        return "route:partner:" + partnerId + ":" + destAddr;
    }

    private Optional<Channel> readCache(String key) {
        try {
            Object raw = redisTemplate.opsForValue().get(key);
            if (raw instanceof Map<?, ?> map) {
                return Optional.of(toTransientChannel(map));
            }
        } catch (DataAccessException e) {
            log.warn("Redis route cache read failed: {} — falling back to DB", e.getMessage());
        } catch (Exception e) {
            log.error("Route cache deserialize error: {}", e.getMessage(), e);
        }
        return Optional.empty();
    }

    private void writeCache(String key, Channel ch) {
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("id", ch.getId());
            payload.put("code", ch.getCode());
            payload.put("type", ch.getType().name());
            payload.put("deliveryType", ch.getDeliveryType().name());
            payload.put("status", ch.getStatus().name());
            payload.put("configJson", ch.getConfig() != null ? ch.getConfig().toString() : "{}");
            redisTemplate.opsForValue().set(key, payload, CACHE_TTL);
        } catch (DataAccessException e) {
            log.warn("Redis route cache write failed: {}", e.getMessage());
        }
    }

    private Channel toTransientChannel(Map<?, ?> map) throws Exception {
        Channel ch = new Channel();
        // Channel#id has no setter — use reflection so the cached entity exposes
        // the same shape downstream code expects (consistent getId() semantics).
        Object idVal = map.get("id");
        if (idVal != null) {
            Field idField = Channel.class.getDeclaredField("id");
            idField.setAccessible(true);
            idField.set(ch, idVal instanceof Number n ? n.longValue() : Long.parseLong(idVal.toString()));
        }
        ch.setCode((String) map.get("code"));
        ch.setType(ChannelType.valueOf((String) map.get("type")));
        ch.setDeliveryType(DeliveryType.valueOf((String) map.get("deliveryType")));
        Object statusVal = map.get("status");
        if (statusVal != null) ch.setStatus(ChannelStatus.valueOf(statusVal.toString()));
        Object configVal = map.get("configJson");
        String configJson = configVal != null ? configVal.toString() : "{}";
        JsonNode config = objectMapper.readTree(configJson);
        ch.setConfig(config);
        return ch;
    }
}
