#!/bin/bash

set -euo pipefail

# ============================================================
# TEMPLATE CONFIG
# Replace these placeholder values, or override them with env vars.
# Example:
#   APP_NAME=email-node GIT_REPO=https://github.com/me/email-node.git bash email-node.sh
# ============================================================

APP_NAME="${APP_NAME:-email-node}"
APP_TITLE="${APP_TITLE:-Email Node}"
GIT_REPO="${GIT_REPO:-https://github.com/tonyliuzj/email-node.git}"

RUN_USER="${SUDO_USER:-$USER}"
RUN_GROUP="$(id -gn "$RUN_USER")"

APP_ENV_FILE="${APP_ENV_FILE:-.env.local}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DOCKER_IMAGE="${DOCKER_IMAGE:-tonyliuzj/email-node:latest}"

DIRECT_DATABASE_PATH="${DIRECT_DATABASE_PATH:-data/temp-mail.db}"
DOCKER_DATABASE_PATH="${DOCKER_DATABASE_PATH:-/app/data/temp-mail.db}"

CONTAINER_PORT="${CONTAINER_PORT:-3000}"
SERVICE_NAME="${SERVICE_NAME:-${APP_NAME}.service}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}"

NODESOURCE_NODE_VERSION="${NODESOURCE_NODE_VERSION:-22.x}"
NODESOURCE_KEYRING="/usr/share/keyrings/nodesource.gpg"
NODESOURCE_KEY_URL="https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key"
DOCKER_KEYRING="/etc/apt/keyrings/docker.asc"
DOCKER_SOURCE_FILE="/etc/apt/sources.list.d/docker.sources"

DEFAULT_ADMIN_USERNAME="${DEFAULT_ADMIN_USERNAME:-admin}"
DEFAULT_ADMIN_PASSWORD="${DEFAULT_ADMIN_PASSWORD:-changeme}"

# Wait 1 second before major steps to mock/show install progress.
# Set STEP_DELAY=0 to disable.
STEP_DELAY="${STEP_DELAY:-1}"

# Upgrade installed apt packages before installing dependencies.
# Set SYSTEM_UPGRADE=0 to skip.
SYSTEM_UPGRADE="${SYSTEM_UPGRADE:-1}"

# Check installed system/project packages after install steps.
# Set CHECK_INSTALLS_UP_TO_DATE=0 to skip.
CHECK_INSTALLS_UP_TO_DATE="${CHECK_INSTALLS_UP_TO_DATE:-1}"

# If npm's lockfile is out of sync, refresh lockfile metadata before npm ci.
# Set REFRESH_NPM_LOCKFILE=0 to fail instead.
REFRESH_NPM_LOCKFILE="${REFRESH_NPM_LOCKFILE:-1}"

SYSTEM_UPGRADE_DONE=0

# ============================================================
# Helper functions
# ============================================================

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

step() {
  echo
  echo "==> $*"
  sleep "$STEP_DELAY"
}

resolve_user_home() {
  if command_exists getent; then
    getent passwd "$RUN_USER" | cut -d: -f6
  else
    eval echo "~$RUN_USER"
  fi
}

USER_HOME="$(resolve_user_home)"
USER_HOME="${USER_HOME:-$HOME}"
INSTALL_DIR="${INSTALL_DIR:-$USER_HOME/$APP_NAME}"

validate_template_config() {
  if [[ "$GIT_REPO" == *"YOUR_GITHUB_USERNAME"* ]] || [[ "$GIT_REPO" == *"YOUR_REPOSITORY"* ]]; then
    echo "You must replace the placeholder GIT_REPO before installing."
    echo "Current value: $GIT_REPO"
    exit 1
  fi

  if [[ "$APP_NAME" == "your-app" ]]; then
    echo "Warning: APP_NAME is still set to the placeholder value: your-app"
    echo "You can continue, but you should usually replace it."
    sleep "$STEP_DELAY"
  fi
}

require_systemd() {
  if ! command_exists systemctl; then
    echo "systemd is required but systemctl was not found."
    exit 1
  fi
}

require_repo_checkout() {
  if [ ! -d "$INSTALL_DIR/.git" ]; then
    echo "${APP_TITLE} is not installed in $INSTALL_DIR"
    exit 1
  fi
}

read_env_value() {
  local key="$1"
  local file="$2"

  if [ ! -f "$file" ]; then
    return 0
  fi

  grep "^${key}=" "$file" | tail -n 1 | cut -d'=' -f2-
}

