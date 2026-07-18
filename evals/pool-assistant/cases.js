const ready = (callColors, callTileId, burnTileIds = []) => ({
    status: 'ready',
    callColors,
    callTileId,
    burnTileIds,
    confidence: 'high',
    rationale: '',
    warnings: []
});

const clarify = () => ({
    status: 'needs_clarification',
    callColors: [],
    callTileId: '',
    burnTileIds: [],
    confidence: 'low',
    rationale: '',
    warnings: []
});

const COLOR_STATS = {
    Red: 'BODY',
    Orange: 'POWER',
    Yellow: 'SOUL',
    Green: 'FOCUS',
    Blue: 'MIND',
    Purple: 'SPEED'
};

function commandWithGmColors(command, callColors, variant) {
    const [first, second] = callColors;
    if (variant === 1) return `${first} and ${second}. ${command}`;
    if (variant === 2) return `GM calls ${COLOR_STATS[first]} and ${COLOR_STATS[second]}. ${command}`;
    if (variant === 3) return `The Call is ${second} / ${first}. ${command}`;
    return `The GM says ${first} + ${second}. ${command}`;
}

const tile = (id, name, colors, description, extra = {}) => ({
    id,
    name,
    type: 'Skill',
    colors,
    dice: ['d6'],
    tags: [],
    description,
    ...extra
});

export const characters = {
    prowler: {
        name: 'Qwyn',
        stats: { BODY: 'd6', POWER: 'd4', SOUL: 'd6', FOCUS: 'd6', MIND: 'd8', SPEED: 'd10' },
        tiles: [
            tile('stealth', 'Stealth', ['Blue', 'Purple'], 'Move silently, hide, and avoid notice.'),
            tile('lockpicks', 'Tiny Lockpick Kit', ['Blue', 'Purple'], 'Open locks and defeat simple mechanisms.', { type: 'Gear', gearSubtype: 'Tool' }),
            tile('claws', 'Eighteen Claws', ['Orange', 'Purple'], 'Fight up close with fast natural claws.', { type: 'Gear', gearSubtype: 'Weapon' }),
            tile('parkour', 'Leaps and Bounds', ['Red', 'Purple'], 'Run, climb, balance, and jump across hazards.'),
            tile('firearms', 'Firearms', ['Green', 'Purple'], 'Aim and shoot ranged weapons.'),
            tile('first-aid', 'First Aid', ['Yellow', 'Blue'], 'Diagnose and treat injuries.'),
            tile('streetwise', 'Streetwise', ['Yellow', 'Blue'], 'Know local people, rumors, and criminal customs.'),
            tile('catfolk', 'Catfolk Reflexes', ['Red', 'Purple'], 'Explosive speed and feline agility.', { type: 'Trait' }),
            tile('ammo', 'Pistol Ammo', [], 'Ammunition supply.', { type: 'Gear', gearSubtype: 'Ammo', dice: [] }),
            tile('spent-blade', 'Hidden Blade', ['Orange', 'Purple'], 'A concealed knife.', { type: 'Gear', gearSubtype: 'Weapon', isBurnt: true })
        ]
    },
    scholar: {
        name: 'Mara',
        stats: { BODY: 'd4', POWER: 'd4', SOUL: 'd6', FOCUS: 'd10', MIND: 'd10', SPEED: 'd6' },
        tiles: [
            tile('research', 'Library Research', ['Green', 'Blue'], 'Find, compare, and interpret written information.'),
            tile('arcana', 'Arcane Theory', ['Green', 'Blue'], 'Recognize magical principles and occult symbols.'),
            tile('teaching', 'Patient Teacher', ['Yellow', 'Blue'], 'Explain difficult ideas and guide a student.'),
            tile('resolve', 'Iron Resolve', ['Red', 'Green'], 'Maintain concentration through fear or pain.', { type: 'Trait' }),
            tile('repair', 'Precision Repair', ['Red', 'Blue'], 'Fix delicate devices and mechanisms.'),
            tile('observation', 'Keen Observation', ['Blue', 'Orange'], 'Notice hidden details and immediate danger.'),
            tile('diplomacy', 'Diplomacy', ['Yellow', 'Green'], 'Build trust and resolve disagreements.'),
            tile('tome', 'Forbidden Tome', ['Green', 'Blue'], 'Dangerous magical reference material.', { type: 'Gear', gearSubtype: 'Tool', isBuried: true })
        ]
    },
    envoy: {
        name: 'Sol',
        stats: { BODY: 'd6', POWER: 'd6', SOUL: 'd10', FOCUS: 'd8', MIND: 'd6', SPEED: 'd6' },
        tiles: [
            tile('empathy', 'Empathy', ['Yellow', 'Green'], 'Understand feelings and offer compassionate support.'),
            tile('deception', 'Silver Tongue', ['Yellow', 'Purple'], 'Misdirect, bluff, and tell convincing lies.'),
            tile('command', 'Commanding Presence', ['Orange', 'Yellow'], 'Intimidate or rally people with forceful words.'),
            tile('medicine', 'Field Medicine', ['Yellow', 'Blue'], 'Treat wounds in difficult conditions.'),
            tile('focus', 'Unshakable Focus', ['Red', 'Green'], 'Keep working despite pressure and distraction.', { type: 'Trait' }),
            tile('detect', 'Read the Room', ['Blue', 'Orange'], 'Spot tension, danger, and suspicious behavior.'),
            tile('duel', 'Ceremonial Blade', ['Orange', 'Purple'], 'Fight precisely with a dueling sword.', { type: 'Gear', gearSubtype: 'Weapon' }),
            tile('oath', 'Never Abandon a Friend', ['Yellow', 'Green'], 'A demanding personal oath.', { type: 'Story', tags: ['Hitch 3'] })
        ]
    },
    engineer: {
        name: 'Brass',
        stats: { BODY: 'd8', POWER: 'd8', SOUL: 'd4', FOCUS: 'd8', MIND: 'd10', SPEED: 'd4' },
        tiles: [
            tile('engineering', 'Engineering', ['Red', 'Blue'], 'Build, modify, and repair machines.'),
            tile('lifting', 'Heavy Lifter', ['Red', 'Orange'], 'Move heavy loads and force obstacles.', { type: 'Trait' }),
            tile('endurance', 'Endurance', ['Red', 'Green'], 'Persist through fatigue and harsh conditions.'),
            tile('scanner', 'Threat Scanner', ['Blue', 'Orange'], 'Detect hazards, movement, and hidden systems.', { type: 'Gear', gearSubtype: 'Tool' }),
            tile('rifle', 'Long Rifle', ['Green', 'Purple'], 'Make careful attacks at long range.', { type: 'Gear', gearSubtype: 'Weapon' }),
            tile('demolitions', 'Demolitions', ['Orange', 'Yellow'], 'Place charges and create controlled destruction.'),
            tile('jury-rig', 'Jury-Rig Kit', ['Red', 'Blue'], 'Make fast temporary repairs.', { type: 'Gear', gearSubtype: 'Tool' }),
            tile('broken-drill', 'Mining Drill', ['Red', 'Orange'], 'Bore through stone and metal.', { type: 'Gear', gearSubtype: 'Tool', isBuried: true })
        ]
    }
};

