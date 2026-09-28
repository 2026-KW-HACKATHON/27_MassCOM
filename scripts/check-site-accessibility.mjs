#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const [htmlPath, cssPath] = process.argv.slice(2);

if (!htmlPath || !cssPath) {
  console.error('usage: check-site-accessibility.mjs <html> <css>');
  process.exit(1);
}

const html = readFileSync(htmlPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

function fail(message) {
  console.error(`site accessibility check failed: ${message}`);
  process.exit(1);
}

// Resolves the first (light) declaration, following `--alias: var(--token)` chains to a hex color.
function cssVariable(name, seen = new Set()) {
  if (seen.has(name)) return undefined;
  seen.add(name);
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedName}\\s*:\\s*(?:(#[0-9a-f]{6})|var\\(\\s*(--[\\w-]+)\\s*\\))`, 'i'));
  if (match?.[2]) return cssVariable(match[2], seen);
  return match?.[1];
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function requireContrast(foregroundName, backgroundName) {
  const foreground = cssVariable(foregroundName);
  const background = cssVariable(backgroundName);

  if (!foreground || !background) {
    fail(`missing color token ${foregroundName} or ${backgroundName}`);
  }

  const ratio = contrastRatio(foreground, background);
  if (ratio < 4.5) {
    fail(`${foregroundName} on ${backgroundName} has contrast ${ratio.toFixed(2)}:1, expected at least 4.5:1`);
  }
}

if (!html.startsWith('<!DOCTYPE html>')) {
  fail('HTML5 doctype must use the canonical uppercase form');
}

if (/<(?:meta|link|br)\b[^>]*\/>/i.test(html)) {
  fail('HTML void elements must not use XML self-closing syntax');
}

for (const match of html.matchAll(/<div\b([^>]*)>/gi)) {
  const attributes = match[1];
  if (/\baria-label=/i.test(attributes) && !/\brole=/i.test(attributes)) {
    fail('aria-label on a generic div requires a supported semantic role');
  }
}

if (/class="[^"]*architecture-map[^"]*"[^>]*role="img"/i.test(html)) {
  fail('architecture details must remain readable instead of being flattened into role=img');
}

requireContrast('--text-on-night', '--night');
requireContrast('--ink', '--paper');

console.log('site accessibility verified: semantic labels, HTML style, and core contrast pairs pass');
