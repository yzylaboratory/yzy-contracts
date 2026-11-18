# Build from the repository root: docker build -f services/api/Dockerfile .
# The root context is required because migrations are embedded from supabase/migrations.
# One binary serves PROD and DEV. CONTRACTS_DATABASE_SCHEMA selects the schema at
# runtime (yzy_contracts by default, or yzy_contracts_dev), and the database role must match it.
FROM rust:1.95-slim-bookworm AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake clang pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src/services/api
COPY services/api/Cargo.toml services/api/Cargo.lock ./
COPY services/api/src ./src
COPY supabase/migrations /src/supabase/migrations
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
