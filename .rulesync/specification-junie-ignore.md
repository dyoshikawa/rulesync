---
root: false
targets: ["*"]
description: "JetBrains Junie .aiignore file specification for controlling file access and privacy"
globs: "**/*"
---

# JetBrains Junie Ignore Files Specification

## Overview
JetBrains Junie uses ignore files to control which files the AI can access automatically. This provides privacy and security controls to prevent sensitive data from being sent to remote LLMs.

## File Placement and Priority

### Primary Ignore File
- **File**: `.aiignore` at project root
- **Syntax**: Identical to `.gitignore` syntax
- **Effect**: AI must ask before reading or editing matched files/directories

### Alternative Ignore Files (Auto-detected)
JetBrains AI tools automatically recognize existing ignore files:
- **`.cursorignore`**: Cursor AI ignore file
- **`.codeiumignore`**: Codeium ignore file  
- **`.aiexclude`**: Generic AI exclusion file

### Project Disable File
- **File**: `.noai` (empty file at project root)
- **Effect**: Disables ALL JetBrains AI Assistant features (including Junie)
- **Scope**: Entire project, affects all AI functionality

## Ignore Mechanism Behavior

### Default Behavior
- **File names remain visible**: Ignored files still appear in project tree
- **Content protected**: File contents cannot be read automatically by AI
- **Confirmation required**: AI asks for explicit permission before accessing ignored files

### Security Exceptions
Ignore rules can be bypassed in these scenarios:
1. **Brave Mode enabled**: AI can access any file without confirmation
2. **Action Allowlist commands**: Pre-approved CLI commands can touch ignored paths
3. **Explicit user action**: User manually provides ignored file content

## File Syntax

### Basic Patterns (Identical to .gitignore)
- **Comments**: Lines starting with `#`
- **Blank lines**: Ignored (used as separators)
- **Wildcards**:
  - `*`: Matches any characters except `/`
  - `?`: Matches any single character except `/`
  - `[abc]`: Matches any character in the set
  - `[a-z]`: Matches any character in the range

### Path Patterns
- **Leading `/`**: Anchors pattern to project root
  - `/secrets` matches only `secrets` at root
  - `secrets` matches any `secrets` directory at any level
- **Trailing `/`**: Matches only directories
  - `logs/` matches directories named `logs`
  - `logs` matches both files and directories named `logs`
- **Double asterisk `**`**: Matches zero or more directories
  - `**/temp` matches `temp` anywhere in tree
  - `config/**` matches everything under `config`
  - `**/*.log` matches all `.log` files at any depth

### Negation Patterns
- **Leading `!`**: Re-includes previously excluded items
  - Must not have trailing `/` in negation patterns
  - Cannot re-include if parent directory is excluded

## Configuration Management

### Creating .aiignore File
#### Method 1: IDE Settings
1. **Settings** → **Tools** → **AI Assistant** → **Project Settings**
2. Enable **"Enable .aiignore"** checkbox
3. Click **"Create .aiignore"** button

#### Method 2: Manual Creation
Create `.aiignore` file manually in project root using standard text editor.

### Enabling Existing Ignore Files
JetBrains AI tools automatically detect and use:
- `.cursorignore`
- `.codeiumignore` 
- `.aiexclude`

No additional configuration required for these files.

## Security-Focused Configuration Examples

### Complete Security Template
```gitignore
# ───── Source Control Metadata ─────
.git/
.svn/
.hg/
.idea/
*.iml
.vscode/settings.json

# ───── Build Artifacts ─────
/out/
/dist/
/target/
/build/
*.class
*.jar
*.war

# ───── Secrets & Credentials ─────
# Environment files
.env
.env.*
!.env.example

# Key material
*.pem
*.key
*.crt
*.p12
*.pfx
*.der
id_rsa*
id_dsa*
*.ppk

# Cloud and service configs
aws-credentials.json
gcp-service-account*.json
azure-credentials.json
secrets/**
config/secrets/
**/secrets/

# Database credentials
database.yml
**/database/config.*

# API keys and tokens
**/apikeys/
**/*_token*
**/*_secret*
**/*api_key*

# ───── Infrastructure & Deployment ─────
# Terraform state
*.tfstate
*.tfstate.*
.terraform/

# Kubernetes secrets
**/k8s/**/secret*.yaml
**/kubernetes/**/secret*.yaml

# Docker secrets
docker-compose.override.yml
**/docker/secrets/

# ───── Logs & Runtime Data ─────
*.log
*.tmp
*.cache
logs/
/var/log/
coverage/
.nyc_output/

# ───── Large Data Files ─────
*.csv
*.xlsx
*.sqlite
*.db
*.dump
data/
datasets/

# ───── Allowlist: Do let AI see main source code ─────
# (Uncomment and modify as needed)
# !src/main/**/*.java
# !src/**/*.ts
# !lib/**/*.py
```

### Framework-Specific Examples

#### Node.js Project
```gitignore
# Dependencies
node_modules/
.pnpm-store/
.yarn/

# Environment and secrets
.env*
!.env.example

# Build outputs
dist/
build/
.next/
.nuxt/

# Logs
*.log
logs/

# Cache
.cache/
.parcel-cache/

# Testing
coverage/
.nyc_output/
```

#### Java/Spring Project
```gitignore
# Build outputs
target/
out/
*.class
*.jar
*.war

# IDE files
.idea/
*.iml
.vscode/

# Application secrets
application-prod.properties
application-secrets.properties
src/main/resources/application-*.yml
!src/main/resources/application.yml
!src/main/resources/application-dev.yml

# Logs
*.log
logs/

# Database
*.db
*.sqlite
```

