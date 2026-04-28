package com.smpp.server.smpp;

import org.jsmpp.session.SMPPServerSession;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;

@Component
public class SessionRegistry {

    private final ConcurrentHashMap<String, Set<SMPPServerSession>> bySystemId = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, SessionInfo> infos = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> partnerIdBySession = new ConcurrentHashMap<>();

    public void add(SMPPServerSession session, String systemId, String bindType,
                    String remoteIp, Long partnerId) {
        String sid = session.getSessionId();
        bySystemId.computeIfAbsent(systemId, k -> ConcurrentHashMap.newKeySet()).add(session);
        infos.put(sid, new SessionInfo(sid, systemId, bindType, remoteIp, OffsetDateTime.now()));
        partnerIdBySession.put(sid, partnerId);
    }

    public void remove(SMPPServerSession session) {
        String sid = session.getSessionId();
        SessionInfo info = infos.remove(sid);
        partnerIdBySession.remove(sid);
        if (info != null) {
            Set<SMPPServerSession> set = bySystemId.get(info.systemId());
            if (set != null) {
                set.remove(session);
                if (set.isEmpty()) bySystemId.remove(info.systemId());
            }
        }
    }

    public int countActive(String systemId) {
        Set<SMPPServerSession> set = bySystemId.get(systemId);
        return set == null ? 0 : set.size();
    }

    public List<SessionInfo> listAll() {
        return new ArrayList<>(infos.values());
    }

    public Optional<Long> getPartnerId(String sessionId) {
        return Optional.ofNullable(partnerIdBySession.get(sessionId));
    }

    public Optional<SMPPServerSession> findById(String sessionId) {
        SessionInfo info = infos.get(sessionId);
        if (info == null) return Optional.empty();
        Set<SMPPServerSession> set = bySystemId.get(info.systemId());
        if (set == null) return Optional.empty();
        return set.stream().filter(s -> s.getSessionId().equals(sessionId)).findFirst();
    }

    public List<SMPPServerSession> getActiveSessionsForPartner(Long partnerId) {
        return partnerIdBySession.entrySet().stream()
                .filter(e -> partnerId.equals(e.getValue()))
                .flatMap(e -> {
                    SessionInfo info = infos.get(e.getKey());
                    if (info == null) return Stream.empty();
                    Set<SMPPServerSession> set = bySystemId.get(info.systemId());
                    if (set == null) return Stream.empty();
                    return set.stream().filter(s -> s.getSessionId().equals(e.getKey()));
                })
                .toList();
    }
}
