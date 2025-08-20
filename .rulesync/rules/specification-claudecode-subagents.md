---
root: false
targets: ["*"]
description: "Claude Code subagents configuration specification for specialized AI assistants"
globs: []
---

# Claude Code Subagents Configuration Specification

## Overview
Claude Code supports subagents - specialized AI assistants that operate in separate context windows with custom system prompts and tool access. Subagents enable task-specific expertise and autonomous handling of complex development workflows while preventing context pollution in the main conversation.

## File Placement and Structure

### Storage Locations
Subagents are stored as Markdown files with YAML frontmatter in two hierarchical locations:

#### 1. Project-Level Subagents
- **Directory**: `.claude/agents/`
- **Location**: Project root directory
- **Scope**: Project-specific subagents shared with the team
- **Version Control**: Should be committed for team consistency
- **Precedence**: Highest priority - overrides user-level subagents with same name

#### 2. User-Level Subagents  
- **Directory**: `~/.claude/agents/`
- **Location**: User's home directory
- **Scope**: Personal subagents available across all projects
- **Precedence**: Lower priority - overridden by project-level subagents

### File Discovery
- Subagents are automatically discovered from both directories
- Project-level subagents take precedence over user-level when names conflict
- Changes are reflected immediately without restart

## File Format

### Basic Structure
- **Format**: Markdown files (`.md` extension)
- **Content**: YAML frontmatter followed by system prompt content
- **Naming**: Filename becomes the subagent identifier
- **Encoding**: UTF-8

### YAML Frontmatter Schema
```yaml
---
name: unique-subagent-name        # Required: Unique identifier
description: "Detailed description"  # Required: When to invoke this subagent
model: haiku|sonnet|opus         # Optional: Claude model selection (v1.0.64+)
tools: ["tool1", "tool2"]        # Optional: Specific tools (defaults to all)
priority: high|medium|low        # Optional: Delegation preference
environment: dev|staging|prod    # Optional: Environment-specific
team: frontend|backend|devops    # Optional: Team-specific usage
---
```

#### Required Fields
- **name**: Unique identifier (lowercase, hyphen-separated recommended)
- **description**: Detailed description of when this subagent should be invoked

#### Optional Fields
- **model**: Specify Claude model (haiku/sonnet/opus) - available in v1.0.64+
- **tools**: Comma-separated list or array of specific tools (inherits all if omitted)
- **priority**: Delegation preference for task assignment
- **environment**: Environment-specific activation
- **team**: Team or domain-specific usage

## Model Selection (Claude Code v1.0.64+)

### Available Models
- **haiku**: Low complexity tasks (documentation, simple analysis)
- **sonnet**: Medium complexity tasks (development, code review, testing)
- **opus**: High complexity tasks (security auditing, architecture review)

### Model Selection Strategy
```yaml
# Cost-effective for simple tasks
model: haiku

# Balanced performance for most development work  
model: sonnet

# Maximum capability for critical tasks
model: opus
```

## Tool Configuration

### Tool Access Inheritance
- **Default Behavior**: Subagents inherit all available tools from main thread
- **Explicit Configuration**: Use `tools` field to restrict access
- **MCP Integration**: All MCP tools are inherited unless explicitly restricted

### Tool Specification Formats
```yaml
# Array format
tools: ["Read", "Write", "Bash", "Grep"]

# Comma-separated string format
tools: Read, Write, Bash, Grep

# Inherit all tools (omit field)
# tools field not present
```

### Available Tool Categories
- **File Operations**: Read, Write, Edit, MultiEdit
- **Search Tools**: Grep, Glob  
- **System Tools**: Bash, WebFetch, WebSearch
- **Development Tools**: Task (for launching other agents)
- **MCP Tools**: All configured MCP server tools

## Subagent Configuration Examples

### Basic Code Reviewer
```markdown
---
name: code-reviewer
description: Expert code review specialist for quality, security, and maintainability analysis
model: sonnet
tools: ["Read", "Grep", "Glob"]
---

You are a senior code reviewer with expertise in multiple programming languages. 

Focus on:
1. Code quality and maintainability
2. Security vulnerabilities and best practices
3. Performance optimization opportunities
4. Architectural improvements
5. Documentation and testing coverage

Provide specific, actionable feedback with code examples where applicable.
```

