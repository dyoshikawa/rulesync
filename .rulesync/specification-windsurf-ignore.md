---
root: false
targets: ["windsurf"]
description: "Windsurf AI assistant ignore files configuration specification"
globs: [".codeiumignore", ".cursorignore", ".aiexclude", ".aiignore", ".noai", "**/.gitignore"]
---

# Windsurf AI Assistant Ignore Files Configuration Specification

## Overview
Windsurf provides multiple layers of control over what files and directories the AI assistant (Cascade, chat, autocomplete, etc.) can access. This includes automatic exclusions and manual control through ignore files to protect sensitive data and improve performance.

## Automatic Exclusions

### Default Ignored Patterns
Windsurf automatically excludes these patterns from AI access:
- **Everything in .gitignore**: All files and directories already listed in `.gitignore`
- **node_modules/**: All Node.js dependency directories
- **Hidden files and directories**: Any file or directory whose name starts with a dot (.)

### Behavior
- These files are never indexed, embedded, or sent to Windsurf's servers
- Files don't count against workspace size limits
- No configuration required - exclusions are automatic

## Manual Ignore Files

### Primary Ignore File: .codeiumignore

#### File Placement and Scope
- **Location**: `.codeiumignore` in the root of the repository/workspace
- **Scope**: Entire workspace (only one file read per workspace)
- **Limitation**: Nested `.codeiumignore` files in subdirectories are ignored

#### Purpose and Behavior
- Tell Windsurf "never index these paths, even if they are NOT in .gitignore"
- File names remain visible in project tree
- File contents cannot be read automatically by AI
- AI must ask for explicit permission before accessing ignored files

#### Syntax (Identical to .gitignore)
The `.codeiumignore` file uses the same syntax as `.gitignore`:

##### Basic Patterns
- **Comments**: Lines starting with `#` are ignored
- **Blank lines**: Used as separators, ignored by parser
- **Wildcards**:
  - `*`: Matches any characters except `/`
  - `?`: Matches any single character except `/`
  - `[abc]`: Matches any character in the set
  - `[a-z]`: Matches any character in the range

##### Path Patterns
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

##### Negation Patterns
- **Leading `!`**: Re-includes previously excluded items
  - Must not have trailing `/` in negation patterns
  - Cannot re-include if parent directory is excluded

#### Example .codeiumignore Configuration
```gitignore
# Keep API keys totally out of AI context
*.env
*.key

# Block large media & build artifacts
dist/
build/
**/*.mp4
*.pdf