#### Python Project
```gitignore
# Virtual environments
venv/
.venv/
env/
.env/

# Python artifacts
__pycache__/
*.pyc
*.pyo
*.pyd
.Python
pip-log.txt

# Environment files
.env*
!.env.example

# Database
*.db
*.sqlite
*.sqlite3

# Logs
*.log

# Data
data/
datasets/
*.csv
*.xlsx
```

### Corporate/Enterprise Configuration
```gitignore
# ───── Legal & Compliance ─────
legal/
compliance/
audit/
contracts/
**/confidential/
**/proprietary/

# ───── Internal Documentation ─────
internal-docs/
company-secrets/
strategy/
financial/

# ───── Customer Data ─────
customer-data/
pii/
gdpr/
**/*customer*.csv
**/*personal*.json

# ───── Infrastructure Secrets ─────
# VPN configs
*.openvpn
*.ovpn
vpn-config/

# Certificate authorities
ca/
certificates/
ssl/

# Network configs
network-config/
firewall-rules/
```

## Integration with IDE Features

### Settings Configuration Path
**Settings** → **Tools** → **Junie** → **Project Settings**

#### Writable Area Restriction
- Scope Junie's write access to specific subdirectories
- Files outside writable area require explicit approval
- Works in conjunction with `.aiignore` for comprehensive access control

#### Action Allowlist
- **Location**: Settings → Tools → Junie → Action Allowlist
- **Purpose**: Whitelist CLI commands that can bypass ignore rules
- **Security**: Use minimal, specific regex patterns

**Safe Allowlist Examples**:
```regex
# Allow safe npm scripts only
^npm run (test|lint|build)$

# Allow git status and log commands
^git (status|log|diff --name-only)$

# Allow specific Laravel artisan commands
^php artisan (migrate:status|route:list)$
```

### Brave Mode Integration
- **Location**: Checkbox in Code mode toolbar
- **Effect**: Bypasses ALL ignore rules
- **Recommendation**: Keep disabled except in sandboxed environments

## Verification and Testing

### Testing Ignore Rules
1. Open a file that should be ignored
2. Invoke any AI action (explain code, refactor, etc.)
3. IDE should display: "AI has no access to this file"
4. Confirm dialog should appear requesting permission

### Validation Commands
```bash
# List files that would be ignored (similar to git)
find . -name ".aiignore" -exec cat {} \;

# Check specific file against ignore patterns
# (Manual verification by comparing against patterns)
```

## Best Practices

### Security Guidelines
1. **Never commit secrets**: Use environment variables and secret managers
2. **Regular audits**: Review `.aiignore` rules periodically
3. **Team consistency**: Ensure all team members use same ignore rules
4. **Principle of least privilege**: Start with restrictive rules, gradually relax
5. **Secret rotation**: If ignored files contained secrets, rotate them

### Maintenance Workflow
1. **Initial setup**: Create comprehensive `.aiignore` before enabling AI features
2. **Code review**: Include `.aiignore` changes in pull request reviews
3. **Documentation**: Document why specific patterns are ignored
4. **Regular review**: Update rules as project structure evolves
5. **Testing**: Regularly verify that sensitive files remain protected

### Team Collaboration
1. **Version control**: Commit `.aiignore` to repository
2. **Onboarding**: Include ignore file setup in developer onboarding
3. **Standards**: Establish team standards for what should be ignored
4. **Communication**: Clearly communicate ignore rules to all team members

## Advanced Security Configurations

### Network-Level Controls
For organizations requiring stricter controls:
- **Proxy/Firewall blocking**: Block `https://api.jetbrains.ai/` and Grazie endpoints
- **Air-gapped environments**: Disable AI Assistant plugin entirely
- **Corporate policies**: Use `.noai` for sensitive projects

### Multi-Layer Security
```gitignore
# Layer 1: Secrets and credentials (highest priority)
*.pem
*.key
.env*
secrets/

# Layer 2: Business-sensitive data
confidential/
proprietary/
customer-data/

# Layer 3: Infrastructure and deployment
terraform.tfstate*
kubernetes/secrets/
docker-compose.prod.yml

# Layer 4: Build artifacts and logs
build/
logs/
*.log
```

### Compliance-Focused Configuration
```gitignore
# GDPR/Privacy compliance
**/personal_data/
**/pii/
**/gdpr/
**/*customer_data*
**/*personal_info*

# SOX/Financial compliance
financial/
audit/
sox-compliance/

# HIPAA/Healthcare compliance (if applicable)
**/patient_data/
**/phi/
**/medical_records/

# PCI DSS compliance (if applicable)
**/cardholder_data/
**/payment_info/
```

## Integration with Other Tools

### Version Control Integration
- Commit `.aiignore` alongside `.gitignore`
- Use similar patterns but focus on AI-specific privacy concerns
- Consider more restrictive rules than `.gitignore`

### CI/CD Integration
- Validate `.aiignore` syntax in CI pipeline
- Ensure ignore rules don't conflict with build requirements
- Test that sensitive files remain protected

### Documentation Integration
- Include ignore file documentation in project README
- Maintain changelog of ignore rule changes
- Document exceptions and their justifications

This comprehensive ignore file specification ensures that JetBrains Junie respects privacy boundaries while enabling productive AI-assisted development workflows.