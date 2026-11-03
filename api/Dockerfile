FROM rust:1.82 AS b
WORKDIR /s
COPY . .
RUN cargo build --release
FROM debian:bookworm-slim
COPY --from=b /s/target/release/api /usr/local/bin/api
CMD ["api"]
