#!/bin/bash
# Rulesync Single Binary Uninstaller
# https://github.com/dyoshikawa/rulesync
#
# Removes a binary installed by install.sh. It only deletes the rulesync binary,
# then removes the bin and installation directories if they are left empty, so
# a shared RULESYNC_HOME such as ~/.local keeps everything else it holds.
#
# Usage:
#   curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/uninstall.sh | bash
#
# Options:
#   RULESYNC_HOME: Installation directory used by install.sh (default: ~/.rulesync)
#
# Examples:
#   # Uninstall from the default directory
#   curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/uninstall.sh | bash
#
#   # Uninstall from a custom directory
#   curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/uninstall.sh | RULESYNC_HOME=~/.local bash

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
INSTALL_DIR="${RULESYNC_HOME:-$HOME/.rulesync}"
BIN_DIR="$INSTALL_DIR/bin"
BINARY_PATH="$BIN_DIR/rulesync"

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

# Remove a directory only when it is empty
remove_dir_if_empty() {
    local dir="$1"
    if [ -d "$dir" ] && [ -z "$(ls -A "$dir")" ]; then
        rmdir "$dir"
        info "Removed empty directory $dir"
    fi
}

# Get shell configuration file
# Note: $SHELL refers to the user's login shell, not the shell running this script.
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

# Print PATH cleanup instructions
# The installer never edits shell configuration files, so neither does the uninstaller.
print_path_instructions() {
    local shell_name
    shell_name="$(basename "${SHELL:-/bin/sh}")"

    echo ""
    info "If you added $BIN_DIR to your PATH, remove that entry yourself:"

    case "$shell_name" in
        fish)
            echo "  Remove it from fish_user_paths, or delete the 'set -gx PATH $BIN_DIR \$PATH' line from $(get_shell_config):"
            printf '%b\n' "  ${YELLOW}set -l i (contains -i -- $BIN_DIR \$fish_user_paths); and set -Ue fish_user_paths[\$i]${NC}"
            ;;
        *)
            echo "  Delete the 'export PATH=\"$BIN_DIR:\$PATH\"' line from $(get_shell_config)"
            ;;
    esac
}

# Main uninstallation
main() {
    echo ""
    printf '%b\n' "${BLUE}╔════════════════════════════════════════╗${NC}"
    printf '%b\n' "${BLUE}║     Rulesync Binary Uninstaller        ║${NC}"
    printf '%b\n' "${BLUE}╚════════════════════════════════════════╝${NC}"
    echo ""

    if [ ! -e "$BINARY_PATH" ] && [ ! -L "$BINARY_PATH" ]; then
        error "rulesync is not installed at $BINARY_PATH. Set RULESYNC_HOME if you installed it to a custom directory."
    fi

    if [ -d "$BINARY_PATH" ]; then
        error "$BINARY_PATH is a directory, not the rulesync binary. Refusing to remove it."
    fi

    info "Removing $BINARY_PATH..."
    rm -f "$BINARY_PATH"

    remove_dir_if_empty "$BIN_DIR"
    remove_dir_if_empty "$INSTALL_DIR"

    if [ -d "$INSTALL_DIR" ]; then
        info "Kept $INSTALL_DIR because it still contains other files"
    fi

    echo ""
    success "rulesync has been uninstalled from $BINARY_PATH"

    print_path_instructions

    # Another rulesync (npm, Homebrew, a manual install) may still be on PATH
    hash -r 2>/dev/null || true
    local remaining
    remaining="$(command -v rulesync 2>/dev/null || true)"
    if [ -n "$remaining" ]; then
        echo ""
        warn "Another rulesync is still on your PATH at $remaining (installed by npm, Homebrew or by hand?). It was left untouched."
    fi
}

main