const groups = [
    ['prowler', ready(['Blue', 'Purple'], 'stealth'), ['I sneak past the guard.', 'Slip through the shadows without being seen.', 'Move quietly behind the sentry.', 'Hide and cross the hall unseen.']],
    ['prowler', ready(['Blue', 'Purple'], 'lockpicks'), ['I pick the locked office door.', 'Open the lock before anyone returns.', 'Use my tiny tools to defeat the lock.', 'Quietly unlock the chest.']],
    ['prowler', ready(['Orange', 'Purple'], 'claws'), ['I slash the thug with my claws.', 'Make a fast claw attack up close.', 'Rake the enemy in melee.', 'Fight the bandit with my natural claws.']],
    ['prowler', ready(['Red', 'Purple'], 'parkour'), ['I leap across the rooftop gap.', 'Vault the railing and land safely.', 'Climb the wall as fast as I can.', 'Balance across the narrow beam.']],
    ['prowler', ready(['Green', 'Purple'], 'firearms'), ['I carefully shoot the distant lookout.', 'Aim my pistol at the far target.', 'Take a precise ranged shot.', 'Fire at the enemy across the street.']],
    ['prowler', ready(['Yellow', 'Blue'], 'first-aid'), ['I bandage the wounded courier.', 'Treat their bleeding injury.', 'Figure out how badly they are hurt and help.', 'Give emergency first aid.']],
    ['prowler', ready(['Yellow', 'Blue'], 'streetwise'), ['I ask around for rumors about the gang.', 'Recall who controls this neighborhood.', 'Find a criminal contact who knows the route.', 'Work out the local underworld customs.']],
    ['prowler', ready(['Red', 'Purple'], 'parkour', ['catfolk']), ['I go all out, burning Catfolk Reflexes to clear the rooftop gap.', 'Push hard and burn my Catfolk Reflexes while I leap.', 'I want to burn Catfolk Reflexes for this dangerous jump.', 'Use Leaps and Bounds and burn Catfolk Reflexes to escape.']],
    ['prowler', ready(['Blue', 'Purple'], 'stealth'), ['I sneak past them, but do not burn anything.', 'Quietly hide without spending a tile.', 'Use Stealth only; no Burns.', 'Slip unseen and save my other tiles.']],
    ['prowler', clarify(), ['Use my pistol ammo as the Call tile.', 'Call my already spent Hidden Blade.', 'Burn the ammunition tile to help.', 'Use the unavailable blade and nothing else.'], ['Blue', 'Purple']],
    ['scholar', ready(['Green', 'Blue'], 'research'), ['I search the archives for the lost treaty.', 'Research the old royal bloodline.', 'Compare these books for a hidden clue.', 'Look up the history of this ruin.']],
    ['scholar', ready(['Green', 'Blue'], 'arcana'), ['I identify the glowing occult sigil.', 'Work out what kind of magic this is.', 'Interpret the ritual symbols.', 'Recall the theory behind this curse.']],
    ['scholar', ready(['Yellow', 'Blue'], 'teaching'), ['I patiently teach the apprentice this formula.', 'Explain the difficult lesson clearly.', 'Help the student understand the theorem.', 'Guide the novice through the concept.']],
    ['scholar', ready(['Red', 'Green'], 'resolve'), ['I hold my concentration through the pain.', 'Keep the ritual steady despite the fear.', 'Refuse to break focus under pressure.', 'Maintain my resolve while the room shakes.']],
    ['scholar', [
        ready(['Red', 'Blue'], 'repair'),
        ready(['Green', 'Blue'], 'repair')
    ], ['I repair the tiny clockwork mechanism.', 'Fix the delicate broken device.', 'Restore the intricate machine.', 'Carefully mend the damaged mechanism.']],
    ['scholar', [
        ready(['Blue', 'Orange'], 'observation'),
        ready(['Blue', 'Green'], 'observation')
    ], ['I scan the room for a hidden trap.', 'Notice whether anyone is following us.', 'Look for the smallest sign of danger.', 'Study the scene for concealed details.']],
    ['scholar', [
        ready(['Blue', 'Orange'], 'observation'),
        ready(['Blue', 'Green'], 'observation'),
        ready(['Red', 'Blue'], 'repair'),
        ready(['Green', 'Blue'], 'repair'),
        ready(['Green', 'Blue'], 'arcana')
    ], ['I inspect the strange device for clues.', 'Examine the unfamiliar mechanism carefully.', 'Study the odd machine and work out what matters.', 'Look over the mysterious device before we touch it.']],
    ['envoy', [
        ready(['Yellow', 'Green'], 'empathy'),
        ready(['Yellow', 'Blue'], 'empathy')
    ], ['I comfort the frightened witness.', 'Understand why she is grieving.', 'Help him feel safe enough to talk.', 'Offer compassionate support.']],
    ['envoy', ready(['Yellow', 'Purple'], 'deception'), ['I bluff that we have reinforcements.', 'Tell a convincing lie about my identity.', 'Misdirect the guard with a false story.', 'Trick them into looking elsewhere.']],
    ['envoy', ready(['Orange', 'Yellow'], 'command'), ['I intimidate the mob into backing down.', 'Order the squad to hold the line.', 'Rally everyone with a forceful command.', 'Use my presence to make them obey.']],
    ['envoy', clarify(), ['I pilot the damaged airship through the storm.', 'Translate the ancient machine language.', 'Track the animal through deep snow.', 'Disarm the complex magical trap.'], ['Red', 'Green']],
    ['envoy', [
        ready(['Blue', 'Orange'], 'detect'),
        ready(['Blue', 'Yellow'], 'detect'),
        ready(['Blue', 'Green'], 'detect')
    ], ['I read the room for signs of an ambush.', 'Spot who is most nervous at the meeting.', 'Watch for suspicious behavior.', 'Figure out where the tension is coming from.']],
    ['engineer', ready(['Red', 'Blue'], 'engineering'), ['I rebuild the damaged engine.', 'Modify the machine to run quietly.', 'Repair the broken generator.', 'Design a mechanical solution to the problem.']],
    ['engineer', clarify(), ['I deal with the obstacle somehow.', 'Do something useful before it is too late.', 'Handle the situation for the group.', 'I take action, but I am not sure how.'], ['Red', 'Blue']],
    ['engineer', ready(['Red', 'Blue'], 'engineering', ['jury-rig']), ['I push hard and burn my Jury-Rig Kit to repair the engine now.', 'Burn the Jury-Rig Kit while I fix the machine.', 'Go all out with Engineering and the Jury-Rig Kit.', 'Use Engineering and burn the Jury-Rig Kit for a fast repair.']]
];

export const poolAssistantEvalCases = groups.flatMap(([characterId, accepted, commands, explicitCallColors], groupIndex) =>
    commands.map((command, commandIndex) => {
        const rawAcceptedSelections = Array.isArray(accepted) ? accepted : [accepted];
        const callColors = explicitCallColors || rawAcceptedSelections.find(selection => selection.status === 'ready')?.callColors;
        if (!callColors || callColors.length !== 2) throw new Error(`Eval group ${groupIndex + 1} requires two GM Call colors.`);
        const acceptedSelections = rawAcceptedSelections.map(selection => selection.status === 'ready'
            ? { ...selection, callColors: [...callColors] }
            : selection);
        return {
            id: `case-${String(groupIndex + 1).padStart(2, '0')}-${commandIndex + 1}`,
            characterId,
            command: commandWithGmColors(command, callColors, commandIndex),
            actionCommand: command,
            callColors: [...callColors],
            acceptedSelections,
            explicitlyRequestsBurn: acceptedSelections.some(selection => selection.burnTileIds.length > 0)
        };
    })
);

if (poolAssistantEvalCases.length !== 100) throw new Error('Pool assistant eval corpus must contain exactly 100 cases.');
