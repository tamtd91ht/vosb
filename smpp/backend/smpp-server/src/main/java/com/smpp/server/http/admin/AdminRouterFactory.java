package com.smpp.server.http.admin;

import com.smpp.server.auth.JwtAuthHandler;
import com.smpp.server.http.admin.auth.AuthHandlers;
import com.smpp.server.http.admin.carrier.CarrierHandlers;
import com.smpp.server.http.admin.channel.ChannelHandlers;
import com.smpp.server.http.admin.channel.ChannelRateHandlers;
import com.smpp.server.http.admin.partner.PartnerRateHandlers;
import com.smpp.server.http.admin.message.MessageHandlers;
import com.smpp.server.http.admin.partner.ApiKeyHandlers;
import com.smpp.server.http.admin.partner.PartnerHandlers;
import com.smpp.server.http.admin.partner.SmppAccountHandlers;
import com.smpp.server.http.admin.route.RouteHandlers;
import com.smpp.server.http.admin.session.SessionHandlers;
import com.smpp.server.http.admin.stats.StatsHandlers;
import com.smpp.server.http.admin.user.UserHandlers;
import io.vertx.core.Vertx;
import io.vertx.ext.web.Router;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Sub-router for /api/admin/*.
 *
 * Route layout (order matters):
 *   POST /auth/login    — public (no JWT)
 *   POST /auth/refresh  — public (no JWT)
 *   ALL  /*             — JwtAuthHandler (401 if missing/invalid Bearer)
 *   POST /auth/logout   — JWT protected
 *   GET  /auth/me       — JWT protected
 *   CRUD /partners/**   — T11-T13
 *   CRUD /channels/**   — T14
 *   CRUD /routes/**     — T15
 *   GET  /messages/**   — T16
 *   GET  /sessions/**   — T17
 *   GET  /stats/**      — T18
 *   CRUD /users/**      — T19
 */
@Configuration
public class AdminRouterFactory {

    @Bean("adminRouter")
    public Router adminRouter(Vertx vertx,
                              JwtAuthHandler jwtAuthHandler,
                              AuthHandlers auth,
                              PartnerHandlers partners,
                              SmppAccountHandlers smppAccounts,
                              ApiKeyHandlers apiKeys,
                              ChannelHandlers channels,
                              ChannelRateHandlers channelRates,
                              PartnerRateHandlers partnerRates,
                              CarrierHandlers carriers,
                              RouteHandlers routes,
                              MessageHandlers messages,
                              SessionHandlers sessions,
                              StatsHandlers stats,
                              UserHandlers users) {
        Router router = Router.router(vertx);

        // ── Public auth endpoints (no JWT) ────────────────────────────────────
        router.post("/auth/login").handler(auth::login);
        router.post("/auth/refresh").handler(auth::refresh);

        // ── JWT guard for all remaining routes ────────────────────────────────
        router.route().handler(jwtAuthHandler);

        // ── Protected auth endpoints ──────────────────────────────────────────
        router.post("/auth/logout").handler(auth::logout);
        router.get("/auth/me").handler(auth::me);

        // ── T11: Partners CRUD ────────────────────────────────────────────────
        router.post("/partners").handler(partners::create);
        router.get("/partners").handler(partners::list);
        router.get("/partners/:id").handler(partners::get);
        router.put("/partners/:id").handler(partners::update);
        router.delete("/partners/:id").handler(partners::delete);

        // ── T12: SMPP Accounts (nested under partners) ────────────────────────
        router.post("/partners/:partnerId/smpp-accounts").handler(smppAccounts::create);
        router.get("/partners/:partnerId/smpp-accounts").handler(smppAccounts::list);
        router.get("/partners/:partnerId/smpp-accounts/:id").handler(smppAccounts::get);
        router.delete("/partners/:partnerId/smpp-accounts/:id").handler(smppAccounts::delete);

        // ── T13: API Keys (nested under partners) ────────────────────────────
        router.post("/partners/:partnerId/api-keys").handler(apiKeys::create);
        router.get("/partners/:partnerId/api-keys").handler(apiKeys::list);
        router.delete("/partners/:partnerId/api-keys/:id").handler(apiKeys::revoke);

        // ── Partner rates (nested under partners) ─────────────────────────────
        router.get("/partners/:partnerId/rates").handler(partnerRates::list);
        router.post("/partners/:partnerId/rates").handler(partnerRates::create);
        router.put("/partners/:partnerId/rates/:rateId").handler(partnerRates::update);
        router.delete("/partners/:partnerId/rates/:rateId").handler(partnerRates::delete);

        // ── Carriers (lookup) ─────────────────────────────────────────────────
        router.get("/carriers").handler(carriers::list);

        // ── T14: Channels CRUD + test-ping ───────────────────────────────────
        router.post("/channels").handler(channels::create);
        router.get("/channels").handler(channels::list);
        // static route must precede parameterised :id routes
        router.get("/channels/http-providers").handler(channels::listHttpProviders);
        router.get("/channels/:id").handler(channels::get);
        router.put("/channels/:id").handler(channels::update);
        router.delete("/channels/:id").handler(channels::delete);
        router.post("/channels/:id/test-ping").handler(channels::testPing);
        router.get("/channels/:id/stats").handler(channels::stats);

        // ── Channel rates (nested under channels) ─────────────────────────────
        router.get("/channels/:id/rates").handler(channelRates::list);
        router.post("/channels/:id/rates").handler(channelRates::create);
        router.put("/channels/:id/rates/:rateId").handler(channelRates::update);
        router.delete("/channels/:id/rates/:rateId").handler(channelRates::delete);

        // ── T15: Routes CRUD ─────────────────────────────────────────────────
        router.post("/routes").handler(routes::create);
        router.get("/routes").handler(routes::list);
        router.put("/routes/:id").handler(routes::update);
        router.delete("/routes/:id").handler(routes::delete);

        // ── T16: Messages (read-only) ─────────────────────────────────────────
        router.get("/messages").handler(messages::list);
        router.get("/messages/:id").handler(messages::get);

        // ── T17: Sessions (stub) ─────────────────────────────────────────────
        router.get("/sessions").handler(sessions::list);
        router.delete("/sessions/:id").handler(sessions::kick);

        // ── T18: Stats ───────────────────────────────────────────────────────
        router.get("/stats/overview").handler(stats::overview);
        router.get("/stats/timeseries").handler(stats::timeseries);

        // ── T19: Admin Users CRUD ─────────────────────────────────────────────
        router.get("/users").handler(users::list);
        router.get("/users/:id").handler(users::get);
        router.post("/users").handler(users::create);
        router.put("/users/:id").handler(users::update);

        return router;
    }
}
