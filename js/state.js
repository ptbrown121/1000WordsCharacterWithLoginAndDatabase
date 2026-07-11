// @ts-check
// Shared mutable UI state.
//
// Per refactor PR #2 (split-app-js): we keep these as properties on a single
// exported object so consumer code can read AND write through one import,
// while still getting them out of true module-global `let` bindings.
// A future PR can tighten access (getters/setters, scoping per-feature)
// without touching every call site again.

/** @type {import('./types.js').UiState} */
export const uiState = {
    // The single tile selected as the "Call" for a roll, or null.
    callTile: null,
    // Selected GM Call colors. The first two are mirrored into the legacy
    // hidden selects for compatibility with older UI code.
    callColors: [],
    // Hitched tiles selected as additional called dice. These cost Hitch EN
    // and add dice, but they are not burn tiles and do not grant +1 Add.
    hitchCallTiles: [],
    // Tiles being burned for this roll. Array of tile objects.
    burnTiles: [],
    // Chain IDs the user has explicitly disabled for this roll.
    disabledChainIds: new Set(),
    // Chain ID -> selected normal color for ambiguous chain links.
    chainColorSelections: {},
    // Tag-bonus IDs the user has opted into for this roll.
    selectedTagBonusIds: new Set(),
    // Result of the most recent roll/calculate, kept for re-renders.
    lastRollResult: null,
    // Active resolution mode: 'action' | 'attack' | 'defense' | 'healing'.
    currentResolutionMode: 'action',
    // Map of roll-id -> assignment slot for the current resolution.
    currentResolutionAssignments: {},
    // Map of ammo tile id -> roll id selected for ammo supply resolution.
    ammoAssignments: {},
    // Map of roll id -> resource key ('hp'|'en'|'rx'|'sh') chosen to pay
    // that maxed die's chain cost. Reset per roll.
    chainCostSelections: {},
    // Whether healing-in-combat penalties apply to the current roll.
    healingInCombat: false,
    // Map of gear tile id -> whether its Shield tags protect this defense.
    // Unset entries default by kind: armor shields on, weapon/gear shields
    // off (the weapon must be ready as a defense - GM adjudicated).
    defenseShieldSelections: {}
};

// NOTE: a `resetTransientState()` helper is intentionally NOT added here.
// The four sites in app.js that reset transient state today only clear
// `callTile` and `burnTiles` - they do NOT clear lastRollResult,
// disabledChainIds, etc. A reset helper would have to either match that
// narrow scope (low value) or expand it (behavior change). Deferring to a
// follow-up PR per the no-behavior-change rule of the split.