ensure_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"

  if [ ! -f "$file" ]; then
    return 0
  fi

  if grep -q "^${key}=" "$file"; then
    return 0
  fi

  printf '\n%s=%s\n' "$key" "$value" >> "$file"
}

nodesource_source_exists() {
  as_root grep -Rqs "deb.nodesource.com" /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null
}

refresh_nodesource_key_if_possible() {
  if ! nodesource_source_exists; then
    return 0
  fi

  if ! command_exists curl || ! command_exists gpg; then
    return 0
  fi

  step "Refreshing NodeSource signing key..."
  as_root install -d -m 0755 "$(dirname "$NODESOURCE_KEYRING")"
  curl -fsSL "$NODESOURCE_KEY_URL" | as_root gpg --dearmor --yes -o "$NODESOURCE_KEYRING"
  as_root chmod 0644 "$NODESOURCE_KEYRING"
}

apt_update() {
  refresh_nodesource_key_if_possible
  step "Updating apt package lists..."
  as_root apt update
}

apt_package_available() {
  local package_name="$1"
  local candidate

  candidate="$(apt_package_candidate "$package_name")"
  [ -n "$candidate" ] && [ "$candidate" != "(none)" ]
}

apt_package_candidate() {
  local package_name="$1"

  apt-cache policy "$package_name" 2>/dev/null | awk '/Candidate:/ { print $2; exit }'
}

apt_packages_available() {
  local package_name

  for package_name in "$@"; do
    if ! apt_package_available "$package_name"; then
      return 1
    fi
  done

  return 0
}

docker_compose_package_supports_v2() {
  local package_name="$1"
  local candidate
  local version_without_epoch
  local major_version

  if [ "$package_name" != "docker-compose" ]; then
    return 0
  fi

  candidate="$(apt_package_candidate "$package_name")"
  version_without_epoch="${candidate#*:}"
  major_version="${version_without_epoch%%.*}"

  [ "$major_version" -ge 2 ] 2>/dev/null
}

upgrade_system_packages() {
  if [ "$SYSTEM_UPGRADE_DONE" = "1" ]; then
    return 0
  fi

  if [ "$SYSTEM_UPGRADE" != "1" ]; then
    echo "Skipping system package upgrade because SYSTEM_UPGRADE=$SYSTEM_UPGRADE."
    return 0
  fi

  apt_update

  step "Upgrading installed system packages..."
  as_root env DEBIAN_FRONTEND=noninteractive apt upgrade -y

  SYSTEM_UPGRADE_DONE=1
}

check_system_packages_up_to_date() {
  local upgradable

  if [ "$CHECK_INSTALLS_UP_TO_DATE" != "1" ]; then
    return 0
  fi

  step "Checking system packages are up to date..."
  apt_update

  upgradable="$(apt list --upgradable 2>/dev/null | sed '/^Listing/d' || true)"

  if [ -n "$upgradable" ]; then
    echo "Some system packages still have updates available:"
    echo "$upgradable"
    echo "Review them with: sudo apt list --upgradable"
  else
    echo "System packages are up to date."
  fi
}

check_required_commands() {
  local command_name
  local missing=0

  step "Checking required commands are installed..."

  for command_name in "$@"; do
    if command_exists "$command_name"; then
      echo "OK: $command_name"
    else
      echo "Missing required command: $command_name"
      missing=1
    fi
  done

  if [ "$missing" -ne 0 ]; then
    exit 1
  fi
}

# ============================================================
# Repository functions
# ============================================================

ensure_repo_present() {
  validate_template_config

  if [ -d "$INSTALL_DIR/.git" ]; then
    step "Repository already exists. Pulling latest changes..."
    cd "$INSTALL_DIR"
    git pull --ff-only
  elif [ -d "$INSTALL_DIR" ]; then
    step "Directory exists but is not a git repository. Removing and cloning fresh..."
    rm -rf "$INSTALL_DIR"
    git clone "$GIT_REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  else
    step "Cloning repository..."
    git clone "$GIT_REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
}

# ============================================================
# Node.js functions
# ============================================================

