// numeric-only offline vs live CPS consistency check
// This mirrors the numeric branches of computeEffectiveCpsParts(), updateDisplays(), and offline calculation.

function computeLevelMultiplier(lv) {
    if (lv <= 500) return 1;
    const n25 = Math.floor((lv - 500) / 25);
    const n100 = Math.max(0, Math.floor(lv / 100) - 5);
    const n1000 = Math.floor(lv / 1000);
    return Math.pow(2, n25) * Math.pow(4, n100) * Math.pow(10, n1000);
}

function computeEffectiveCpsParts_numeric(state) {
    const per = {
        2: 1,
        3: 5,
        4: 20,
        5: 100,
        6: 500,
        7: 5000,
        8: 20000,
        9: 100000,
        10: 500000,
        11: 1500000,
        12: 5000000,
        13: 20000000,
        14: 50000000,
        15: 500000000,
        16: 2000000000
    };
    // pirate (upgrade2)
    const pirateLvl = state.upgrade2Level || 0;
    const expectedPirate = pirateLvl * per[2];
    const pirateExtra = (typeof state.pirateCps === 'number' ? state.pirateCps : 0) - expectedPirate;
    const pirateMult = computeLevelMultiplier(pirateLvl);
    const pirateEffective = expectedPirate * pirateMult + (pirateExtra || 0);

    // other upgrades 3..10
    let expectedOther = 0;
    let derivedOther = 0;
    for (let i = 3; i <= 10; i++) {
        const lvl = state['upgrade' + i + 'Level'] || 0;
        const base = (per[i] || 0) * lvl;
        expectedOther += base;
        const mult = computeLevelMultiplier(lvl);
        derivedOther += base * mult;
    }
    // upgrade13
    const upgrade13Lvl = state.upgrade13Level || 0;
    const per13 = per[13] || 0;
    const expectedRoping = (upgrade13Lvl > 0 && per13 > 0) ? per13 * upgrade13Lvl : 0;
    const baseOtherExtra = (typeof state.baseOtherCps === 'number' ? state.baseOtherCps : 0) - expectedOther - expectedRoping;
    const otherBase = derivedOther + (baseOtherExtra > 0 ? baseOtherExtra : 0);
    const ropingMult = computeLevelMultiplier(upgrade13Lvl);
    const ropingEffective = expectedRoping * ropingMult * (state.ropingOtherMultiplier || 1);

    // upgrade14
    const upgrade14Lvl = state.upgrade14Level || 0;
    const per14 = per[14] || 0;
    const expectedSkibidi = (upgrade14Lvl > 0 && per14 > 0) ? per14 * upgrade14Lvl : 0;
    const skibidiMult = computeLevelMultiplier(upgrade14Lvl);
    const skibidiEffective = expectedSkibidi * skibidiMult * (state.skibbidiOtherMultiplier || 1);

    // upgrade15
    const upgrade15Lvl = state.upgrade15Level || 0;
    const per15 = per[15] || 0;
    const expectedBeats = (upgrade15Lvl > 0 && per15 > 0) ? per15 * upgrade15Lvl : 0;
    const beatsMult = computeLevelMultiplier(upgrade15Lvl);
    const beatsEffective = expectedBeats * beatsMult * (state.beatsOtherMultiplier || 1);

    // upgrade16
    const upgrade16Lvl = state.upgrade16Level || 0;
    const per16 = per[16] || 0;
    const expectedEz = (upgrade16Lvl > 0 && per16 > 0) ? per16 * upgrade16Lvl : 0;
    const ezMult = computeLevelMultiplier(upgrade16Lvl);
    const ezEffective = expectedEz * ezMult * (state.ezOtherMultiplier || 1);

    const otherEffective = otherBase + ropingEffective + skibidiEffective + beatsEffective + ezEffective;

    // upgrade17 (scp)
    const upgrade17Lvl = state.upgrade17Level || 0;
    const per17 = 10000000000;
    const expectedScp = (upgrade17Lvl > 0 && per17 > 0) ? per17 * upgrade17Lvl : 0;
    const scpMult = computeLevelMultiplier(upgrade17Lvl);
    const scpEffective = expectedScp * scpMult * (state.scpMultiplier || 1);

    // goatis upgrade18 handled in update as fallback; include here as 0 by default
    // upgrade19 raw
    const upgrade19Lvl = state.upgrade19Level || 0;
    const per19 = 2000000000000;
    const expectedRaw = (upgrade19Lvl > 0 && per19 > 0) ? per19 * upgrade19Lvl : 0;
    const rawMult = computeLevelMultiplier(upgrade19Lvl);
    const rawEffective = expectedRaw * rawMult * (state.rawMultiplier || 1);

    const otherEffectiveFinal = otherEffective + scpEffective + rawEffective;

    // jonathan
    const jonathanLvl = state.upgrade11Level || 0;
    const expectedJonathan = jonathanLvl * per[11];
    const jonathanExtra = (typeof state.jonathanBaseCps === 'number' ? state.jonathanBaseCps : 0) - expectedJonathan;
    const jonathanMult = computeLevelMultiplier(jonathanLvl);
    const jonathanEffective = expectedJonathan * jonathanMult + (jonathanExtra || 0);

    // CR
    const crLvl = state.upgrade12Level || 0;
    const expectedCr = crLvl * per[12];
    const crExtra = (typeof state.crBaseCps === 'number' ? state.crBaseCps : 0) - expectedCr;
    const crMult = computeLevelMultiplier(crLvl);
    const crEffective = expectedCr * crMult + (crExtra || 0);

    return {
        pirateEffective,
        otherEffective: otherEffectiveFinal,
        jonathanEffective,
        crEffective
    };
}

