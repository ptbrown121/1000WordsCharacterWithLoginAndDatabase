// @ts-check
// Central JSDoc typedefs for rules, persisted shapes, and application boundaries.
// No runtime code: this file only feeds `npm run typecheck` (tsc with
// checkJs) and editor IntelliSense. Files opt in with `// @ts-check` and
// import these via `@typedef {import('./types.js').Tile} Tile` comments.
//
// The shapes are deliberately permissive where legacy saves vary (e.g.
// `tags` may be a string[] or a legacy comma-separated string); the
// normalizers in pool.js/data.js are the choke points that accept the
// loose side and hand the strict side onward.

/**
 * @typedef {'d3'|'d4'|'d6'|'d8'|'d10'|'d12'|'d14'|'d16'} Die
 */

/**
 * @typedef {'Red'|'Orange'|'Yellow'|'Green'|'Blue'|'Purple'} NormalColor
 */

/**
 * @typedef {'hp'|'en'|'rx'} ResourceKey
 */

/**
 * A tile color/shadow box (p.11 / p.58). Normalized form produced by
 * normalizeTileBox; legacy saves may carry looser objects or plain color
 * strings in `tile.colors`.
 * @typedef {Object} TileBox
 * @property {'color'|'shadow'} type
 * @property {NormalColor} [color]   present when type === 'color'
 * @property {'Qi'|'Id'} [kind]      present when type === 'shadow'
 * @property {ResourceKey|''} [resource] shadow box's chosen normal resource
 */

/**
 * @typedef {Object} ArmorType
 * @property {'Soft'|'Hard'} material
 * @property {'Open'|'Full'|'Closed'} coverage
 */

/**
 * @typedef {Object} TileWeapon
 * @property {string} [templateId]
 * @property {string} [category]  Melee | Near | Far | Burst
 * @property {string} [range]
 * @property {string} [skill]
 */

/**
 * @typedef {Object} ExoticSkill
 * @property {string} id
 * @property {string} [system]    Arcana | Stranger | Cyber
 * @property {string} [specialty] Twist | Forge | Augur | Bestial | Celestial | Cyber
 * @property {string} [label]
 * @property {number} [baseXp]
 */

/**
 * A mosaic tile. `tags` is canonically string[] but legacy saves and old
 * test fixtures store a comma-separated string; SpellBuilder items may be
 * `{name, xp}` objects. tileTagList() flattens all of these.
 * @typedef {Object} Tile
 * @property {string} id
 * @property {string} name
 * @property {'Skill'|'Trait'|'Story'|'Gear'} [type]
 * @property {string[]} [colors]   legacy color list (superseded by boxes)
 * @property {TileBox[]} [boxes]
 * @property {Die[]} dice
 * @property {string[]|string|Array<{name: string, xp?: number}>} [tags]
 * @property {number|string} [xpCost]
 * @property {boolean} [isBuried]
 * @property {boolean} [isBurnt]
 * @property {boolean} [isSpell]
 * @property {string} [gearSubtype]  Weapon | Armor | Hinder | Ammo | ...
 * @property {boolean} [gearBroken]  BREAK-marked gear: tags are offline
 * @property {ArmorType|null} [armorType]
 * @property {TileWeapon|null} [weapon]
 * @property {{targetTileId: string, targetName: string, currentSupply: number, maxSupply: number, replacesTag: string}|null} [ammo]
 * @property {ExoticSkill|null} [exoticSkill]
 * @property {boolean} [isSpellcastSkill]
 * @property {'titan-identity'|'homeworld'|null} [specialIdentity]
 * @property {Object<string, any>} [spellState]
 * @property {string} [description]
 */

/**
 * One die in a compiled pool, before rolling.
 * @typedef {Object} PoolDie
 * @property {string} source  e.g. "Stat (SPEED)", "Tile (claws)", "Burn (...)", "Chain (...)", "Freebie", "Extra"
 * @property {Die} die
 * @property {Die} [baseDie]
 */

/**
 * One rolled die. `id` is optional; getRollId falls back to the index.
 * @typedef {Object} Roll
 * @property {string} source
 * @property {Die} die
 * @property {number} val
 * @property {string|number} [id]
 * @property {Die} [baseDie]
 */

/**
 * A contextual +steps bonus surfaced for user selection (Expert, Keen, ...).
 * @typedef {Object} TagBonus
 * @property {string} id
 * @property {string} tag
 * @property {string} sourceTileId
 * @property {string} sourceTileName
 * @property {number} steps
 * @property {string} context
 * @property {string} description
 */