configure_nodesource_repo() {
  local arch

  arch="$(dpkg --print-architecture)"

  if [ "$arch" != "amd64" ] && [ "$arch" != "arm64" ]; then
    echo "Unsupported architecture for NodeSource: $arch"
    echo "Only amd64 and arm64 are supported."
    exit 1
  fi

  step "Configuring NodeSource Node.js ${NODESOURCE_NODE_VERSION} repository..."

  as_root install -d -m 0755 "$(dirname "$NODESOURCE_KEYRING")"

  curl -fsSL "$NODESOURCE_KEY_URL" | as_root gpg --dearmor --yes -o "$NODESOURCE_KEYRING"

  as_root chmod 0644 "$NODESOURCE_KEYRING"

  as_root rm -f /etc/apt/sources.list.d/nodesource.list
  as_root rm -f /etc/apt/sources.list.d/nodesource.sources

  as_root tee /etc/apt/sources.list.d/nodesource.sources >/dev/null <<EOF
Types: deb
URIs: https://deb.nodesource.com/node_${NODESOURCE_NODE_VERSION}
Suites: nodistro
Components: main
Architectures: $arch
Signed-By: $NODESOURCE_KEYRING
EOF

  as_root tee /etc/apt/preferences.d/nodejs >/dev/null <<EOF
Package: nodejs
Pin: origin deb.nodesource.com
Pin-Priority: 600
EOF

  as_root tee /etc/apt/preferences.d/nsolid >/dev/null <<EOF
Package: nsolid
Pin: origin deb.nodesource.com
Pin-Priority: 600
EOF

  step "Updating apt after adding NodeSource..."
  as_root apt update
}

install_nodesource_nodejs() {
  configure_nodesource_repo

  step "Installing Node.js..."
  as_root apt install -y nodejs
}

ensure_nodejs() {
  step "Checking Node.js version..."

  if command_exists node; then
    VERSION="$(node -v | sed 's/^v//')"
    MAJOR="${VERSION%%.*}"

    if [ "$MAJOR" -lt 18 ]; then
      echo "Node.js v$VERSION detected, but Node.js >=18 is required."
      read -p "Do you want to install Node.js 22? (y/n): " INSTALL_22

      if [[ "$INSTALL_22" =~ ^[Yy]$ ]]; then
        install_nodesource_nodejs
      else
        echo "Installation requires Node.js >=18. Exiting."
        exit 1
      fi
    else
      echo "Node.js v$VERSION detected. Skipping installation."
    fi
  else
    echo "Node.js not found."
    install_nodesource_nodejs
  fi
}

# ============================================================
# Docker repository functions
# ============================================================

configure_docker_repo() {
  local docker_os
  local docker_codename
  local arch

  if [ ! -r /etc/os-release ]; then
    echo "Cannot configure Docker repository because /etc/os-release was not found."
    exit 1
  fi

  # shellcheck disable=SC1091
  . /etc/os-release

  case "${ID:-}" in
    ubuntu)
      docker_os="ubuntu"
      docker_codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
      ;;
    debian)
      docker_os="debian"
      docker_codename="${VERSION_CODENAME:-}"
      ;;
    *)
      if [[ " ${ID_LIKE:-} " == *" ubuntu "* ]]; then
        docker_os="ubuntu"
        docker_codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
      elif [[ " ${ID_LIKE:-} " == *" debian "* ]]; then
        docker_os="debian"
        docker_codename="${VERSION_CODENAME:-}"
      else
        echo "Unsupported OS for automatic Docker install: ${PRETTY_NAME:-unknown}"
        echo "Install Docker with Compose v2 manually, then rerun this script."
        exit 1
      fi
      ;;
  esac

  if [ -z "$docker_codename" ]; then
    echo "Could not determine OS codename for Docker repository."
    echo "Install Docker with Compose v2 manually, then rerun this script."
    exit 1
  fi

  arch="$(dpkg --print-architecture)"

  step "Configuring Docker apt repository..."

  as_root install -m 0755 -d "$(dirname "$DOCKER_KEYRING")"
  as_root curl -fsSL "https://download.docker.com/linux/${docker_os}/gpg" -o "$DOCKER_KEYRING"
  as_root chmod a+r "$DOCKER_KEYRING"

  as_root tee "$DOCKER_SOURCE_FILE" >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/${docker_os}
Suites: ${docker_codename}
Components: stable
Architectures: ${arch}
Signed-By: ${DOCKER_KEYRING}
EOF

  apt_update
}