# Ignore every secrets/ dir anywhere, but keep template files
secrets/
!secrets/*.sample

# Sensitive documentation
internal-docs/
confidential/
proprietary/

# Database files
*.db
*.sqlite
*.dump

# Logs and temporary files
*.log
*.tmp
logs/
temp/

# Certificate and key files
*.pem
*.crt
*.p12
*.pfx
*.der
id_rsa*
id_dsa*
*.ppk

# Cloud and service configurations
aws-credentials.json
gcp-service-account*.json
azure-credentials.json
**/apikeys/
**/*_token*
**/*_secret*
**/*api_key*
```

### Alternative Ignore Files (Auto-detected)

For compatibility with other AI tools, Windsurf automatically recognizes these ignore files if they exist and `.codeiumignore` does not:

#### .cursorignore
- **Source**: Cursor AI ignore file
- **Behavior**: Same syntax and functionality as `.codeiumignore`
- **Precedence**: Used only if `.codeiumignore` doesn't exist

#### .aiexclude
- **Source**: Generic AI exclusion file
- **Behavior**: Same syntax and functionality as `.codeiumignore`
- **Precedence**: Used only if neither `.codeiumignore` nor `.cursorignore` exist

#### .aiignore
- **Source**: Generic AI ignore file
- **Behavior**: Same syntax and functionality as `.codeiumignore`
- **Precedence**: Lowest priority among ignore files

### Project-Wide Kill Switch: .noai

#### Complete AI Disable
- **File**: Empty file called `.noai` in project root
- **Effect**: Turns off ALL AI features for the project
- **Scope**: Affects entire project, disables all AI functionality
- **Use Case**: Projects requiring complete AI exclusion

#### Implementation
```bash
# Create .noai file to disable all AI features
touch .noai
```

## Privacy and Security Controls

### Data Processing Modes

#### Local vs Remote Processing
- **Local Indexing**: Embeddings stored only on your machine
- **Transient Processing**: Code snippets sent to servers temporarily for embedding computation
- **No Persistence**: Neither code nor embeddings are stored server-side
- **Zero-Data-Retention**: Available for Team & Enterprise tiers, can be toggled in user profile

#### Disabling Indexing Entirely
- **Location**: Settings → Windsurf Search → Toggle indexing off
- **Effect**: Nothing is embedded, AI only sees manually opened or pinned files
- **Use Case**: Maximum privacy for sensitive projects

### Security Bypass Scenarios

Ignore rules can be bypassed in these specific scenarios:
1. **Brave Mode enabled**: AI can access any file without confirmation
2. **Action Allowlist commands**: Pre-approved CLI commands can touch ignored paths
3. **Explicit user action**: User manually provides ignored file content

## Configuration Examples by Use Case

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

### Enterprise/Corporate Configuration
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

## File Processing Behavior

### Incremental Indexing
- Changes to ignore files are processed immediately upon save
- Windsurf stops embedding newly ignored paths
- Existing embeddings for ignored files are removed from local vector store
- AI chat, autocomplete, and search can no longer access ignored files

### File Visibility vs Access
- **File names**: Remain visible in project tree and file explorer
- **Content access**: Blocked from automatic AI access
- **Manual access**: Requires explicit user permission through confirmation dialog

### Upload Prevention
- Ignored files will not be uploaded in rare cases of remote indexing
- Provides protection even when using cloud-based AI features

## Best Practices and Recommendations

### Security Guidelines
1. **Never commit secrets**: Use environment variables and secret managers
2. **Regular audits**: Review `.codeiumignore` rules periodically
3. **Team consistency**: Ensure all team members use same ignore rules
4. **Principle of least privilege**: Start with restrictive rules, gradually relax
5. **Secret rotation**: If ignored files contained secrets, rotate them

### Quick Checklist for Sensitive Projects
- ☑ Put secret-bearing files (`.env*`, `*.pem`, `*.key`) in `.gitignore`
- ☑ Add same patterns to `.codeiumignore` for AI protection
- ☑ Enable zero-data-retention in Profile → Privacy
- ☑ Use `.noai` file for completely private repositories
- ☑ Regular review and update of ignore patterns
- ☑ Document ignore patterns for team understanding

### Maintenance Workflow
1. **Initial setup**: Create comprehensive `.codeiumignore` before enabling AI features
2. **Code review**: Include `.codeiumignore` changes in pull request reviews
3. **Documentation**: Document why specific patterns are ignored
4. **Regular review**: Update rules as project structure evolves
5. **Testing**: Regularly verify that sensitive files remain protected

### Team Collaboration
1. **Version control**: Commit `.codeiumignore` to repository
2. **Onboarding**: Include ignore file setup in developer onboarding
3. **Standards**: Establish team standards for what should be ignored
4. **Communication**: Clearly communicate ignore rules to all team members
5. **Training**: Educate team on proper ignore file usage

## Integration with Development Workflows

### Version Control Integration
- Commit `.codeiumignore` alongside `.gitignore`
- Use similar patterns but focus on AI-specific privacy concerns
- Consider more restrictive rules than `.gitignore`
- Track changes through pull request reviews

### CI/CD Integration
- Validate `.codeiumignore` syntax in CI pipeline
- Ensure ignore rules don't conflict with build requirements
- Test that sensitive files remain protected
- Automate ignore pattern validation

### Documentation Integration
- Include ignore file documentation in project README
- Maintain changelog of ignore rule changes
- Document exceptions and their justifications
- Provide examples for common use cases

## Troubleshooting and Validation

### Testing Ignore Rules
1. Open a file that should be ignored
2. Invoke any AI action (explain code, refactor, etc.)
3. IDE should display: "AI has no access to this file"
4. Confirm dialog should appear requesting permission

### Common Issues and Solutions
- **Rules not working**: Check file location (must be in workspace root)
- **Syntax errors**: Validate against gitignore syntax rules
- **Performance issues**: Monitor impact of complex patterns
- **Team inconsistencies**: Standardize ignore files across team

### Validation Commands
```bash
# List files that would be ignored (similar to git)
find . -name ".codeiumignore" -exec cat {} \;

# Test specific patterns (manual verification required)
# Compare file paths against ignore patterns
```

This comprehensive specification enables effective implementation of Windsurf ignore file management in rulesync, ensuring sensitive data protection while maintaining productive AI-assisted development workflows.