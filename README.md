# Storybook Studio

Desktop visual regression testing for Storybook, built on [Loki](https://github.com/oblador/loki).

This repository is a fork of **oblador/loki**. It keeps Loki's source code and history and adds a standalone Electron application in [`desktop/`](desktop/). The desktop app uses Loki 0.35 packages with the compatibility patches in [`desktop/patches/`](desktop/patches/); the upstream packages are preserved separately.

## Desktop application

- Manage multiple Storybook projects: source folder, static build, or URL.
- Capture screenshots locally using a pinned Chrome Docker image.
- Browse baselines and run history; review results while a run is in progress.
- Compare screenshots side by side, as a diff, or with an opacity overlay.
- Accept or reject changes manually; preserve the original images for every run.
- Use default settings or an optional external JSON/CJS configuration.
- No built-in application-specific story IDs, API mocks, or private project data.

The desktop application currently targets **Linux x64**. Compatibility fixtures cover React and Vue with Storybook 8.5.8 and HTML with Storybook 9.1.0 and 10.6.1. Other versions and operating systems are not yet covered by the test matrix.

## Quick start

Install Node.js 22.12 or newer, pnpm 9.15.9, and Docker accessible to your user, then run:

```sh
git clone https://github.com/naghti/storybook-studio.git
cd storybook-studio/desktop
pnpm install --frozen-lockfile
pnpm start
```

To build and install the Linux desktop application:

```sh
pnpm run package
node scripts/install.cjs
```

The application stores user projects and screenshots outside this repository. Project-specific configuration is optional and is not bundled with the application.

See the [desktop documentation (Russian)](desktop/README.md) for setup, configuration, screenshot review, compatibility limits, and the Electron sandbox configuration.

## Tests

Run these commands from `desktop/`:

```sh
pnpm test
pnpm fixtures:build
pnpm test:integration
pnpm test:ui
```

Integration tests use real Storybook builds and Chrome in Docker. They cover render and play errors, missing resources, indefinitely pending API requests, external configuration, and repeatable screenshots. UI tests require a graphical session; on CI, use `xvfb-run -a pnpm test:ui`.

## Upstream Loki

The original CLI documentation remains in [`packages/loki/README.md`](packages/loki/README.md). Upstream packages, examples, and website sources are retained for provenance and further development. The workflow in this fork checks the desktop application; it does not publish npm packages or deploy the upstream website.

## License

Loki retains its original [MIT license and copyright](LICENSE). Desktop additions are covered by [`desktop/LICENSE`](desktop/LICENSE).
