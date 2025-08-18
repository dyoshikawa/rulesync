# Adding Support for New AI Tools

This document provides a standardized 9-step workflow for adding support for new AI development tools to rulesync.

## Quick Reference Workflow

### 1. **Research & Planning**
- Study the target AI tool's configuration format
- Identify file locations and naming conventions
- Document MCP support and ignore file patterns
- Plan integration approach (registry-based vs custom)

### 2. **Generator Implementation**
- Choose registry-based approach for simple tools
- Implement custom generator for complex requirements
- Follow established patterns from existing tools

### 3. **MCP Configuration**
- Add MCP server configuration generator
- Support all transport types (STDIO, SSE, HTTP)
- Implement environment variable handling

### 4. **Ignore/Permission Files**
- Create security-focused ignore patterns
- Use shared factory for consistent behavior
- Support tool-specific exclusions

### 5. **Parser Implementation**
- Add import functionality for existing configurations
- Handle multi-file and hierarchical patterns
- Implement error recovery and validation

### 6. **Integration Points**
- Register tool target in type definitions
- Update core generator and importer
- Add CLI command support

### 7. **Comprehensive Testing**
- Write 250-350 lines of tests per tool
- Cover all scenarios and error cases
- Test directory structure compatibility
- Validate legacy flag support

### 8. **Documentation**
- Create comprehensive specifications
- Update user documentation
- Add tool-specific examples
- Document MCP and ignore patterns

### 9. **Quality Assurance**
- Run full test suite
- Validate with actual AI tool
- Review code quality and security
- Update CI/CD if needed

## Detailed Implementation Guide

For complete implementation details, examples, and best practices, see the comprehensive guide in **[CONTRIBUTING.md](./CONTRIBUTING.md#adding-new-ai-tools---registry-based-workflow)**.

### Key Benefits of Registry Pattern

- **90% Less Boilerplate**: Registry handles common generation patterns
- **Consistent Behavior**: Shared factories ensure uniform output
- **Type Safety**: Strongly typed configurations prevent runtime errors
- **Easy Maintenance**: Changes to shared patterns benefit all tools

### Implementation Time

- **Simple tools**: ~4-6 hours (down from 2-3 days)
- **Complex tools**: ~1-2 days with comprehensive testing
- **Directory structure support**: Automatic through registry pattern

## Recent Success: Amazon Q CLI

The Amazon Q Developer CLI integration demonstrates the streamlined workflow:

✅ **Complete implementation** with rules, MCP, and built-in commands documentation  
✅ **Comprehensive testing** with full scenario coverage  
✅ **Registry pattern usage** for consistent behavior  
✅ **Documentation integration** with specifications and examples  
✅ **Backward compatibility** with legacy directory structures  

## Getting Started

1. **Review the detailed workflow** in [CONTRIBUTING.md](./CONTRIBUTING.md#adding-new-ai-tools---registry-based-workflow)
2. **Study existing implementations** like Windsurf or Amazon Q CLI
3. **Use the registry pattern** for maximum efficiency
4. **Follow testing standards** for reliability
5. **Maintain documentation** for team collaboration

## Support

- Open an issue for questions about the workflow
- Reference existing tool implementations as examples
- Use the registry pattern whenever possible
- Follow established testing and documentation standards