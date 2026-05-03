package com.vosb.gateway.server.http.admin.session;

import com.vosb.gateway.server.http.common.HandlerUtils;
import com.vosb.gateway.server.smpp.SessionInfo;
import com.vosb.gateway.server.smpp.SessionRegistry;
import io.vertx.ext.web.RoutingContext;
import org.jsmpp.session.SMPPServerSession;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class SessionHandlers {

    private final SessionRegistry sessionRegistry;

    public SessionHandlers(SessionRegistry sessionRegistry) {
        this.sessionRegistry = sessionRegistry;
    }

    // GET /api/admin/sessions
    public void list(RoutingContext ctx) {
        List<SessionInfo> sessions = sessionRegistry.listAll();
        List<Map<String, Object>> items = sessions.stream()
                .map(s -> Map.<String, Object>of(
                        "session_id", s.sessionId(),
                        "system_id", s.systemId(),
                        "bind_type", s.bindType(),
                        "remote_ip", s.remoteIp(),
                        "bound_at", s.boundAt().toString()
                ))
                .toList();
        HandlerUtils.respondJson(ctx, 200, Map.of(
                "items", items,
                "total", items.size()
        ));
    }

    // DELETE /api/admin/sessions/:id
    public void kick(RoutingContext ctx) {
        String sessionId = ctx.pathParam("id");
        Optional<SMPPServerSession> session = sessionRegistry.findById(sessionId);
        if (session.isEmpty()) {
            ctx.response().setStatusCode(404)
                    .putHeader("Content-Type", "application/problem+json; charset=utf-8")
                    .end("{\"status\":404,\"title\":\"Not Found\",\"detail\":\"No active SMPP session with id: " + sessionId + "\"}");
            return;
        }
        try {
            session.get().unbindAndClose();
        } catch (Exception e) {
            // session may already be closing
        }
        ctx.response().setStatusCode(204).end();
    }
}
