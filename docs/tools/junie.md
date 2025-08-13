# JetBrains Junie Integration

## Overview

JetBrains Junie is an autonomous AI coding agent integrated into JetBrains IDEs. rulesync provides comprehensive integration with Junie's guidelines system, MCP servers, and ignore file patterns for enhanced AI-assisted development.

## Generated Files

| File Type | Output Path | Description |
|-----------|-------------|-------------|
| **Guidelines** | `.junie/guidelines.md` | Main configuration file (all rules combined) |
| **MCP Configuration** | `.junie/mcp.json` | Model Context Protocol servers |
| **Ignore Rules** | `.aiignore` | File access control patterns |

## Guidelines System

### Single File Approach

Junie uses a consolidated approach with all rules in one file:

- **Location**: `.junie/guidelines.md` in project root
- **Format**: Plain Markdown without complex frontmatter
- **Scope**: Team-shared, version-controlled configuration
- **Purpose**: The "brain" of Junie with persistent context

### Rule Consolidation

rulesync combines all rule types into a single, well-organized guidelines file:

- **Root Rules**: Project overview and core principles
- **Non-Root Rules**: Specific implementation guidelines
- **All Content**: Merged into structured Markdown document

## Usage Examples

### Generate Junie Configuration

```bash
# Generate only for JetBrains Junie
npx rulesync generate --junie

# Generate with verbose output
npx rulesync generate --junie --verbose

# Generate in specific directory
npx rulesync generate --junie --base-dir ./packages/frontend
```

### Import Existing Configuration

```bash
# Import from existing Junie setup
npx rulesync import --junie

# This imports from:
# - .junie/guidelines.md (main guidelines)
```

## File Organization

### Standard Structure
```
.junie/
├── guidelines.md           # Main configuration file
└── mcp.json               # MCP server configuration

.aiignore                  # File access control
```

### Content Example

**Guidelines File** (`.junie/guidelines.md`):
```markdown
# Project Guidelines for Junie

## Tech Stack
- Framework: React 18 with TypeScript
- State Management: Redux Toolkit
- Styling: Tailwind CSS
- Testing: Jest + React Testing Library

## Coding Standards
1. Use functional components with hooks
2. Prefer TypeScript interfaces over types for object shapes
3. Use meaningful variable names
4. Always write unit tests for business logic

## Architecture Patterns
- Follow clean architecture principles
- Separate concerns with clear module boundaries
- Use dependency injection for external services

## Security Guidelines
- Never run `rm -rf` commands without explicit confirmation
- Ask before installing system-wide packages
- Validate all user inputs
- Use environment variables for secrets

## Build & Deployment Commands
### Development
```bash
pnpm install
pnpm dev
```

### Testing  
```bash
pnpm test
pnpm test:watch
pnpm test:coverage
```

## Code Examples
### Preferred Component Structure
```typescript
interface UserProfileProps {
  userId: string;
  onUpdate: (user: User) => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ userId, onUpdate }) => {
  const [user, setUser] = useState<User | null>(null);
  
  // Implementation here
  return <div>{/* JSX */}</div>;
};

export default UserProfile;
```
```

## Operating Modes

### Ask Mode
- **Behavior**: Chat-style Q&A interaction
- **Guidelines Usage**: Always injected into context
- **File Access**: Respects `.aiignore` restrictions
- **Safety**: Manual approval for sensitive operations

### Code Mode  
- **Behavior**: Autonomous multi-step execution
- **Guidelines Usage**: Continuously referenced during execution
- **Permission Flow**:
  1. **Brave Mode ON** → Full trust, no confirmations
  2. **Command in Allowlist** → Auto-run without confirmation
  3. **Default** → Explicit confirmation dialog

## IDE Integration

### Settings Configuration
**Settings | Tools | Junie | Project Settings**

#### Writable Area Restriction
- Scope Junie's write access to specific subdirectories
- Files outside writable area require explicit approval
- Works with `.aiignore` for comprehensive access control

#### Action Allowlist
- **Path**: Settings | Tools | Junie | Action Allowlist  
- **Purpose**: Whitelist CLI commands using regular expressions
- **Effect**: Matching commands run without confirmation

**Safe Allowlist Examples**:
```regex
# Allow all npm scripts
^npm run \w+$

# Allow Laravel artisan commands
^\Qphp artisan \E\S+(?:\s+(?:[-\w:=]+|"[^"]*"|'[^']*'))*$

# Allow git status and log commands
^git (status|log).*$

# Allow test runners
^(npm test|yarn test|pnpm test)$
```

### Brave Mode
- **Location**: Checkbox in Code mode toolbar
- **Effect**: Bypasses ALL confirmation dialogs and ignore rules
- **Use Case**: Development sandboxes, experimental branches
- **Caution**: Use only in controlled environments

## MCP Integration

### MCP Configuration

Junie uses `.junie/mcp.json` for MCP server configuration:

```json
{
  "name": "jetbrains-ide",
  "command": "npx",
  "args": ["-y", "@jetbrains/mcp-proxy"],
  "env": {
    "IDE_PORT": "63342",
    "LOG_ENABLED": "true"
  },
  "transport": "stdio"
}
```

### IDE Proxy Server