### Security Auditor
```markdown
---
name: security-auditor
description: Specialized security analysis and vulnerability assessment for critical code paths
model: opus
tools: ["Read", "Grep", "Bash"]
priority: high
---

You are a cybersecurity expert specializing in application security.

Conduct comprehensive security analysis including:
- Authentication and authorization flaws
- Input validation vulnerabilities
- SQL injection and XSS risks
- Cryptographic implementation issues
- Configuration security problems
- Dependency vulnerability assessment

Provide severity ratings and remediation guidance.
```

### Documentation Writer
```markdown
---
name: doc-writer
description: Technical documentation specialist for API docs, README files, and code documentation
model: haiku
tools: ["Read", "Write", "Edit"]
team: frontend
---

You are a technical writing expert focused on clear, comprehensive documentation.

Create and maintain:
- API documentation with examples
- README files with setup instructions
- Code comments and docstrings
- Architecture decision records
- User guides and tutorials

Ensure all documentation is accurate, up-to-date, and accessible.
```

### Database Expert
```markdown
---
name: database-expert
description: Database design, optimization, and migration specialist
model: sonnet
tools: ["Read", "Write", "Bash"]
environment: prod
---

You are a database architect with expertise in relational and NoSQL databases.

Provide guidance on:
- Schema design and normalization
- Query optimization and indexing
- Migration strategies
- Performance tuning
- Data modeling best practices
- Backup and recovery procedures
```

### DevOps Engineer
```markdown
---
name: devops-engineer
description: Infrastructure, deployment, and CI/CD pipeline specialist
model: sonnet
tools: ["Read", "Write", "Bash", "WebFetch"]
---

You are a DevOps engineer specializing in modern cloud infrastructure.

Handle tasks related to:
- CI/CD pipeline configuration
- Container orchestration
- Infrastructure as Code
- Monitoring and alerting
- Security and compliance
- Performance optimization
- Disaster recovery planning
```

## Management and Operations

### Creation Methods

#### 1. Interactive Creation
```bash
# Use the /agents command in Claude Code
/agents
```
The `/agents` command provides an interactive interface for:
- Listing available subagents
- Creating new subagents
- Configuring tool access
- Managing existing subagents

#### 2. Manual File Creation
Create Markdown files directly in the appropriate directory with proper YAML frontmatter.

### Invocation Methods

#### 1. Automatic Delegation
Claude Code automatically delegates tasks to appropriate subagents based on:
- Task context and complexity
- Subagent descriptions and capabilities
- Current conversation state

#### 2. Explicit Invocation
Mention subagent by name in conversation:
```
Please have the code-reviewer subagent analyze this function
```

#### 3. Task Tool Integration
Use the Task tool to launch specific subagents:
```markdown
Task tool with subagent_type: "code-reviewer"
```

## Advanced Configuration

### Conditional Subagents
```markdown
---
name: prod-deployer
description: Production deployment specialist (production environment only)
model: opus
environment: prod
tools: ["Read", "Bash", "WebFetch"]
---

You are a production deployment expert with strict safety protocols.

Only perform deployments in production environment with:
- Comprehensive pre-deployment checks
- Rollback procedures ready
- Monitoring and alerting in place
- Security validations complete
```

### Multi-Environment Configuration
```markdown
---
name: env-config-manager
description: Environment-specific configuration management
model: sonnet
tools: ["Read", "Write", "Edit"]
---

You are an environment configuration specialist.

Manage configurations for:
- Development environment setup
- Staging environment validation  
- Production environment security
- Feature flag management
- Secret management and rotation
```

### Team-Specific Subagents
```markdown
---
name: frontend-specialist
description: Frontend development expert for React, Vue, and Angular applications
model: sonnet
team: frontend
tools: ["Read", "Write", "Edit", "Bash"]
---

You are a frontend development expert specializing in modern JavaScript frameworks.

Focus on:
- Component architecture and reusability
- State management patterns
- Performance optimization
- Accessibility compliance
- Cross-browser compatibility
- Testing strategies for frontend code
```

## Performance and Scalability

### Concurrent Execution
- **Parallel Processing**: Claude supports up to 10 concurrent subagents
- **Isolation**: Each subagent operates in isolated context
- **Resource Management**: Automatic workload distribution

### Context Management
- **Separate Contexts**: Each subagent maintains independent context window
- **Context Preservation**: Main conversation context remains focused
- **Memory Efficiency**: Prevents context pollution and bloat

### Task Distribution
```markdown
# High-performance workflow example
---
name: parallel-tester
description: Parallel test execution coordinator
model: sonnet
tools: ["Bash", "Read", "Task"]
---

You coordinate parallel test execution across multiple test suites.

Delegate specific test categories to specialized subagents:
- Unit tests to unit-test-runner subagent
- Integration tests to integration-tester subagent  
- E2E tests to e2e-specialist subagent

Aggregate results and provide comprehensive test reports.
```