function compute_live_cps_numeric(state) {
    const parts = computeEffectiveCpsParts_numeric(state);
    const nonPhonkOtherBase = parts.otherEffective;
    const jonathanContribution = parts.jonathanEffective * (state.jonathanOtherMultiplier || 1);
    const crContribution = parts.crEffective * (state.crOtherMultiplier || 1);
    const phonkContribution = (state.phonkBaseCps || 0) * (state.phonkOtherMultiplier || 1);
    const nonPhonkOther = nonPhonkOtherBase * (state.diddyOtherMultiplier || 1) * (state.argonOtherMultiplier || 1) * (state.grapeOtherMultiplier || 1) * (state.skippieOtherMultiplier || 1) * (state.islandOtherMultiplier || 1) * (state.tribalOtherMultiplier || 1);
    let otherCps = nonPhonkOther + jonathanContribution + crContribution + phonkContribution;
    // include goatis (upgrade18) fallback
    if ((state.upgrade18Level || 0) > 0) {
        const per18 = 150000000000;
        otherCps += per18 * (state.upgrade18Level || 0) * computeLevelMultiplier(state.upgrade18Level || 0) * (state.goatisMultiplier || 1);
    }
    let totalCps = (parts.pirateEffective * (state.pirateMultiplier || 1)) + (otherCps * (state.goonMultiplier || 1));
    totalCps = totalCps * (state.diddyMultiplier || 1) * (state.argonMultiplier || 1) * (state.grapeMultiplier || 1) * (state.skippieMultiplier || 1) * (state.islandMultiplier || 1) * (state.tribalMultiplier || 1) * (state.phonkMultiplier || 1);
    // golden
    totalCps = totalCps * (1 + ((typeof state.goldenWhat === 'number') ? state.goldenWhat * 0.1 : 0));
    // divine argon
    if ((state.divineArgonLevel || 0) > 0) {
        const offlineAppliedPercent = 300 * Math.pow(2, Math.max(0, (state.divineArgonLevel || 0) - 1));
        totalCps = totalCps * (1 + (offlineAppliedPercent / 100));
    }
    return totalCps;
}