remove_docker_conflicting_packages() {
  local installed_packages

  installed_packages="$(
    dpkg-query -W -f='${binary:Package}\n' \
      docker.io \
      docker-doc \
      docker-compose \
      docker-compose-v2 \
      podman-docker \
      containerd \
      runc \
      2>/dev/null || true
  )"

  if [ -z "$installed_packages" ]; then
    return 0
  fi

  step "Removing Docker packages that conflict with Docker's official packages..."
  # shellcheck disable=SC2086
  as_root apt remove -y $installed_packages
  hash -r || true
}

install_docker_engine_package() {
  step "Installing Docker..."

  if apt_packages_available docker-ce docker-ce-cli containerd.io docker-buildx-plugin; then
    as_root apt install -y \
      docker-ce \
      docker-ce-cli \
      containerd.io \
      docker-buildx-plugin
    return 0
  fi

  echo "Docker CE packages are not available from apt. Falling back to distribution Docker packages."
  as_root apt install -y docker.io
}

install_docker_compose_package() {
  local package_name
  local attempted=0

  for package_name in docker-compose-plugin docker-compose-v2 docker-compose; do
    if ! apt_package_available "$package_name"; then
      continue
    fi

    if ! docker_compose_package_supports_v2 "$package_name"; then
      echo "Skipping ${package_name} because its apt candidate is Compose v1."
      continue
    fi

    attempted=1
    step "Installing Docker Compose (${package_name})..."
    as_root apt install -y "$package_name"
    hash -r || true

    if docker compose version >/dev/null 2>&1; then
      return 0
    fi

    echo "Package ${package_name} did not provide 'docker compose'. Trying another package if available."
  done

  if [ "$attempted" = "0" ]; then
    echo "No Docker Compose v2 apt package was found."
  else
    echo "No installed Docker Compose package provided the 'docker compose' command."
  fi

  return 1
}

# ============================================================
# Dependency installation
# ============================================================

install_direct_dependencies() {
  step "Installing system dependencies for direct deployment..."

  upgrade_system_packages

  as_root apt install -y \
    git \
    curl \
    ca-certificates \
    gnupg \
    build-essential \
    python3 \
    openssl

  ensure_nodejs
  check_required_commands git curl gpg openssl python3 node npm
  check_system_packages_up_to_date
}

install_docker_dependencies() {
  step "Installing system dependencies for Docker deployment..."

  upgrade_system_packages

  as_root apt install -y \
    git \
    curl \
    ca-certificates \
    gnupg \
    openssl

  if ! command_exists docker; then
    configure_docker_repo
    remove_docker_conflicting_packages
    install_docker_engine_package
  fi

  if ! docker compose version >/dev/null 2>&1; then
    if ! install_docker_compose_package; then
      configure_docker_repo
      install_docker_compose_package || {
        echo "Docker Compose v2 could not be installed automatically."
        echo "Install Docker Compose manually, then rerun this script."
        exit 1
      }
    fi
  fi

  step "Enabling and starting Docker..."
  as_root systemctl enable --now docker

  check_required_commands git curl gpg openssl docker
  check_docker_compose_command
  check_system_packages_up_to_date
}

ensure_docker_available() {
  if ! command_exists docker || ! docker compose version >/dev/null 2>&1; then
    install_docker_dependencies
    return
  fi

  check_required_commands docker
  check_docker_compose_command

  as_root systemctl enable --now docker
}

check_docker_compose_command() {
  step "Checking Docker Compose is installed..."

  if docker compose version >/dev/null 2>&1; then
    echo "OK: docker compose"
    return 0
  fi

  echo "Docker Compose plugin is not installed. Run Docker install first."
  exit 1
}

compose() {
  require_repo_checkout
  require_compose_file

  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose plugin is required but was not found."
    exit 1
  fi

  (
    cd "$INSTALL_DIR"
    as_root docker compose -f "$COMPOSE_FILE" "$@"
  )
}

require_compose_file() {
  if [ ! -f "${INSTALL_DIR}/${COMPOSE_FILE}" ]; then
    echo "Docker Compose file not found: ${INSTALL_DIR}/${COMPOSE_FILE}"
    exit 1
  fi
}

pull_or_build_docker_image() {
  step "Pulling Docker image..."

  if compose pull; then
    return 0
  fi

  echo "Could not pull ${DOCKER_IMAGE}. Building from the local checkout instead."

  step "Building Docker image..."
  compose build
}

# ============================================================
# Project dependency functions
# ============================================================