Special integration with JetBrains IDE:

1. **Install "MCP Server" IDE plugin** when prompted
2. **Enable external connections**: Settings → Build → Debugger → "Can accept external connections"
3. **Configure proxy**: Enables Junie to run IDE refactorings and operations

### MCP Server Types
- **STDIO Transport**: Local process communication via stdin/stdout
- **HTTP Transport**: HTTP endpoint communication (future support)
- **IDE Integration**: Special proxy server for IDE operations

## Ignore File System

### .aiignore Format

Junie uses `.aiignore` with gitignore-style syntax:

```gitignore
# Comments start with hash
# Blank lines are ignored

# Exclude specific files
secrets.json
api-keys.txt
.env.local

# Exclude directories  
secrets/
private/
confidential/

# Exclude file patterns
*.key
*.pem
*.p12
*.pfx

# Negation patterns (re-include)
!secrets/README.md
```

### Security-Focused Configuration
```gitignore
# Source control metadata
.git/
.idea/
*.iml

# Build artifacts
/out/
/dist/
/target/
*.jar
*.class

# Secrets & credentials
.env
.env.*
!.env.example
*.pem
*.key
secrets/

# Large data files
*.csv
*.xlsx
*.sqlite
data/
datasets/
```

### Ignore Behavior
- **File Names Visible**: Ignored files appear in project tree
- **Content Protected**: Cannot be read automatically by AI
- **Confirmation Required**: AI asks permission before accessing
- **Brave Mode Override**: Brave mode can bypass ignore rules

## Best Practices

### Guidelines Design
1. **Keep Concise**: Focus on essential project-specific information
2. **Be Specific**: Provide concrete examples rather than vague principles  
3. **Include Examples**: Show preferred code patterns and structures
4. **Version Control**: Commit guidelines to share with team
5. **Regular Updates**: Keep guidelines current with project evolution

### Security Configuration
1. **No Secrets**: Never include API keys or sensitive data in guidelines
2. **Safe Commands**: Only allowlist idempotent, safe CLI commands
3. **Review Changes**: Carefully review Junie's initial commits and PRs
4. **Gradual Trust**: Start restrictive, gradually relax as confidence builds

### Team Workflow
1. **Early Creation**: Establish guidelines early in project lifecycle
2. **Team Review**: Have team approve initial guidelines
3. **Consistent Format**: Use standardized template across projects  
4. **Regular Maintenance**: Update guidelines as project evolves
5. **Documentation**: Document custom allowlist patterns

## Integration Benefits

### Development Experience
- **Autonomous Assistance**: Junie can perform multi-step tasks independently
- **Context Awareness**: Guidelines provide persistent project understanding
- **IDE Integration**: Deep integration with JetBrains development environment
- **Safety Controls**: Multiple layers of access control and confirmation

### Team Collaboration
- **Shared Guidelines**: Team members work with consistent AI behavior
- **Knowledge Transfer**: Guidelines capture team practices and standards
- **Onboarding Efficiency**: New developers get immediate project context
- **Quality Consistency**: AI follows established coding patterns

## Migration Strategies

### From Manual Setup
1. **Audit Existing**: Review current `.junie/guidelines.md`
2. **Organize Content**: Structure guidelines using rulesync format
3. **Import to rulesync**: Convert to `.rulesync/` structure
4. **Generate Configuration**: Create organized guidelines file

### From Other AI Tools
1. **Multi-Tool Import**: Import rules from various AI tools
2. **Content Consolidation**: Merge into single guidelines file
3. **IDE Adaptation**: Adjust for JetBrains IDE environment
4. **Team Training**: Educate team on Junie workflow

## Troubleshooting

### Common Issues
1. **Guidelines Not Applied**: Check file location and syntax
2. **Permission Errors**: Review `.aiignore` patterns and allowlist
3. **Performance Issues**: Optimize guidelines length and complexity
4. **IDE Integration**: Verify MCP proxy server configuration

### Debugging Steps
1. **Check File Structure**: Verify `.junie/guidelines.md` exists
2. **Review Content**: Ensure guidelines are clear and specific
3. **Test Permissions**: Verify ignore patterns and allowlist work
4. **Monitor Behavior**: Track how well guidelines guide Junie

## Advanced Configuration

### Multi-Project Guidelines
```markdown
# Multi-Module Project Guidelines

## Module Structure
- `/frontend` - React TypeScript application
- `/backend` - Node.js Express API  
- `/shared` - Common utilities and types

## Development Workflow
When working in different modules:

### Frontend Development
- Use React 18 with functional components
- Implement proper TypeScript interfaces
- Follow atomic design patterns

### Backend Development  
- Use Express with TypeScript
- Implement proper error handling
- Use dependency injection
```

### Environment-Specific Rules
```markdown
# Environment Guidelines

## Development Environment
- Enable verbose logging
- Use development database
- Allow experimental features

## Production Environment
- Minimize logging output
- Use production configurations
- Require manual deployment approval
```

## See Also

- [MCP Integration](../features/mcp.md) - Model Context Protocol configuration
- [Configuration](../configuration.md) - General configuration options
- [Best Practices](../guides/best-practices.md) - Guidelines organization strategies