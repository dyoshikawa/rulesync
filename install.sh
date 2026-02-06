#!/bin/bash
# Rulesync Single Binary Installer
# https://github.com/dyoshikawa/rulesync
#
# Usage:
#   curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash
#
# Options:
#   RULESYNC_INSTALL: Installation directory (default: ~/.rulesync)
#   RULESYNC_VERSION: Version to install (default: latest)
#
# Examples:
#   # Install latest version
#   curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash
#
#   # Install specific version
#   curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash -s -- v6.4.0
#
#   # Install to custom directory
#   RULESYNC_INSTALL=~/.local curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
GITHUB_REPO="dyoshikawa/rulesync"
INSTALL_DIR="${RULESYNC_INSTALL:-$HOME/.rulesync}"
BIN_DIR="$INSTALL_DIR/bin"
VERSION="${1:-${RULESYNC_VERSION:-latest}}"

# Temporary directory for downloads
TMP_DIR=""

# Cleanup function
cleanup() {
    if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
        rm -rf "$TMP_DIR"
    fi
}
trap cleanup EXIT

# Print functions
info() {
    echo -e "${BLUE}info${NC}: $1"
}

success() {
    echo -e "${GREEN}success${NC}: $1"
}

warn() {
    echo -e "${YELLOW}warn${NC}: $1"
}

error() {
    echo -e "${RED}error${NC}: $1" >&2
    exit 1
}

# Detect OS
detect_os() {
    local os
    os="$(uname -s)"
    case "$os" in
        Linux*)  echo "linux" ;;
        Darwin*) echo "darwin" ;;
        MINGW*|MSYS*|CYGWIN*)
            error "Windows is not supported by this installer. Please download the binary manually from https://github.com/$GITHUB_REPO/releases"
            ;;
        *)
            error "Unsupported operating system: $os"
            ;;
    esac
}

# Detect architecture
detect_arch() {
    local arch
    arch="$(uname -m)"
    case "$arch" in
        x86_64|amd64)  echo "x64" ;;
        arm64|aarch64) echo "arm64" ;;
        *)
            error "Unsupported architecture: $arch"
            ;;
    esac
}

# Get the latest release version from GitHub
get_latest_version() {
    local latest_url="https://api.github.com/repos/$GITHUB_REPO/releases/latest"
    local version

    if command -v curl &> /dev/null; then
        version=$(curl -fsSL "$latest_url" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
    elif command -v wget &> /dev/null; then
        version=$(wget -qO- "$latest_url" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
    else
        error "Neither curl nor wget is available. Please install one of them."
    fi

    if [ -z "$version" ]; then
        error "Failed to get latest version from GitHub"
    fi

    echo "$version"
}

# Download a file
download() {
    local url="$1"
    local output="$2"

    if command -v curl &> /dev/null; then
        curl -fsSL "$url" -o "$output"
    elif command -v wget &> /dev/null; then
        wget -q "$url" -O "$output"
    else
        error "Neither curl nor wget is available. Please install one of them."
    fi
}

# Verify SHA256 checksum
verify_checksum() {
    local file="$1"
    local expected="$2"
    local actual

    if command -v sha256sum &> /dev/null; then
        actual=$(sha256sum "$file" | cut -d' ' -f1)
    elif command -v shasum &> /dev/null; then
        actual=$(shasum -a 256 "$file" | cut -d' ' -f1)
    else
        warn "Neither sha256sum nor shasum is available. Skipping checksum verification."
        return 0
    fi

    if [ "$actual" != "$expected" ]; then
        error "Checksum verification failed!\nExpected: $expected\nActual: $actual"
    fi

    success "Checksum verified"
}

# Get shell configuration file
get_shell_config() {
    local shell_name
    shell_name="$(basename "$SHELL")"

    case "$shell_name" in
        bash)
            if [ -f "$HOME/.bashrc" ]; then
                echo "$HOME/.bashrc"
            elif [ -f "$HOME/.bash_profile" ]; then
                echo "$HOME/.bash_profile"
            else
                echo "$HOME/.profile"
            fi
            ;;
        zsh)
            echo "$HOME/.zshrc"
            ;;
        fish)
            echo "$HOME/.config/fish/config.fish"
            ;;
        *)
            echo "$HOME/.profile"
            ;;
    esac
}

# Print PATH setup instructions
print_path_instructions() {
    local shell_name
    local shell_config
    shell_name="$(basename "$SHELL")"
    shell_config="$(get_shell_config)"

    echo ""
    info "Add rulesync to your PATH by running:"
    echo ""

    case "$shell_name" in
        fish)
            echo -e "  ${YELLOW}set -Ux fish_user_paths $BIN_DIR \$fish_user_paths${NC}"
            echo ""
            echo "  Or add to $shell_config:"
            echo -e "  ${YELLOW}set -gx PATH $BIN_DIR \$PATH${NC}"
            ;;
        *)
            echo -e "  ${YELLOW}echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> $shell_config${NC}"
            echo -e "  ${YELLOW}source $shell_config${NC}"
            ;;
    esac

    echo ""
    info "Then verify the installation:"
    echo -e "  ${YELLOW}rulesync --version${NC}"
}

# Print uninstall instructions
print_uninstall_instructions() {
    echo ""
    info "To uninstall rulesync:"
    echo -e "  ${YELLOW}rm -rf $INSTALL_DIR${NC}"
    echo ""
    echo "  And remove the PATH entry from your shell configuration file."
}

# Main installation
main() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║       Rulesync Binary Installer          ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
    echo ""

    # Detect platform
    local os arch binary_name
    os="$(detect_os)"
    arch="$(detect_arch)"
    binary_name="rulesync-$os-$arch"

    info "Detected platform: $os-$arch"

    # Resolve version
    local version="$VERSION"
    if [ "$version" = "latest" ]; then
        info "Fetching latest version..."
        version="$(get_latest_version)"
    fi

    info "Installing rulesync $version"

    # Create temporary directory
    TMP_DIR="$(mktemp -d)"

    # Download URLs
    local base_url="https://github.com/$GITHUB_REPO/releases/download/$version"
    local binary_url="$base_url/$binary_name"
    local checksums_url="$base_url/SHA256SUMS"

    # Download binary and checksums
    info "Downloading rulesync binary..."
    download "$binary_url" "$TMP_DIR/$binary_name"

    info "Downloading checksums..."
    download "$checksums_url" "$TMP_DIR/SHA256SUMS"

    # Verify checksum
    info "Verifying checksum..."
    local expected_checksum
    expected_checksum=$(grep "$binary_name" "$TMP_DIR/SHA256SUMS" | cut -d' ' -f1)

    if [ -z "$expected_checksum" ]; then
        error "Could not find checksum for $binary_name in SHA256SUMS"
    fi

    verify_checksum "$TMP_DIR/$binary_name" "$expected_checksum"

    # Create installation directory
    info "Installing to $BIN_DIR..."
    mkdir -p "$BIN_DIR"

    # Install binary
    mv "$TMP_DIR/$binary_name" "$BIN_DIR/rulesync"
    chmod +x "$BIN_DIR/rulesync"

    echo ""
    success "rulesync $version has been installed to $BIN_DIR/rulesync"

    # Check if already in PATH
    if echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
        echo ""
        info "rulesync is already in your PATH"
        echo ""
        info "Verify the installation:"
        echo -e "  ${YELLOW}rulesync --version${NC}"
    else
        print_path_instructions
    fi

    print_uninstall_instructions
}

main