check_npm_lockfile_sync() {
  local npm_check_log

  npm_check_log="$(mktemp)"

  if npm ci --dry-run >"$npm_check_log" 2>&1; then
    rm -f "$npm_check_log"
    echo "npm lockfile is in sync."
    return 0
  fi

  echo "npm lockfile is not in sync:"
  cat "$npm_check_log"
  rm -f "$npm_check_log"
  return 1
}

check_project_dependencies_up_to_date() {
  local outdated_log

  if [ "$CHECK_INSTALLS_UP_TO_DATE" != "1" ]; then
    return 0
  fi

  step "Checking project dependencies are installed..."
  npm ls --depth=0 >/dev/null

  outdated_log="$(mktemp)"

  if npm outdated --depth=0 >"$outdated_log" 2>&1; then
    rm -f "$outdated_log"
    echo "Project dependencies are installed and up to date within package.json ranges."
    return 0
  fi

  if [ -s "$outdated_log" ]; then
    echo "Project dependencies are installed. Newer package versions are available:"
    cat "$outdated_log"
    rm -f "$outdated_log"
    return 0
  fi

  cat "$outdated_log"
  rm -f "$outdated_log"
  return 1
}

install_project_dependencies() {
  step "Checking npm lockfile before install..."

  if ! check_npm_lockfile_sync; then
    if [ "$REFRESH_NPM_LOCKFILE" != "1" ]; then
      echo "Set REFRESH_NPM_LOCKFILE=1 to refresh npm lockfile metadata automatically."
      exit 1
    fi

    step "Refreshing npm lockfile metadata..."
    npm install --package-lock-only
    check_npm_lockfile_sync
  fi

  step "Installing project dependencies..."
  npm ci

  check_project_dependencies_up_to_date
}

# ============================================================
# Environment file functions
# ============================================================

prompt_common_settings() {
  step "Generating application settings..."

  SESSION_PASS="$(openssl rand -base64 32)"
  echo "Session password generated."
  DATA_KEY="$(openssl rand -base64 32)"
  echo "Data encryption key generated."

  read -p "Port to expose the app on (default 3000): " HOST_PORT
  HOST_PORT="${HOST_PORT:-3000}"
}

write_direct_env_file() {
  step "Writing direct deployment environment file..."

  cat > "${INSTALL_DIR}/${APP_ENV_FILE}" <<EOF
# Email Node Environment Configuration

# Session secret for encrypted sessions
SESSION_PASSWORD=$SESSION_PASS

# Secret used to encrypt stored IMAP and Turnstile secrets
DATA_ENCRYPTION_KEY=$DATA_KEY

# Trust the host header behind reverse proxies and custom domains
AUTH_TRUST_HOST=true

# Database location (default: ./data/temp-mail.db)
DATABASE_URL=$DIRECT_DATABASE_PATH

# Server port (default: 3000)
PORT=$HOST_PORT
EOF
}

write_docker_env_files() {
  step "Writing Docker deployment environment files..."

  cat > "${INSTALL_DIR}/${APP_ENV_FILE}" <<EOF
# Email Node Environment Configuration

# Session secret for encrypted sessions
SESSION_PASSWORD=$SESSION_PASS

# Secret used to encrypt stored IMAP and Turnstile secrets
DATA_ENCRYPTION_KEY=$DATA_KEY

# Trust the host header behind reverse proxies and custom domains
AUTH_TRUST_HOST=true

# Database location (default: /app/data/temp-mail.db)
DATABASE_URL=$DOCKER_DATABASE_PATH

# Server port (default: 3000)
PORT=$CONTAINER_PORT
EOF

  cat > "${INSTALL_DIR}/${COMPOSE_ENV_FILE}" <<EOF
# Docker Compose environment file

HOST_PORT=$HOST_PORT
CONTAINER_PORT=$CONTAINER_PORT
DOCKER_IMAGE=$DOCKER_IMAGE
EOF
}

ensure_app_env_defaults() {
  local env_file="${INSTALL_DIR}/${APP_ENV_FILE}"

  ensure_env_value "SESSION_PASSWORD" "$(openssl rand -base64 32)" "$env_file"
  ensure_env_value "DATA_ENCRYPTION_KEY" "$(openssl rand -base64 32)" "$env_file"
  ensure_env_value "AUTH_TRUST_HOST" "true" "$env_file"
}

# ============================================================
# systemd functions
# ============================================================