/**
 * A chain/world link discovered while compiling the pool.
 * @typedef {Object} ChainOption
 * @property {string} id
 * @property {'chain'|'world'} type
 * @property {string} sourceTileId
 * @property {string} sourceTileName
 * @property {string|null} targetTileId
 * @property {string} targetTileName
 * @property {boolean} targetFound
 * @property {string[]} availableColors
 * @property {string} selectedColor
 * @property {string} inheritedColor
 * @property {boolean} requiresColorChoice
 * @property {boolean} enabled
 * @property {string} status  active | suppressed | missing | blocked | needs-color
 */

/**
 * A resource cost the roll will charge (Hitch EN, Freebie EN, Sap/Tire/Drain,
 * Heavy EN, Fluid RX, Hungry Core).
 * @typedef {Object} ResourceCost
 * @property {ResourceKey|'core'} resource
 * @property {number} amount
 * @property {string|null} sourceTileId
 * @property {string} sourceTileName
 * @property {string} reason
 */

/**
 * Something the check asks the player to burn for (Witch "mote or burn to
 * cast", GOAD "must burn for actions"). A burn in the check meets it.
 * @typedef {Object} BurnRequirement
 * @property {string} reason  'Witch' | 'GOAD'
 * @property {string|null} sourceTileId
 * @property {string} sourceTileName
 * @property {string} message
 */

/**
 * Output of PoolEngine.compilePool, later merged with roll results by the
 * UI (originalRolls, kept, total, isHaywire, appliedTagBonuses...).
 * @typedef {Object} CompiledPool
 * @property {PoolDie[]} dice
 * @property {number} adds
 * @property {number} flatBonus
 * @property {TagBonus[]} tagBonuses
 * @property {ChainOption[]} chainOptions
 * @property {ResourceCost[]} resourceCosts
 * @property {string[]} calledTileIds
 * @property {BurnRequirement[]} burnRequirements
 * @property {boolean} burnRequirementMet  true when the check burns a tile
 * @property {PoolDie|null} fearDrop  the die FEAR removed from the pool
 * @property {'Qi'|'Id'|null} shadowUse
 * @property {Array<{source: string, from: Die, to: Die, direction: string}>} dieStepEffects
 * @property {number} haywireThreshold
 * @property {Die|null} freebieDie
 * @property {boolean} titanActive
 * @property {boolean} zenithActive
 * @property {string|null} error
 */

/**
 * A roll result as the resolution screen sees it.
 * @typedef {Object} RollResult
 * @property {Roll[]} originalRolls
 * @property {number} [adds]
 * @property {number} [flatBonus]
 * @property {number} [total]
 * @property {Roll[]} [kept]
 * @property {boolean} [isHaywire]
 * @property {number} [haywireThreshold]
 * @property {TagBonus[]} [appliedTagBonuses]
 * @property {string[]} [calledTileIds]
 * @property {boolean} [pressCounterBumped]
 * @property {number} [woundPenalty]
 * @property {boolean} [isTestRoll]
 * @property {Array<{tileId: string, name: string, targetName: string, currentSupply: number, supply: number, linked: boolean, xpCost: number}>} [ammoOptions]
 * @property {boolean} [freebieUsed]
 * @property {boolean} [titanActive]
 * @property {Array<{die: Die, from: number, to: number}>} [titanRerolls]
 * @property {boolean} [titanManualReminder]
 * @property {boolean} [zenithActive]
 * @property {Array<{die: Die, from: number, to: number}>} [zenithRerolls]
 * @property {boolean} [zenithManualReminder]
 * @property {PoolDie|null} [fearDrop]
 * @property {BurnRequirement[]} [burnRequirements]
 * @property {'virtual'|'manual'} [rollMode]
 * @property {string[]} [callColors]
 * @property {string|null} [callTileId]
 * @property {string[]} [preRollBurnTileIds]
 * @property {string[]} [hitchTileIds]
 * @property {{risen: boolean, fallen: boolean}} [aberrantEffects]
 * @property {string[]} [postRollBurnTileIds]
 * @property {{count: number, breakdown: Object<string, number>, selections: Object<string, string>}|null} [chainCostPaid]
 * @property {Array<{id: 'qi-test'|'id-impact', amount: number}>} [shadowSpends] Shadow spent on this roll (p.59)
 * @property {number} [coreSoak] Soak bought with the Machine Core spend (p.64)
 * @property {string[]} [coreSpends] Display log of Core spends on this roll
 * @property {number} [riskyPaid] HP already deducted for Risky 1s
 * @property {Array<{die: string, from: number, to: number}>} [numbRerolls] Numb flaw rerolls of maxed dice
 */

