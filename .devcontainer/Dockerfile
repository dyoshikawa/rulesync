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
  vim

# Ensure default node user has access to /usr/local/share
RUN mkdir -p /usr/local/share/npm-global && \
  chown -R node:node /usr/local/share

ARG USERNAME=node

# Allow node user to run specific sudo commands without password
RUN echo "node ALL=(ALL) NOPASSWD: /usr/bin/chown, /usr/bin/chmod" > /etc/sudoers.d/node && \
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

# Default powerline10k theme
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v1.2.0/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

### Customize ###

# Install Claude Code
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH=$PATH:/home/node/.local/bin
RUN claude update

# Install mise
RUN curl https://mise.run | sh
RUN echo "eval \"\$(/home/node/.local/bin/mise activate zsh)\"" >> "/home/node/.zshrc"

# Copy mise.toml and run mise trust and install
# NOTE: The tools installed in this image are based on the contents of mise.toml at build time.
# If you change mise.toml, you must rebuild the container.
COPY mise.toml /workspace/mise.toml
RUN /home/node/.local/bin/mise trust /workspace && /home/node/.local/bin/mise install

# Install global npm packages
RUN npm i -g opencode-ai @openai/codex opencommit @google/gemini-cli

# Install Bun with smol mode to reduce memory usage
RUN echo 'smol = true' > /home/node/bunfig.toml
RUN curl -fsSL https://bun.sh/install | bash

# Aliases
RUN echo "alias claude=\"claude --dangerously-skip-permissions\"" >> "/home/node/.zshrc"

# Install init.sh
ENV PATH=$PATH:/home/node/bin
COPY .devcontainer/init.sh /home/node/bin/init.sh
USER root
RUN chmod +x /home/node/bin/init.sh
USER node
