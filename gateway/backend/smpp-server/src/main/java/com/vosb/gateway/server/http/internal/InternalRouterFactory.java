package com.vosb.gateway.server.http.internal;

import io.vertx.core.Vertx;
import io.vertx.ext.web.Router;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class InternalRouterFactory {

    @Bean("internalRouter")
    public Router internalRouter(Vertx vertx, DlrIngressHandler dlr) {
        Router r = Router.router(vertx);

        // DLR ingress from 3rd-party HTTP providers / worker dispatcher
        // Auth: X-Internal-Secret header
        r.post("/dlr/:channelId").handler(dlr::ingestDlr);

        return r;
    }
}
