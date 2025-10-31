# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Health check now validates static asset cache headers are configured correctly.
- Health check now performs HTTP request to verify Function App is responding (with response time).

### Fixed

- Static assets on Azure Blob Storage now have proper cache-control headers (\_next/static files have `immutable` with 1-year cache, other assets have `must-revalidate`).
- Static asset redirects now conditionally set cache headers based on file path (only \_next/static files get immutable cache).
- `_next/data` files are no longer redirected to blob storage, allowing proper ISR cache handling through the function app.

## [0.1.2] - 2025-10-30

### Added

- Health check command for validating deployment status.
- Delete command for removing resource groups with confirmation prompt.

### Fixed

- Only return error message and stack trace in HTTP response in development mode.

## [0.1.1] - 2025-10-29

### Added

- CI workflow for building library.
- CI workflow for building example application.
- Application Insights integration for logs and monitoring.
- Log stream quick access from CLI via `tail` command.
- Auto-registration of `Microsoft.AlertsManagement` resource provider.
- Basic example application demonstrating usage.
- README and LICENSE documentation.
- Documentation on Azure resources used by the project.
- Documentation noting Application Insights as default monitoring solution.
- Instructions for how basic-app example was generated.

### Fixed

- `.open-next` folder now properly cleaned on each build.
- Bundler issues with `console.error` statements.
- Bicep template synchronization during deployment.
- Relative paths for configuration imports.
- `create-next-app` usage must avoid using turbopack flag.
- Stream handling now properly awaited.
