package com.smpp.worker.esl;

import com.fasterxml.jackson.databind.JsonNode;
import com.smpp.core.domain.Channel;
import com.smpp.core.domain.enums.ChannelStatus;
import com.smpp.core.domain.enums.ChannelType;
import com.smpp.core.repository.ChannelRepository;
import jakarta.annotation.PreDestroy;
import link.thingscloud.freeswitch.esl.IEslEventListener;
import link.thingscloud.freeswitch.esl.InboundClient;
import link.thingscloud.freeswitch.esl.constant.EventNames;
import link.thingscloud.freeswitch.esl.inbound.option.InboundClientOption;
import link.thingscloud.freeswitch.esl.inbound.option.ServerOption;
import link.thingscloud.freeswitch.esl.transport.event.EslEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Manages a single thingscloud {@link InboundClient} that connects to one or
 * more FreeSWITCH hosts. Each {@code FREESWITCH_ESL} channel becomes a
 * {@link ServerOption}. The library handles connect / reconnect / heartbeat
 * internally; we only need to map {@code channelId ↔ server addr ("host:port")}
 * so dispatcher can target the right host and DLR processor can correlate
 * events back to the originating channel.
 */
@Component
public class EslConnectionPool {

    private static final Logger log = LoggerFactory.getLogger(EslConnectionPool.class);

    private final ChannelRepository channelRepo;
    private final EslDlrProcessor dlrProcessor;
    private final ConcurrentHashMap<Long, String> channelToAddr = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> addrToChannel = new ConcurrentHashMap<>();
    private volatile InboundClient client;

    public EslConnectionPool(ChannelRepository channelRepo, EslDlrProcessor dlrProcessor) {
        this.channelRepo = channelRepo;
        this.dlrProcessor = dlrProcessor;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void init() {
        List<Channel> eslChannels;
        try {
            eslChannels = channelRepo
                    .findByTypeAndStatus(ChannelType.FREESWITCH_ESL, ChannelStatus.ACTIVE, Pageable.unpaged())
                    .getContent();
        } catch (Exception e) {
            log.error("Failed to load FREESWITCH_ESL channels from DB: {}", e.getMessage());
            return;
        }

        if (eslChannels.isEmpty()) {
            log.info("No active FREESWITCH_ESL channels — ESL client not started");
            return;
        }

        InboundClientOption option = new InboundClientOption()
                .defaultPassword("ClueCon")
                .addEvents(EventNames.CHANNEL_HANGUP_COMPLETE)
                .addListener(new HangupListener());

        for (Channel ch : eslChannels) {
            JsonNode cfg = ch.getConfig();
            String host = cfg.path("host").asText();
            int port    = cfg.path("port").asInt(8021);
            String pwd  = cfg.path("password").asText("ClueCon");
            ServerOption so = new ServerOption(host, port).password(pwd);
            option.addServerOption(so);
            channelToAddr.put(ch.getId(), so.addr());
            addrToChannel.put(so.addr(), ch.getId());
            log.info("ESL server added: channel={} host={}:{}", ch.getCode(), host, port);
        }

        client = InboundClient.newInstance(option);
        client.start();
        log.info("ESL inbound client started ({} servers)", eslChannels.size());
    }

    /**
     * Returns the {@code "host:port"} address for the given channel, or empty if
     * no active ESL connection has been registered for it.
     */
    public Optional<String> getAddr(Long channelId) {
        return Optional.ofNullable(channelToAddr.get(channelId));
    }

    public Optional<InboundClient> getClient() {
        return Optional.ofNullable(client);
    }

    Long resolveChannelId(String addr) {
        return addrToChannel.get(addr);
    }

    @PreDestroy
    void shutdown() {
        if (client != null) {
            try { client.shutdown(); } catch (Exception e) { log.warn("ESL shutdown: {}", e.getMessage()); }
        }
        log.info("ESL inbound client shut down");
    }

    private final class HangupListener implements IEslEventListener {
        @Override
        public void eventReceived(String addr, EslEvent event) {
            if (!EventNames.CHANNEL_HANGUP_COMPLETE.equals(event.getEventName())) return;
            Long channelId = resolveChannelId(addr);
            if (channelId == null) {
                log.warn("ESL hangup event from unknown server addr={}", addr);
                return;
            }
            try {
                dlrProcessor.onHangupComplete(channelId, event);
            } catch (Exception e) {
                log.error("ESL DLR processing failed for addr={}: {}", addr, e.getMessage(), e);
            }
        }

        @Override
        public void backgroundJobResultReceived(String addr, EslEvent event) {
            // Not used — we use sync api command for originate.
        }
    }
}
