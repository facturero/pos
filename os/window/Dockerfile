# Compila la ventana del POS (Tauri 2) para el equipo destino: Ubuntu 24.04 (glibc y webkit2gtk-4.1 de
# esa version). Se construye en ubuntu:24.04 y no en la maquina de desarrollo (Windows, sin Rust).
#
#   docker build -t facturero-window -f os/window/Dockerfile .      (desde la carpeta pos/)
# os/window/build-window.sh lo hace y extrae el binario a os/window/out/.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl ca-certificates pkg-config file xz-utils \
      libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev \
      nodejs npm python3 \
    && rm -rf /var/lib/apt/lists/*

# Rust por rustup (perfil minimo). Version fijada para que la compilacion sea repetible.
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
ARG RUST_VERSION=1.90.0
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain ${RUST_VERSION}

WORKDIR /src
# Solo lo que necesita Tauri: el crate y el script de iconos. La pantalla NO se embebe (la sirve el
# backend en :4000), asi que frontendDist apunta a un dist minimo.
COPY frontend/src-tauri /src/src-tauri
COPY os/window/make-icons.py /tmp/make-icons.py
RUN mkdir -p /src/dist && printf '<!doctype html><title>POS</title>' > /src/dist/index.html \
    # Iconos: si el repo no trae los suyos (frontend/src-tauri/icons, que se generan con
    # `npx tauri icon <logo.png>` y se commitean) se crea un logo PLACEHOLDER para poder compilar.
    && if [ ! -f /src/src-tauri/icons/icon.png ]; then \
         python3 /tmp/make-icons.py /tmp/logo.png \
         && cd /src && npx --yes @tauri-apps/cli@2 icon /tmp/logo.png -o /src/src-tauri/icons ; \
       fi

WORKDIR /src/src-tauri
# custom-protocol = build de produccion (sin el, la ventana buscaria el devUrl). Sin bundle: solo el binario.
RUN cargo build --locked --release --features tauri/custom-protocol \
    && install -D target/release/pos-app /out/facturero-pos-app \
    && ls -la /out
