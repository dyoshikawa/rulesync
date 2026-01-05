FROM node:24

ARG TZ
ENV TZ="$TZ"

# Install basic development tools and iptables/ipset
RUN apt update && apt install -y less \
    git \
    procps \
    sudo \
    fzf \
    zsh \
    man-db \
    unzip \
    gnupg2 \
    gh \
    iptables \
    ipset \
    iproute2 \
    dnsutils \
    aggregate \
    jq \
    vim \
    bubblewrap \
    socat \
    ripgrep \
    locales

# Generate locale
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && \
    locale-gen
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# Ensure default node user has access to /usr/local/share
RUN mkdir -p /usr/local/share/npm-global && \
    chown -R node:node /usr/local/share

ARG USERNAME=node

# Allow node user to run specific sudo commands without password
RUN echo "node ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/node && \
    chmod 0440 /etc/sudoers.d/node

# Persist bash history.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
    && mkdir /commandhistory \
    && touch /commandhistory/.bash_history \
    && chown -R $USERNAME /commandhistory

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

# Create workspace and config directories and set permissions
RUN mkdir -p /workspace /home/node/.claude && \
    chown -R node:node /workspace /home/node/.claude

WORKDIR /workspace

RUN ARCH=$(dpkg --print-architecture) && \
    wget "https://github.com/dandavison/delta/releases/download/0.18.2/git-delta_0.18.2_${ARCH}.deb" && \
    sudo dpkg -i "git-delta_0.18.2_${ARCH}.deb" && \
    rm "git-delta_0.18.2_${ARCH}.deb"

# Set up non-root user
USER node

# Install global packages
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Set the default shell to zsh rather than sh
ENV SHELL=/bin/zsh

# Install oh-my-bash and oh-my-zsh
RUN bash -c "$(curl -fsSL https://raw.githubusercontent.com/ohmybash/oh-my-bash/master/tools/install.sh)"
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

### Customize ###

# Install mise
ENV PATH=$PATH:/home/node/.local/bin
RUN curl https://mise.run | sh
RUN echo "eval \"\$(/home/node/.local/bin/mise activate zsh)\"" >> "/home/node/.zshrc"
RUN echo "eval \"\$(/home/node/.local/bin/mise activate bash)\"" >> "/home/node/.bashrc"

# Copy mise.toml and run mise trust and install
# NOTE: The tools installed in this image are based on the contents of mise.toml at build time.
# If you change mise.toml, you must rebuild the container.
COPY mise.toml /workspace/mise.toml
RUN mise trust /workspace && mise install

# Install pinact using Go installed by mise
RUN mise exec -- go install github.com/suzuki-shunsuke/pinact/cmd/pinact@latest
ENV PATH=$PATH:/home/node/go/bin

# Install goose
RUN curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash

# Install Safe Chain
RUN curl -fsSL https://github.com/AikidoSec/safe-chain/releases/latest/download/install-safe-chain.sh | sh

# Install global packages
ENV PNPM_HOME=/home/node/.pnpm
ENV PATH=$PATH:$PNPM_HOME
RUN mkdir -p "$PNPM_HOME" && \
    mise exec -- pnpm setup && \
    mise exec -- pnpm add -g \
    @openai/codex \
    @google/gemini-cli

# Install Claude Code
RUN curl -fsSL https://claude.ai/install.sh | bash

# Install OpenCode
RUN curl -fsSL https://opencode.ai/install | bash

# Aliases
ENV CLAUDE_COMMAND="alias claude=\"claude --dangerously-skip-permissions\""
RUN echo ${CLAUDE_COMMAND} >> "/home/node/.zshrc"
RUN echo ${CLAUDE_COMMAND} >> "/home/node/.bashrc"

# Install init.sh
ENV PATH=$PATH:/home/node/bin
COPY .devcontainer/init.sh /home/node/bin/init.sh
USER root
RUN chmod +x /home/node/bin/init.sh
USER node
