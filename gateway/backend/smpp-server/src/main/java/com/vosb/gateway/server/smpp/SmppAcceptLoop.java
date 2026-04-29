package com.vosb.gateway.server.smpp;

import com.vosb.gateway.core.domain.PartnerSmppAccount;
import jakarta.annotation.PostConstruct;
import org.jsmpp.extra.SessionState;
import org.jsmpp.session.BindRequest;
import org.jsmpp.session.SMPPServerSession;
import org.jsmpp.session.SMPPServerSessionListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.concurrent.TimeoutException;

@Component
public class SmppAcceptLoop {

    private static final Logger log = LoggerFactory.getLogger(SmppAcceptLoop.class);

    private final SMPPServerSessionListener listener;
    private final ThreadPoolTaskExecutor smppExecutor;
    private final BindAuthenticator authenticator;
    private final MessageReceiverListenerImpl messageReceiver;
    private final SessionRegistry sessionRegistry;
    private final int enquireLinkIntervalMs;

    public SmppAcceptLoop(SMPPServerSessionListener listener,
                          @Qualifier("smppExecutor") ThreadPoolTaskExecutor smppExecutor,
                          BindAuthenticator authenticator,
                          MessageReceiverListenerImpl messageReceiver,
                          SessionRegistry sessionRegistry,
                          @Value("${app.smpp.enquire-link-interval-ms:30000}") int enquireLinkIntervalMs) {
        this.listener = listener;
        this.smppExecutor = smppExecutor;
        this.authenticator = authenticator;
        this.messageReceiver = messageReceiver;
        this.sessionRegistry = sessionRegistry;
        this.enquireLinkIntervalMs = enquireLinkIntervalMs;
    }

    @PostConstruct
    public void start() {
        Thread acceptThread = new Thread(this::acceptLoop, "smpp-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        log.info("SMPP accept loop started");
    }

    private void acceptLoop() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                SMPPServerSession session = listener.accept();
                smppExecutor.execute(() -> handleSession(session));
            } catch (IOException e) {
                if (Thread.currentThread().isInterrupted()) break;
                log.error("SMPP accept error: {}", e.getMessage());
            }
        }
        log.info("SMPP accept loop terminated");
    }

    private void handleSession(SMPPServerSession session) {
        String remoteIp = extractRemoteIp(session);
        log.debug("SMPP new connection from {}", remoteIp);

        session.setMessageReceiverListener(messageReceiver);
        session.setEnquireLinkTimer(enquireLinkIntervalMs);
        session.addSessionStateListener((newState, oldState, src) -> {
            if (newState == SessionState.CLOSED || newState == SessionState.UNBOUND) {
                sessionRegistry.remove(session);
                log.info("SMPP session {} closed ({}→{})",
                        session.getSessionId(), oldState, newState);
            }
        });

        BindRequest bindReq;
        try {
            bindReq = session.waitForBind(5000);
        } catch (IllegalStateException | TimeoutException e) {
            log.warn("SMPP bind timeout or bad state from {}: {}", remoteIp, e.getMessage());
            closeQuietly(session);
            return;
        }

        String systemId = bindReq.getSystemId();
        try {
            PartnerSmppAccount acc = authenticator.authenticate(
                    systemId, bindReq.getPassword(), remoteIp);

            Long partnerId = acc.getPartner().getId();
            sessionRegistry.add(session, systemId, bindReq.getBindType().name(), remoteIp, partnerId);
            bindReq.accept("VOSB");

            log.info("SMPP bind accepted: systemId={} bindType={} ip={} sessionId={}",
                    systemId, bindReq.getBindType(), remoteIp, session.getSessionId());

        } catch (BindRejected e) {
            log.warn("SMPP bind rejected: systemId={} reason={}", systemId, e.getMessage());
            try {
                bindReq.reject(e.getErrorCode());
            } catch (Exception ex) {
                log.debug("Error sending bind_reject for {}: {}", systemId, ex.getMessage());
            }
            closeQuietly(session);
        } catch (Exception e) {
            log.error("SMPP bind error for systemId={}: {}", systemId, e.getMessage(), e);
            try {
                bindReq.reject(8); // ESME_RSYSERR
            } catch (Exception ex) {
                log.debug("Error sending bind_reject (syserr) for {}: {}", systemId, ex.getMessage());
            }
            closeQuietly(session);
        }
    }

    private static String extractRemoteIp(SMPPServerSession session) {
        // jSMPP 3.x does not expose remote IP directly via public API
        return "unknown";
    }

    private static void closeQuietly(SMPPServerSession session) {
        try {
            session.close();
        } catch (Exception ignored) {
        }
    }
}
