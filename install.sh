#!/bin/bash
# Rulesync Single Binary Installer
# https://github.com/dyoshikawa/rulesync
#
# Usage:
#   curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash
#
# Options:
#   RULESYNC_HOME: Installation directory (default: ~/.rulesync)
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
#   RULESYNC_HOME=~/.local curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash

set -euo pipefail

# Colors for output (respect NO_COLOR and non-terminal output)
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

# Configuration
GITHUB_REPO="dyoshikawa/rulesync"
INSTALL_DIR="${RULESYNC_HOME:-$HOME/.rulesync}"
BIN_DIR="$INSTALL_DIR/bin"
VERSION="${1:-${RULESYNC_VERSION:-latest}}"

# Detect HTTP client once
HTTP_CLIENT=""
if command -v curl &> /dev/null; then
    HTTP_CLIENT="curl"
elif command -v wget &> /dev/null; then
    HTTP_CLIENT="wget"
else
    printf '%b\n' "${RED}error${NC}: Neither curl nor wget is available. Please install one of them." >&2
    exit 1
fi

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
    printf '%b\n' "${BLUE}info${NC}: $1"
}

success() {
    printf '%b\n' "${GREEN}success${NC}: $1"
}

warn() {
    printf '%b\n' "${YELLOW}warn${NC}: $1"
}

error() {
    printf '%b\n' "${RED}error${NC}: $1" >&2
    exit 1
}

# Validate version format
validate_version() {
    local version="$1"
    if [ "$version" = "latest" ]; then
        return 0
    fi
    if ! [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
        error "Invalid version format: $version (expected format: v1.2.3 or v1.2.3-beta.1)"
    fi
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

# Get the latest release version from GitHub using redirect-based detection
get_latest_version() {
    local redirect_url version

    if [ "$HTTP_CLIENT" = "curl" ]; then
        redirect_url=$(curl -fsSL --max-redirs 5 -o /dev/null -w "%{url_effective}" "https://github.com/$GITHUB_REPO/releases/latest")
    else
        # Use wget --spider to detect redirect without downloading content
        redirect_url=$(wget --max-redirect=5 --spider --server-response "https://github.com/$GITHUB_REPO/releases/latest" 2>&1 | grep -i "Location:" | tail -1 | awk '{print $2}' | tr -d '\r')
    fi

    version="${redirect_url##*/}"

    if [ -z "$version" ]; then
        error "Failed to get latest version from GitHub. This may be caused by GitHub API rate limiting or network issues."
    fi

    echo "$version"
}

# Download a file
download() {
    local url="$1"
    local output="$2"

    if [ "$HTTP_CLIENT" = "curl" ]; then
        curl -fsSL --max-redirs 5 "$url" -o "$output"
    else
        wget --max-redirect=5 -q "$url" -O "$output"
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
        error "Neither sha256sum nor shasum is available. Cannot verify download integrity."
    fi

    if [ "$actual" != "$expected" ]; then
        error "Checksum verification failed!\nExpected: $expected\nActual:   $actual"
    fi

    success "Checksum verified"
}

# Get shell configuration file
# Note: $SHELL refers to the user's login shell, not the shell running this script.
# This is intentional since we want to show PATH instructions for the user's default shell.
get_shell_config() {
    local shell_name
    shell_name="$(basename "${SHELL:-/bin/sh}")"

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
    shell_name="$(basename "${SHELL:-/bin/sh}")"
    shell_config="$(get_shell_config)"

    echo ""
    info "Add rulesync to your PATH by running:"
    echo ""

    case "$shell_name" in
        fish)
            printf '%b\n' "  ${YELLOW}set -Ux fish_user_paths $BIN_DIR \$fish_user_paths${NC}"
            echo ""
            echo "  Or add to $shell_config:"
            printf '%b\n' "  ${YELLOW}set -gx PATH $BIN_DIR \$PATH${NC}"
            ;;
        *)
            printf '%b\n' "  ${YELLOW}echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> $shell_config${NC}"
            printf '%b\n' "  ${YELLOW}source $shell_config${NC}"
            ;;
    esac

    echo ""
    info "Then verify the installation:"
    printf '%b\n' "  ${YELLOW}rulesync --version${NC}"
}

# Print uninstall instructions
print_uninstall_instructions() {
    echo ""
    info "To uninstall rulesync:"
    printf '%b\n' "  ${YELLOW}rm -f $BIN_DIR/rulesync${NC}"
    echo ""
    echo "  If you no longer need the installation directory:"
    printf '%b\n' "  ${YELLOW}rm -rf $INSTALL_DIR${NC}"
    echo ""
    echo "  And remove the PATH entry from your shell configuration file."
}

# Main installation
main() {
    echo ""
    printf '%b\n' "${BLUE}╔════════════════════════════════════════╗${NC}"
    printf '%b\n' "${BLUE}║      Rulesync Binary Installer         ║${NC}"
    printf '%b\n' "${BLUE}╚════════════════════════════════════════╝${NC}"
    echo ""

    # Validate version format
    validate_version "$VERSION"

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
        validate_version "$version"
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
    expected_checksum=$(awk -v name="$binary_name" '$2 == name || $2 == "./"name || $2 == "*"name {print $1}' "$TMP_DIR/SHA256SUMS")

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
    if echo "$PATH" | tr ':' '\n' | grep -qxF -- "$BIN_DIR"; then
        echo ""
        info "rulesync is already in your PATH"
        echo ""
        info "Verify the installation:"
        printf '%b\n' "  ${YELLOW}rulesync --version${NC}"
    else
        print_path_instructions
    fi

    print_uninstall_instructions
}

main
