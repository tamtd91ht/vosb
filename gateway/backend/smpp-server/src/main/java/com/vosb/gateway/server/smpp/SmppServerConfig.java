package com.vosb.gateway.server.smpp;

import org.jsmpp.session.SMPPServerSessionListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.io.IOException;

@Configuration
public class SmppServerConfig {

    private static final Logger log = LoggerFactory.getLogger(SmppServerConfig.class);

    @Bean(name = "smppExecutor", destroyMethod = "shutdown")
    public ThreadPoolTaskExecutor smppExecutor(
            @Value("${app.smpp.executor.core-size:32}") int coreSize,
            @Value("${app.smpp.executor.max-size:128}") int maxSize,
            @Value("${app.smpp.executor.queue-capacity:256}") int queueCapacity) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(coreSize);
        executor.setMaxPoolSize(maxSize);
        executor.setQueueCapacity(queueCapacity);
        executor.setThreadNamePrefix("smpp-session-");
        executor.setDaemon(true);
        executor.initialize();
        return executor;
    }

    @Bean(destroyMethod = "close")
    public SMPPServerSessionListener smppServerSessionListener(
            @Value("${app.smpp.port:2775}") int port) throws IOException {
        SMPPServerSessionListener listener = new SMPPServerSessionListener(port);
        log.info("SMPP server listening on port {}", port);
        return listener;
    }
}
