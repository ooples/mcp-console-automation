# Changelog

## [1.1.3](https://github.com/ooples/mcp-console-automation/compare/v1.1.2...v1.1.3) (2026-07-15)


### Bug Fixes

* **ssh:** stop acknowledging commands on their own output, which wedged long sessions ([#95](https://github.com/ooples/mcp-console-automation/issues/95)) ([ffb7a45](https://github.com/ooples/mcp-console-automation/commit/ffb7a456634569df080a528af91b2e66dc818a7b))

## [1.1.2](https://github.com/ooples/mcp-console-automation/compare/v1.1.1...v1.1.2) (2026-07-15)


### Bug Fixes

* harden console automation mcp ([#92](https://github.com/ooples/mcp-console-automation/issues/92)) ([3e7d369](https://github.com/ooples/mcp-console-automation/commit/3e7d3696f40c0b2e0e705630eb78b7d4ab88747e))

## [1.1.1](https://github.com/ooples/mcp-console-automation/compare/v1.1.0...v1.1.1) (2026-07-09)


### Bug Fixes

* **remote:** honor private-key path, find git bash, run shell builtins via shell ([#80](https://github.com/ooples/mcp-console-automation/issues/80)) ([e6615b2](https://github.com/ooples/mcp-console-automation/commit/e6615b23937df85417791df0843d87de8143d4a1))

## [1.1.0](https://github.com/ooples/mcp-console-automation/compare/v1.0.2...v1.1.0) (2026-07-08)


### Features

* add support for interactive .NET console applications ([#14](https://github.com/ooples/mcp-console-automation/issues/14)) ([fc14566](https://github.com/ooples/mcp-console-automation/commit/fc1456603c1ea57b7f7329aae435f1db2c50ec1e))
* **release:** migrate from semantic-release to release-please ([#85](https://github.com/ooples/mcp-console-automation/issues/85)) ([21dacad](https://github.com/ooples/mcp-console-automation/commit/21dacadbea169bd3949e01de012260de1dce3d66))


### Bug Fixes

* add explicit GitHub OIDC login before publishing ([941be1e](https://github.com/ooples/mcp-console-automation/commit/941be1ed9c676910e6ca52f58ea65f6488f2e10b))
* add timeout cleanup and increase test timeout values ([eef0a6e](https://github.com/ooples/mcp-console-automation/commit/eef0a6e3ce3bc9fba390408046d9e0d07345d04c))
* add timer cleanup for docker protocol connection monitoring and reconnection ([5d4ece7](https://github.com/ooples/mcp-console-automation/commit/5d4ece747c2c14dcc5d44a072593f3684317a071))
* add workerpool timeout cleanup to prevent memory leaks ([2e304eb](https://github.com/ooples/mcp-console-automation/commit/2e304eb619c4fe4919a3096a9721a049cd0e18e9))
* build MCP Publisher from source instead of npm ([19d5e24](https://github.com/ooples/mcp-console-automation/commit/19d5e245388a366375ca2df3c3dd8c56a87ce9c7))
* **ci:** repair the test suite and formatting (53 failures -&gt; 0) ([#81](https://github.com/ooples/mcp-console-automation/issues/81)) ([fb1e6ea](https://github.com/ooples/mcp-console-automation/commit/fb1e6ea2c1be0de52490f76beba03eb9de1fc4d5))
* convert ES module mocks to CommonJS format for Jest compatibility ([c6be03b](https://github.com/ooples/mcp-console-automation/commit/c6be03bb103ec1c657c4a0aa6225ded10fb2574a))
* convert jest mocks to mjs format for es module compatibility ([811f5f2](https://github.com/ooples/mcp-console-automation/commit/811f5f237909a3113857c7565e9ef0ff8b201fe5))
* enable unit tests with ESM package mocks ([70dbff4](https://github.com/ooples/mcp-console-automation/commit/70dbff4c89ac04620246f34d4478ff1fa3448106))
* handle protected branch push gracefully in MCP registry workflow ([fd4dcb9](https://github.com/ooples/mcp-console-automation/commit/fd4dcb90e9a941c1304261d2d77f5a6965f3395a))
* make Docker publishing optional to prevent release failures ([f689f66](https://github.com/ooples/mcp-console-automation/commit/f689f6691e767057deb927022b43911e0dd7e9ba))
* make server.json commit step optional ([8d649b9](https://github.com/ooples/mcp-console-automation/commit/8d649b9245c72453b8309b4d0dabb92ff83418d0))
* **release:** add the conventionalcommits changelog preset dependency ([#84](https://github.com/ooples/mcp-console-automation/issues/84)) ([a7400ac](https://github.com/ooples/mcp-console-automation/commit/a7400acfaca62a8d79f77606ffe3df2ee245bd5d))
* **release:** point semantic-release at the real github repository ([#83](https://github.com/ooples/mcp-console-automation/issues/83)) ([1375c5d](https://github.com/ooples/mcp-console-automation/commit/1375c5dec96e6db3d87d9fdfd2c061552e075d54))
* remove redundant command option from localprotocol platform tests and fix timer leak ([8dba508](https://github.com/ooples/mcp-console-automation/commit/8dba5083500bc5f2ff51ce8f22f3809e62e690e5))
* resolve jest es module import errors and wsl protocol compatibility ([09f7ffe](https://github.com/ooples/mcp-console-automation/commit/09f7ffeacdfb5b8634f7bc24f1efd83795a08027))
* skip hardware-intensive integration and stress tests in ci ([4b4b444](https://github.com/ooples/mcp-console-automation/commit/4b4b4441c61d7e00ab85a00c05c094594e7538e3))
* use GitHub OIDC authentication for MCP registry ([392b021](https://github.com/ooples/mcp-console-automation/commit/392b021bf50bbcd8568ec5d82eee9521e17cd787))
