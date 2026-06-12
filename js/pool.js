// @ts-check
// Compatibility barrel. The rules engine was split into js/rules/*
// (platform plan PR 9): shared.js (primitives), tags.js (tag boundary,
// re-exports tag-model), xp.js (catalogs and pricing), equipment.js
// (weapons/armor/shields), shadow.js (boxes and Aberration), exotic.js
// (Core/Stranger/Titan), engine.js (PoolEngine). Existing importers keep
// working unchanged; new code may import the specific module directly.
export * from './rules/shared.js';
export * from './rules/tags.js';
export * from './rules/xp.js';
export * from './rules/equipment.js';
export * from './rules/shadow.js';
export * from './rules/exotic.js';
export * from './rules/engine.js';
