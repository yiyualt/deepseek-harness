# Agent Note: Built-in Armor HUD theme

Status: implemented

English | [中文](2026-08-16-built-in-armor-hud-theme.zh.md)

## Problem

The web application needs an expressive cinematic interface option without replacing the existing neutral themes or depending on protected franchise artwork, names, and logos. A color-only third-party registration cannot provide a complete product choice because it is not listed in Appearance, does not persist through the built-in settings schema, and cannot apply theme-specific typography or global display details before the client plugin tree activates.

## Decision

`armor` is a built-in persisted theme preference beside `light`, `dark`, and `system`. It resolves to the dark native-control color scheme and appears in the Appearance row as Armor HUD. The Host bootstrap and `ThemePresenter` both write the resolved id to `body[data-dsh-theme]`; the bootstrap also writes the dark-palette attribute before the loading shell renders, and the presenter owns and retracts both attributes after activation.

`armor.css` owns the theme's original visual language: carbon-black surfaces, reactor-red actions, arc-cyan information and borders, square controls, a system monospace stack, hard-edged elevation, and a static scanline overlay. Semantic `--dsw-*` aliases continue to carry colors into feature CSS, while the named body attribute is reserved for theme-wide details that are not color tokens. Registered extension themes still use alias-token overrides and remain process-local.

The settings schema, component test, Host validation, bootstrap test, presenter test, and assembled browser settings scenario all accept the built-in id. The browser scenario selects Armor HUD through the real Appearance control and verifies its theme id, dark palette, typography, durable settings value, reload, and a second origin sharing the same Harness home.

## Alternatives considered

**Replace the existing dark theme.** Rejected because the cinematic treatment is intentionally stronger than a general-purpose dark palette and users need a neutral option.

**Register Armor HUD as an extension theme.** Rejected because extension ids intentionally do not cross the Host settings schema and are not listed by the built-in Appearance row, so the user's choice would not survive a reload.

**Copy a Marvel character, logo, or film interface.** Rejected because the product needs an original, redistributable identity. The theme uses the broad cinematic-HUD genre without protected artwork or franchise branding.

**Encode every visual difference as inline theme tokens.** Rejected because the bootstrap must establish the treatment before ThemeRuntime activates, and typography, square geometry, and the scanline overlay are global CSS behavior rather than semantic color values.

## Consequences

Users can select and persist a pronounced cinematic pixel-HUD style without losing the existing themes. The presenter gains one owned DOM attribute, and every built-in preference must now remain valid in the Host bootstrap as well as ThemeRuntime. The visual treatment stays centralized in `ui-theme`; feature packages continue to consume semantic tokens and carry no Armor-specific selectors. The theme deliberately favors atmosphere over the neutral themes' typographic compactness, while preserving focus states, readable contrast, pointer behavior, and static reduced-motion-safe effects.
