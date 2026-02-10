FROM docker.io/cloudflare/sandbox:0.6.3

# Minimal runtime for the pro agent sandbox runner.
# Keep this intentionally small; add tooling (git, ripgrep, etc.) only when needed.
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

ENV HOME=/root
ENV CI=true
ENV TERM=dumb
ENV NO_COLOR=1

RUN mkdir -p /workspace
WORKDIR /workspace

COPY sandbox/package.json /workspace/
RUN npm install --omit=dev

COPY sandbox/agent-runner.ts /workspace/
COPY sandbox/tsconfig.json /workspace/

