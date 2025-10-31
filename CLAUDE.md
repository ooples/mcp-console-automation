# Claude Development Guidelines

## Project Information
- **Repository**: https://github.com/ooples/console-automation-mcp
- **Description**: Console Automation MCP - A tool for managing console sessions with SSH support
- **Important**: This is the ooples/console-automation-mcp project (formerly mcp-console-automation)

## Important Rules

### Code Organization and Improvements

1. **NO SEPARATE "IMPROVED" VERSIONS**: When making enhancements or fixes:
   - Always modify the original file or class directly
   - Do NOT create separate "Improved", "Enhanced", "Fixed" or similar versions
   - Maintain a single source of truth for each component
   - If significant changes are needed, refactor the existing code instead of duplicating

2. **Version Management**:
   - Use version control (git) for tracking changes, not file duplication
   - Keep the codebase clean and maintainable with single implementations
   - Document major changes in comments or commit messages, not separate files

3. **Testing and Validation**:
   - Always run lint and typecheck commands after making changes
   - Test changes thoroughly before considering work complete
   - Run: `npm run lint` and `npm run typecheck` (or equivalent commands)

## Project-Specific Guidelines

### Console Automation MCP (ooples/console-automation-mcp)

- This project handles console session management with comprehensive diagnostics
- Original working version available at: https://github.com/ooples/console-automation-mcp
- Previous package name was mcp-console-automation (maintained for backward compatibility)
- Key components:
  - ConsoleManager: Core session management
  - DiagnosticsManager: Diagnostic tracking and reporting
  - SessionValidator: Session health validation

### Session Management Best Practices

- Properly handle both one-shot and persistent sessions
- Validate session state before operations
- Clean up resources and handle errors gracefully
- Track session lifecycle events for diagnostics