function compute_offline_gain_numeric(state, seconds) {
    // mirror the offline numeric branch
    const parts = computeEffectiveCpsParts_numeric(state);
    const pirateEffective = parts.pirateEffective;
    const nonPhonkOtherBase = parts.otherEffective;
    const jonathanContribution = parts.jonathanEffective * (state.jonathanOtherMultiplier || 1);
    const crContribution = parts.crEffective * (state.crOtherMultiplier || 1);
    const phonkContribution = (state.phonkBaseCps || 0) * (state.phonkOtherMultiplier || 1);
    const nonPhonkOther = nonPhonkOtherBase * (state.diddyOtherMultiplier || 1) * (state.argonOtherMultiplier || 1) * (state.grapeOtherMultiplier || 1) * (state.skippieOtherMultiplier || 1) * (state.islandOtherMultiplier || 1) * (state.tribalOtherMultiplier || 1);
    let otherCps = nonPhonkOther + jonathanContribution + crContribution + phonkContribution;
    let totalCps = (pirateEffective * (state.pirateMultiplier || 1)) + (otherCps * (state.goonMultiplier || 1));
    totalCps = totalCps * (state.diddyMultiplier || 1) * (state.argonMultiplier || 1) * (state.grapeMultiplier || 1) * (state.skippieMultiplier || 1) * (state.islandMultiplier || 1) * (state.tribalMultiplier || 1) * (state.phonkMultiplier || 1);
    // include goatis (upgrade18) fallback (same as live computation)
    if ((state.upgrade18Level || 0) > 0) {
        const per18 = 150000000000;
        const goatisEff = per18 * (state.upgrade18Level || 0) * computeLevelMultiplier(state.upgrade18Level || 0) * (state.goatisMultiplier || 1);
        // otherCps should have included goatisEff before applying goonMultiplier; adjust totalCps accordingly
        // reverse previous inclusion and reapply with goatis
        totalCps = (pirateEffective * (state.pirateMultiplier || 1)) + ((otherCps + goatisEff) * (state.goonMultiplier || 1));
        totalCps = totalCps * (state.diddyMultiplier || 1) * (state.argonMultiplier || 1) * (state.grapeMultiplier || 1) * (state.skippieMultiplier || 1) * (state.islandMultiplier || 1) * (state.tribalMultiplier || 1) * (state.phonkMultiplier || 1);
    }
    totalCps = totalCps * (1 + ((typeof state.goldenWhat === 'number') ? state.goldenWhat * 0.1 : 0));
    if ((state.divineArgonLevel || 0) > 0) {
        const offlineAppliedPercent = 300 * Math.pow(2, Math.max(0, (state.divineArgonLevel || 0) - 1));
        totalCps = totalCps * (1 + (offlineAppliedPercent / 100));
    }
    return totalCps * seconds;
}

// sample scenarios to validate parity
const scenarios = [
    // low-level baseline
    {
        name: 'baseline',
        state: { upgrade2Level: 10, upgrade3Level: 0, upgrade11Level: 0, upgrade12Level:0, upgrade18Level:0, upgrade19Level:0, pirateMultiplier:1, goonMultiplier:1, diddyMultiplier:1, argonMultiplier:1, grapeMultiplier:1, skippieMultiplier:1, islandMultiplier:1, tribalMultiplier:1, phonkMultiplier:1, goldenWhat:0 }
    },
    // include jonathan and CR
    {
        name: 'jon-cr',
        state: { upgrade2Level: 20, upgrade3Level: 10, upgrade11Level:5, upgrade12Level:3, upgrade18Level:2, upgrade19Level:1, pirateMultiplier:1.2, goonMultiplier:1.1, diddyMultiplier:1.3, argonMultiplier:1.1, grapeMultiplier:1, skippieMultiplier:1, islandMultiplier:1, tribalMultiplier:1, phonkMultiplier:1, goldenWhat:2 }
    },
    // high multipliers
    {
        name: 'high-mults',
        state: { upgrade2Level: 50, upgrade3Level: 60, upgrade11Level:10, upgrade12Level:8, upgrade18Level:5, upgrade19Level:3, pirateMultiplier:1.5, goonMultiplier:1.2, diddyMultiplier:1.5, argonMultiplier:1.4, grapeMultiplier:1.2, skippieMultiplier:1.1, islandMultiplier:1.1, tribalMultiplier:1.05, phonkMultiplier:1.2, goldenWhat:10, divineArgonLevel:2 }
    }
];

for (const s of scenarios) {
    const sec = 3600; // 1 hour
    const live = compute_live_cps_numeric(s.state);
    const offlineGain = compute_offline_gain_numeric(s.state, sec);
    const expectedOffline = live * sec;
    console.log('Scenario:', s.name);
    console.log(' live cps:', live);
    console.log(' offline gain (calc):', offlineGain);
    console.log(' offline expected (live * sec):', expectedOffline);
    const diff = Math.abs(offlineGain - expectedOffline);
    console.log(' diff:', diff, ' OK?', diff < 1e-6 * Math.max(1, Math.abs(expectedOffline)));
    console.log('---');
}
