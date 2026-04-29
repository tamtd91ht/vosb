package com.vosb.gateway.server.auth;

/**
 * Verified API key identity stored in RoutingContext.data("partnerContext")
 * after ApiKeyHmacAuthHandler passes.
 */
public record PartnerContext(Long partnerId, String keyId) {}