write_service_file() {
  local app_port="$1"
  local node_bin

  node_bin="$(command -v node)"

  step "Writing systemd service file..."

  as_root tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=${APP_TITLE}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${INSTALL_DIR}/${APP_ENV_FILE}
ExecStart=${node_bin} ${INSTALL_DIR}/node_modules/next/dist/bin/next start -p ${app_port}
Restart=always
RestartSec=5
TimeoutStopSec=20
SyslogIdentifier=${APP_NAME}

[Install]
WantedBy=multi-user.target
EOF
}

reload_and_restart_service() {
  step "Reloading systemd and restarting service..."

  as_root systemctl daemon-reload
  as_root systemctl enable "$SERVICE_NAME"
  as_root systemctl restart "$SERVICE_NAME"
}

stop_and_remove_service() {
  if as_root test -f "$SERVICE_FILE"; then
    step "Stopping and removing systemd service..."

    as_root systemctl disable --now "$SERVICE_NAME" || true
    as_root rm -f "$SERVICE_FILE"
    as_root systemctl daemon-reload
  fi
}

# ============================================================
# Direct deployment actions
# ============================================================

install_direct() {
  echo "Starting ${APP_TITLE} direct installation..."

  require_systemd
  install_direct_dependencies
  ensure_repo_present
  prompt_common_settings
  write_direct_env_file

  echo
  echo ".env file created: ${INSTALL_DIR}/${APP_ENV_FILE}"
  echo "Complete setup at: http://localhost:$HOST_PORT/setup"

  install_project_dependencies

  step "Building the app..."
  npm run build

  write_service_file "$HOST_PORT"
  reload_and_restart_service

  echo
  echo "Installation complete!"
  echo "Visit: http://localhost:$HOST_PORT"
  echo "View logs: sudo journalctl -u $SERVICE_NAME -f"
  echo "Service status: sudo systemctl status $SERVICE_NAME"
}

update_direct() {
  echo "Updating ${APP_TITLE} direct deployment..."

  require_systemd
  require_repo_checkout
  install_direct_dependencies

  cd "$INSTALL_DIR"

  step "Pulling latest code..."
  git pull --ff-only

  ensure_app_env_defaults

  install_project_dependencies

  step "Building the app..."
  npm run build

  APP_PORT="$(read_env_value "PORT" "${INSTALL_DIR}/${APP_ENV_FILE}")"
  APP_PORT="${APP_PORT:-3000}"

  write_service_file "$APP_PORT"
  reload_and_restart_service

  echo
  echo "Update complete!"
  echo "Visit: http://localhost:$APP_PORT"
  echo "View logs: sudo journalctl -u $SERVICE_NAME -f"
}

start_direct() {
  require_systemd

  step "Starting service..."
  as_root systemctl start "$SERVICE_NAME"
  as_root systemctl status "$SERVICE_NAME" --no-pager
}

stop_direct() {
  require_systemd

  step "Stopping service..."
  as_root systemctl stop "$SERVICE_NAME"

  echo "${SERVICE_NAME} stopped."
}

restart_direct() {
  require_systemd

  step "Restarting service..."
  as_root systemctl restart "$SERVICE_NAME"
  as_root systemctl status "$SERVICE_NAME" --no-pager
}

status_direct() {
  require_systemd

  step "Checking service status..."
  as_root systemctl status "$SERVICE_NAME" --no-pager
}

logs_direct() {
  require_systemd

  step "Opening service logs..."
  as_root journalctl -u "$SERVICE_NAME" -f
}

uninstall_direct() {
  echo "Uninstalling ${APP_TITLE} direct deployment..."

  require_systemd
  stop_and_remove_service

  if [ -d "$INSTALL_DIR" ]; then
    step "Removing installation directory..."
    rm -rf "$INSTALL_DIR"
    echo "Removed $INSTALL_DIR"
  fi

  echo
  echo "Uninstall complete!"
  echo "Note: System dependencies were not removed."
}

# ============================================================
# Docker deployment actions
# ============================================================

install_docker_mode() {
  echo "Starting ${APP_TITLE} Docker installation..."

  install_docker_dependencies
  ensure_repo_present
  prompt_common_settings
  write_docker_env_files

  echo
  echo ".env files created:"
  echo "- ${INSTALL_DIR}/${APP_ENV_FILE}"
  echo "- ${INSTALL_DIR}/${COMPOSE_ENV_FILE}"
  echo "Complete setup at: http://localhost:$HOST_PORT/setup"

  step "Creating data directory..."
  mkdir -p "${INSTALL_DIR}/data"

  pull_or_build_docker_image

  step "Starting Docker services..."
  compose up -d --no-build

  echo
  echo "Installation complete!"
  echo "Visit: http://localhost:$HOST_PORT"
  echo "View logs: sudo docker compose logs -f"
  echo "Container status: sudo docker compose ps"
}

