package com.smpp.server.auth;

import com.smpp.core.domain.enums.AdminRole;

/**
 * Verified JWT claims stored in RoutingContext.data("auth") after JwtAuthHandler passes.
 * Downstream handlers read this instead of re-parsing the token.
 */
public record AuthContext(
        Long userId,
        String username,
        AdminRole role,
        Long partnerId,   // null for ADMIN role
        String jti        // JWT ID — used for Redis blacklist on logout
) {
    public boolean isAdmin() { return role == AdminRole.ADMIN; }
    public boolean isPartner() { return role == AdminRole.PARTNER; }
}
