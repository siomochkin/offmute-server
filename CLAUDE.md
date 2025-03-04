# CLAUDE.md - Offmute Server Development Guide

## Build Commands
- `npm run build` - Build the project
- `npm run start` - Start the API server
- `npm run dev` - Build in watch mode and start server

## Project Structure
- TypeScript-based Node.js project
- ES modules format (type: "module")
- Builds with tsup for CLI, API, and library formats

## Code Style
- 2-space indentation
- Double quotes for strings
- Semicolons required
- camelCase for variables and functions
- PascalCase for interfaces and classes
- UPPER_CASE for constants

## TypeScript Guidelines
- Use proper TypeScript types for all parameters and returns
- Use interfaces for complex data structures
- Optional parameters denoted with ? notation
- strictNullChecks not enforced (commented out in tsconfig)

## Error Handling
- Use try/catch blocks for main functions
- Handle Promise rejections properly in async code
- Log errors with descriptive messages

## Imports
- Group related imports together
- Use destructured imports for multiple items from same module
- Node.js built-ins first, then external libraries

## Git Guidelines
- Keep commits focused on single responsibilities
- Follow existing message format in repo