update_docker_mode() {
  echo "Updating ${APP_TITLE} Docker deployment..."

  require_repo_checkout
  install_docker_dependencies

  cd "$INSTALL_DIR"

  step "Pulling latest code..."
  git pull --ff-only

  ensure_app_env_defaults

  pull_or_build_docker_image

  step "Restarting Docker services..."
  compose up -d --no-build

  HOST_PORT_VALUE="$(read_env_value "HOST_PORT" "${INSTALL_DIR}/${COMPOSE_ENV_FILE}")"
  HOST_PORT_VALUE="${HOST_PORT_VALUE:-3000}"

  echo
  echo "Update complete!"
  echo "Visit: http://localhost:$HOST_PORT_VALUE"
  echo "View logs: sudo docker compose logs -f"
}

start_docker_mode() {
  ensure_docker_available

  step "Starting Docker containers..."
  compose up -d
  compose ps
}

stop_docker_mode() {
  ensure_docker_available

  step "Stopping Docker containers..."
  compose stop
}

restart_docker_mode() {
  ensure_docker_available

  step "Restarting Docker containers..."
  compose restart
  compose ps
}

status_docker_mode() {
  ensure_docker_available

  step "Checking Docker container status..."
  compose ps
}

logs_docker_mode() {
  ensure_docker_available

  step "Opening Docker logs..."
  compose logs -f
}

uninstall_docker_mode() {
  echo "Uninstalling ${APP_TITLE} Docker deployment..."

  if [ -d "$INSTALL_DIR" ]; then
    if command_exists docker && docker compose version >/dev/null 2>&1; then
      step "Stopping and removing Docker containers..."
      compose down --remove-orphans || true
    fi

    step "Removing installation directory..."
    rm -rf "$INSTALL_DIR"

    echo "Removed $INSTALL_DIR"
  fi

  echo
  echo "Uninstall complete!"
  echo "Note: System dependencies were not removed."
}

# ============================================================
# Menus
# ============================================================

show_direct_menu() {
  echo
  echo "====== Direct Deployment (systemd) ======"
  echo "1) Install"
  echo "2) Update"
  echo "3) Start service"
  echo "4) Stop service"
  echo "5) Restart service"
  echo "6) Service status"
  echo "7) Service logs"
  echo "8) Uninstall"
  echo "========================================="
  read -p "Select an option [1-8]: " CHOICE

  case "$CHOICE" in
    1) install_direct ;;
    2) update_direct ;;
    3) start_direct ;;
    4) stop_direct ;;
    5) restart_direct ;;
    6) status_direct ;;
    7) logs_direct ;;
    8) uninstall_direct ;;
    *) echo "Invalid choice. Exiting."; exit 1 ;;
  esac
}

show_docker_menu() {
  echo
  echo "====== Docker Deployment (Compose) ======"
  echo "1) Install"
  echo "2) Update"
  echo "3) Start containers"
  echo "4) Stop containers"
  echo "5) Restart containers"
  echo "6) Container status"
  echo "7) Container logs"
  echo "8) Uninstall"
  echo "========================================="
  read -p "Select an option [1-8]: " CHOICE

  case "$CHOICE" in
    1) install_docker_mode ;;
    2) update_docker_mode ;;
    3) start_docker_mode ;;
    4) stop_docker_mode ;;
    5) restart_docker_mode ;;
    6) status_docker_mode ;;
    7) logs_docker_mode ;;
    8) uninstall_docker_mode ;;
    *) echo "Invalid choice. Exiting."; exit 1 ;;
  esac
}

show_deployment_menu() {
  echo
  echo "========== ${APP_TITLE} Installer =========="
  echo "1) Direct install (systemd)"
  echo "2) Docker install (Compose)"
  echo "============================================"
  read -p "Select a deployment mode [1-2]: " MODE_CHOICE

  case "$MODE_CHOICE" in
    1) show_direct_menu ;;
    2) show_docker_menu ;;
    *) echo "Invalid choice. Exiting."; exit 1 ;;
  esac
}

show_deployment_menu
