# Build from the repository root: docker build -f services/api/Dockerfile .
# The root context is required because migrations are embedded from supabase/migrations.
FROM rust:1.95-slim-bookworm AS builder
# production (default): the sources are built exactly as they are in the checkout.
# development: the builder's copy is renamed to yzy_contracts_dev and
#   yzy_contracts_dev_app (services/api/dev-build). The checkout is never modified.
ARG CONTRACTS_BUILD_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake clang pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src/services/api
COPY services/api/Cargo.toml services/api/Cargo.lock ./
COPY services/api/src ./src
COPY supabase/migrations /src/supabase/migrations
COPY services/api/dev-build /src/services/api/dev-build
RUN case "$CONTRACTS_BUILD_ENV" in \
      production) ;; \
      development) sh /src/services/api/dev-build/transform-dev-schema.sh apply /src ;; \
      *) echo "CONTRACTS_BUILD_ENV must be production or development" >&2; exit 1 ;; \
    esac
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home api
COPY --from=builder /src/services/api/target/release/yzy-contracts-api /usr/local/bin/yzy-contracts-api
USER api
EXPOSE 8080
ENTRYPOINT ["yzy-contracts-api"]
# The worker uses the same image with the command "worker"; migrations with "migrate".
CMD ["serve"]
