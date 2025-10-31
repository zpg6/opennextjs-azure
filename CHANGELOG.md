# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
