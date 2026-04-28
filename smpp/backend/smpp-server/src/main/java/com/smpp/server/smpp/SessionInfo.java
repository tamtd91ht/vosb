package com.smpp.server.smpp;

import java.time.OffsetDateTime;

public record SessionInfo(
        String sessionId,
        String systemId,
        String bindType,
        String remoteIp,
        OffsetDateTime boundAt
) {}