/**
 * Map of rollId -> assignment slot ('attack', 'impact', 'evasion', 'grit',
 * 'diagnosis', healing target ids, 'action', 'extend', 'unused').
 * @typedef {Object<string, string>} ResolutionAssignments
 */

/**
 * Mutable browser-only roll selection and resolution state.
 * @typedef {Object} UiState
 * @property {Tile|null} callTile
 * @property {string[]} callColors
 * @property {Tile[]} hitchCallTiles
 * @property {Tile[]} burnTiles
 * @property {Set<string>} disabledChainIds
 * @property {Object<string, string>} chainColorSelections
 * @property {Set<string>} selectedTagBonusIds
 * @property {RollResult|null} lastRollResult
 * @property {'action'|'attack'|'defense'|'healing'} currentResolutionMode
 * @property {ResolutionAssignments} currentResolutionAssignments
 * @property {Object<string, string>} ammoAssignments
 * @property {Object<string, string>} chainCostSelections
 * @property {boolean} healingInCombat
 * @property {Object<string, boolean>} defenseShieldSelections
 */

/**
 * Persisted character state (see DEFAULT_STATE in data.js for defaults).
 * Numeric fields may arrive as strings from form inputs or old saves;
 * readers parseInt defensively.
 * @typedef {Object} CharacterState
 * @property {string} name
 * @property {number|string} xpEarned
 * @property {number|string} [xpSpentAdjustment]
 * @property {number|string} [storyPoints]
 * @property {number|string} [storyPointsSpent]
 * @property {number|string} [storyPointsEarned]
 * @property {number|string} hp
 * @property {number|string} hpMax
 * @property {number|string} [hpTemp]
 * @property {number|string} [hpPerm]
 * @property {number|string} en
 * @property {number|string} enMax
 * @property {number|string} [enTemp]
 * @property {number|string} [enPerm]
 * @property {number|string} rx
 * @property {number|string} rxMax
 * @property {number|string} [rxTemp]
 * @property {number|string} [rxPerm]
 * @property {number|string} [sh]
 * @property {number|string} [shTemp]
 * @property {number|string} [shPerm]
 * @property {number|string} [core]
 * @property {number|string} [coreTemp]
 * @property {number|string} [corePerm]
 * @property {number|string} [titan]
 * @property {number|string} [titanTemp]
 * @property {number|string} [titanPerm]
 * @property {number|string} [titanHV]
 * @property {string} [currentForm]
 * @property {''|'aural'|'astral'} [celestialAspect]
 * @property {number|string} [aberration]
 * @property {boolean} [legacyShadowWarning]
 * @property {boolean} [gmOverride]
 * @property {boolean} [showOptionalStats]
 * @property {Object<string, number>} [activeCrits]
 * @property {number|string} [pressCount]
 * @property {Object<string, string>} stats  stat name -> dice string
 * @property {Tile[]} tiles
 * @property {Array<{id: string, title: string, content: string}>} [journal]
 */

/**
 * A GM-side NPC (normalizeNpc output, p.71).
 * @typedef {Object} Npc
 * @property {string} id
 * @property {string} name
 * @property {number} rank
 * @property {string} might  dice string ("d6, d4")
 * @property {string} charm
 * @property {string} skill
 * @property {number} hp
 * @property {number} hpMax
 * @property {number} en
 * @property {number} enMax
 * @property {number} rx
 * @property {number} rxMax
 * @property {Array<{text: string, spent: boolean}>} descriptors
 * @property {number|null} attackStatic
 * @property {number|null} defenseStatic
 * @property {string} notes
 * @property {''|'risen'|'fallen'} blastZone
 */

/**
 * Campaign file metadata row (campaign_files table, camelCase mapping in
 * supabaseStore.listCampaignFiles).
 * @typedef {Object} CampaignFile
 * @property {string} id
 * @property {string} campaignId
 * @property {string} title
 * @property {string} fileName
 * @property {string} storagePath
 * @property {string} contentType
 * @property {number} sizeBytes
 * @property {string} createdAt
 */

/**
 * @typedef {Object} CampaignSummary
 * @property {string} id
 * @property {string} name
 * @property {string} inviteCode
 * @property {'player'|'gm'} role
 */

/**
 * Shared object assembled by app.js and injected into UI modules.
 * @typedef {Object} AppDependencies
 * @property {import('./data.js').DataManager} dataManager
 * @property {import('./pool.js').PoolEngine} poolEngine
 * @property {import('./spellBuilder.js').SpellBuilder} spellBuilder
 * @property {() => void} renderAll
 * @property {() => void} renderCards
 * @property {(tile?: Tile|null) => void} openTileModal
 * @property {import('@supabase/supabase-js').SupabaseClient<any>|null} supabaseClient
 */

export {};
