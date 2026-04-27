# syntax=docker/dockerfile:1.7
# Build context: smpp/backend/  (cd smpp/backend && docker build -f smpp-server/Dockerfile .)

# ---------- Build stage ----------
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

# Layer 1: pom files only — cache deps separately from source.
COPY .mvn .mvn
COPY mvnw mvnw.cmd pom.xml ./
COPY core/pom.xml core/pom.xml
COPY smpp-server/pom.xml smpp-server/pom.xml
COPY worker/pom.xml worker/pom.xml
RUN chmod +x mvnw

# Best-effort dep pre-fetch (non-fatal).
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -pl smpp-server -am -DskipTests dependency:resolve dependency:resolve-plugins || true

# Layer 2: source — rebuild only when src changes.
COPY core/src core/src
COPY smpp-server/src smpp-server/src
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -pl smpp-server -am -DskipTests package

# ---------- Runtime stage ----------
FROM eclipse-temurin:21-jre AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN groupadd -r smpp && useradd -r -u 1001 -g smpp smpp \
 && chown -R smpp:smpp /app
USER smpp

COPY --from=build --chown=smpp:smpp /workspace/smpp-server/target/smpp-server-*.jar /app/app.jar

ENV JAVA_OPTS="-XX:+UseG1GC -XX:MaxRAMPercentage=75.0"
EXPOSE 8080 2775

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=45s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