## Integration with Claude Code Features

### MCP Server Integration
```markdown
---
name: database-analyst
description: Database analysis using MCP database tools
model: sonnet
tools: ["mcp__postgres__query", "mcp__postgres__schema", "Read"]
---

You are a database analyst with access to production database tools.

Use MCP database tools to:
- Analyze query performance
- Review schema design
- Generate optimization reports
- Monitor database health
```

### Memory System Integration
Subagents can reference and update Claude Code memory files:
```markdown
---
name: memory-manager
description: Claude Code memory and context management specialist
model: haiku
tools: ["Read", "Write", "Edit"]
---

You maintain and organize Claude Code memory files.

Responsibilities:
- Update project context in CLAUDE.md
- Organize memory files in .claude/memories/
- Ensure context relevance and accuracy
- Archive outdated information
```

### Custom Command Integration
Subagents can be triggered by custom slash commands:
```markdown
---
name: command-handler
description: Custom slash command processor and dispatcher
model: sonnet
tools: ["Read", "Write", "Task"]
---

You process custom slash commands and delegate to appropriate subagents.

Handle command routing and parameter processing for:
- /review - Code review subagent
- /test - Testing subagent
- /deploy - Deployment subagent
- /docs - Documentation subagent
```

## Best Practices

### Subagent Design
1. **Single Responsibility**: Each subagent should have one clear purpose
2. **Descriptive Names**: Use clear, descriptive names for easy identification
3. **Detailed Descriptions**: Write comprehensive descriptions for automatic delegation
4. **Appropriate Models**: Select models based on task complexity
5. **Tool Restrictions**: Limit tools to necessary ones for security

### Content Guidelines
1. **Clear System Prompts**: Write detailed, unambiguous instructions
2. **Specific Expertise**: Define clear areas of expertise and responsibility
3. **Examples**: Include examples of expected outputs and behaviors
4. **Error Handling**: Specify how to handle edge cases and errors
5. **Context Awareness**: Consider integration with other subagents

### Team Collaboration
1. **Version Control**: Commit project-level subagents to repository
2. **Documentation**: Document subagent purposes and usage patterns
3. **Naming Conventions**: Establish consistent naming conventions
4. **Review Process**: Include subagent changes in code reviews
5. **Testing**: Test subagent behavior before deployment

### Security Considerations
1. **Tool Access**: Restrict tool access to minimum required
2. **Environment Awareness**: Use environment-specific configurations
3. **Sensitive Operations**: Require explicit approval for critical tasks
4. **Audit Trail**: Log subagent activities and decisions
5. **Access Control**: Implement appropriate access controls

## Troubleshooting

### Common Issues
1. **Subagent Not Found**: Check file location and naming
2. **Tool Access Denied**: Verify tool configuration and permissions
3. **Model Selection Errors**: Ensure model is available in your account
4. **Delegation Issues**: Review description clarity and context
5. **Conflict Resolution**: Check for name conflicts between project/user subagents

### Debugging Steps
1. **Verify Configuration**: Check YAML frontmatter syntax
2. **Test Invocation**: Explicitly mention subagent by name
3. **Review Logs**: Check Claude Code logs for error messages
4. **Tool Validation**: Verify tool access and permissions
5. **Context Analysis**: Ensure subagent context is appropriate

### Performance Optimization
1. **Model Selection**: Use appropriate models for task complexity
2. **Tool Minimization**: Restrict tools to essential ones
3. **Context Size**: Keep system prompts concise but comprehensive
4. **Parallel Execution**: Design for concurrent processing where possible
5. **Resource Monitoring**: Monitor subagent resource usage

## Migration and Compatibility

### Version Compatibility
- **Model Selection**: Available in Claude Code v1.0.64+
- **Basic Functionality**: Compatible with all Claude Code versions
- **Tool Integration**: Depends on available tools in your version
- **MCP Support**: Requires MCP-enabled Claude Code version

### Migration Strategies
1. **Incremental Adoption**: Start with simple subagents and expand
2. **Template Usage**: Use community templates as starting points
3. **Testing**: Thoroughly test subagents before team deployment
4. **Backup**: Maintain backups of working subagent configurations
5. **Documentation**: Document migration process and decisions

This specification provides comprehensive guidance for creating and managing Claude Code subagents, enabling powerful, specialized AI-assisted development workflows with autonomous task handling and expert-level capabilities.