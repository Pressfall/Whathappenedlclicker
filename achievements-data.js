/**
 * Every achievement in the game, as data. Shared by index.html (unlocks them while you play), achievements.html
 * (the full list), and the casino, followers and clan pages (which check them after their own actions).
 * Each unlock sets localStorage `ach_<key>` = '1' and adds its title to `unlocked_titles`. The original achievements
 * keep their old keys (no `x_` prefix) so existing saves keep them.
 */
(function () {
    'use strict';

    const SAVE_KEY = 'whathappened_save', SAVE_KEY_LEGACY = 'whathappened_save_v1', FOLLOWERS_KEY = 'whathappened_followers', ITEMS_KEY = 'whathappened_items';

    // Display order of the categories on the achievements page
    const CATEGORIES = [
        { id: 'Clicking', icon: '👆' }, { id: 'Income', icon: '💸' }, { id: 'Upgrades', icon: '📈' }, { id: 'Prestige', icon: '🔁' },
        { id: 'Divine', icon: '✨' }, { id: 'Specials', icon: '⭐' }, { id: 'Followers', icon: '🦎' }, { id: 'Casino', icon: '🎰' },
        { id: 'Clans', icon: '🛡️' }, { id: 'Lootboxes', icon: '🎁' }, { id: 'Dedication', icon: '⏳' }, { id: 'Collector', icon: '💎' },
    ];

    // stat: a snapshot field name, or a function (snapshot) => number. Unlocks when stat >= target.
    // event: unlocked by the game when it happens (a crit, a casino win...), never by checkAll. hint explains how.
    // unit: 'h' shows progress in hours.
    const ACHIEVEMENTS = [
        // ---- the original achievements (old keys) ----
        { key: 'gettingStarted', cat: 'Clicking', name: 'Getting Started', desc: 'Click the main button 10 times.', title: 'What Happened Beginner', rarity: 'common', badge: '🐣', stat: 'clicks', target: 10 },
        { key: 'somethingHappened', cat: 'Clicking', name: 'Something Happened', desc: 'Click the main button 1,000 times.', title: 'Confused Observer', rarity: 'common', badge: '❓', stat: 'clicks', target: 1000 },
        { key: 'cp_10', cat: 'Clicking', name: 'Firm Grip', desc: 'Reach 10 click power.', title: 'Manual Operator', rarity: 'common', badge: '✊', stat: 'clickPower', target: 10 },
        { key: 'cp_69', cat: 'Clicking', name: 'The Funny Number', desc: 'Reach 69 click power.', title: 'Nice', rarity: 'uncommon', badge: '😏', stat: 'clickPower', target: 69 },
        { key: 'cp_5000', cat: 'Clicking', name: 'Noticeable Impact', desc: 'Reach 5,000 click power.', title: 'Button Breaker', rarity: 'rare', badge: '💥', stat: 'clickPower', target: 5000 },
        { key: 'cp_1m', cat: 'Clicking', name: 'The Button Fears You', desc: 'Reach 1M click power.', title: 'One Click Wonder', rarity: 'epic', badge: '😱', stat: 'clickPower', target: 1e6 },
        { key: 'gotCrit', cat: 'Clicking', name: 'That Wasn\'t Supposed to Happen', desc: 'Land a critical click.', title: 'Source: Trust Me', rarity: 'uncommon', badge: '⚡', event: true, hint: 'Crit chance comes from Divine Assassin and the casino\'s crit buff.' },
        { key: 'stat_unlikely', cat: 'Clicking', name: 'Statistically Unlikely', desc: 'Land two critical clicks in a row.', title: 'Probability Skeptic', rarity: 'rare', badge: '🎲', event: true, hint: 'Pure luck. More crit chance helps.' },
        { key: 'cps_1', cat: 'Income', name: 'All Hands On Deck', desc: 'Reach 1 CPS.', title: 'The Automtor', rarity: 'common', badge: '⚙️', stat: 'cps', target: 1 },
        { key: 'cps_1k', cat: 'Income', name: 'I Swear I\'m Not Clicking', desc: 'Reach 1,000 CPS.', title: 'Automation Enjoyer', rarity: 'uncommon', badge: '🙅', stat: 'cps', target: 1000 },
        { key: 'cps_1b', cat: 'Income', name: 'It Clicks Itself', desc: 'Reach 1B CPS.', title: 'Observer Of Motion.', rarity: 'legendary', badge: '👁️', stat: 'cps', target: 1e9 },
        { key: 'pirate_1000', cat: 'Upgrades', name: 'Pirate\'s Life for Me', desc: 'Get Somalian Pirate to level 1000.', title: 'Somali Captain', rarity: 'uncommon', badge: '🏴‍☠️', stat: s => s.upgrades[2], target: 1000 },
        { key: 'diddy_1000', cat: 'Upgrades', name: 'So Much Baby Oil', desc: 'Get Diddy blud to level 1000.', title: 'partygoer', rarity: 'common', badge: '🧴', stat: s => s.upgrades[4], target: 1000 },
        { key: 'argon_1000', cat: 'Upgrades', name: '1000 Argonions', desc: 'Get Argonian Autist to level 1000.', title: 'Argoonion', rarity: 'uncommon', badge: '🦎', stat: s => s.upgrades[5], target: 1000 },
        { key: 'tribal_1000', cat: 'Upgrades', name: 'Keeper of the Camp', desc: 'Get Tribal Camp to level 1000.', title: 'Camp Cheif', rarity: 'uncommon', badge: '🏕️', stat: s => s.upgrades[9], target: 1000 },
        { key: 'phonk_1000', cat: 'Upgrades', name: 'Phonk Aura', desc: 'Get The Phonk Man to level 1000.', title: 'Phonk Enjoyer', rarity: 'rare', badge: '🎧', stat: s => s.upgrades[10], target: 1000 },
        { key: 'skibidi_1000', cat: 'Upgrades', name: 'Skibbidi Man', desc: 'Get skibbidi scimitar to level 1000.', title: 'The Strongest', rarity: 'rare', badge: '🚽', stat: s => s.upgrades[14], target: 1000 },
        { key: 'landon_1000', cat: 'Upgrades', name: '1000 Levels of Landon', desc: 'Get The Landon Stream to level 1000.', title: 'landon stream', rarity: 'epic', badge: '📺', stat: s => s.upgrades[20], target: 1000 },
        { key: 'bass_1000', cat: 'Upgrades', name: 'The True Bass', desc: 'Get The Bass to level 1000.', title: 'The Bass', rarity: 'epic', badge: '🐟', stat: s => s.upgrades[21], target: 1000 },
        { key: 'prestige1', cat: 'Prestige', name: 'Starting Over', desc: 'Prestige once.', title: 'Loop Initiater', rarity: 'common', badge: '🔄', stat: 'prestiges', target: 1 },
        { key: 'prestige5', cat: 'Prestige', name: 'What Happened... Again', desc: 'Prestige 5 times.', title: 'Pattern Recognizer', rarity: 'uncommon', badge: '🌀', stat: 'prestiges', target: 5 },
        { key: 'prestige10', cat: 'Prestige', name: 'Time Loop Victim', desc: 'Prestige 10 times.', title: 'Loop Surviver', rarity: 'rare', badge: '⏳', stat: 'prestiges', target: 10 },
        { key: 'prestige25', cat: 'Prestige', name: 'I Remember Everything', desc: 'Prestige 25 times.', title: 'Keeper of the Loop', rarity: 'legendary', badge: '🧠', stat: 'prestiges', target: 25 },
        { key: 'play_2h', cat: 'Dedication', name: 'Go Outside', desc: 'Play for 2 hours in total.', title: 'Indoor Specialist', rarity: 'uncommon', badge: '🌳', stat: 'playHours', target: 2, unit: 'h' },
        { key: 'play_24h', cat: 'Dedication', name: 'This Is My Life Now', desc: 'Play for 24 hours in total.', title: 'Chronically Online', rarity: 'rare', badge: '🛋️', stat: 'playHours', target: 24, unit: 'h' },
        { key: 'play_1w', cat: 'Dedication', name: 'What Happened Forever', desc: 'Play for a whole week in total.', title: 'Permanently Online', rarity: 'epic', badge: '🗓️', stat: 'playHours', target: 168, unit: 'h' },
        { key: 'put_all_on_black', cat: 'Casino', name: 'Put It All on Black', desc: 'Bet every What Happened you have on a blackjack hand and win.', title: 'High Roller', rarity: 'rare', badge: '🖤', event: true, hint: 'Use the All in button, then win the hand.' },
        { key: '5_card_blackjack', cat: 'Casino', name: '5 Card Blackjack', desc: 'Win a blackjack hand holding five cards.', title: 'playing with fire', rarity: 'epic', badge: '🔥', event: true, hint: 'Keep hitting on small cards.' },
        { key: 'clan_joined', cat: 'Clans', name: 'Clan Member', desc: 'Join or create a clan.', title: 'Clan Recruit', rarity: 'common', badge: '🛡️', stat: s => (s.inClan ? 1 : 0), target: 1 },
        { key: 'clan_created', cat: 'Clans', name: 'Clan Founder', desc: 'Create your own clan.', title: 'Clan Founder', rarity: 'uncommon', badge: '🏰', event: true, hint: 'Costs 10 Golden on the Clans page.' },
        { key: 'clan_coleader', cat: 'Clans', name: 'Second in Command', desc: 'Become a co-leader of a clan.', title: 'Lieutenant', rarity: 'uncommon', badge: '🪖', stat: s => (/^co-?leader$/.test(s.clanRole) ? 1 : 0), target: 1 },
        { key: 'clan_owner', cat: 'Clans', name: 'Warlord', desc: 'Lead your own clan.', title: 'Warlord', rarity: 'rare', badge: '🏯', stat: s => (s.clanRole === 'leader' || s.clanRole === 'owner' ? 1 : 0), target: 1 },
        // ---- clicking ----
        { key: 'x_clicks_10k', cat: 'Clicking', name: 'Repetitive Strain', desc: 'Click the main button 10,000 times.', title: 'Finger Athlete', rarity: 'uncommon', badge: '👆', stat: 'clicks', target: 1e4 },
        { key: 'x_clicks_100k', cat: 'Clicking', name: 'The Mouse Is Screaming', desc: 'Click the main button 100,000 times.', title: 'Mouse Abuser', rarity: 'rare', badge: '🖱️', stat: 'clicks', target: 1e5 },
        { key: 'x_clicks_1m', cat: 'Clicking', name: 'One Million Taps', desc: 'Click the main button 1,000,000 times.', title: 'Human Autoclicker', rarity: 'legendary', badge: '🤖', stat: 'clicks', target: 1e6 },
        { key: 'x_cp_1b', cat: 'Clicking', name: 'Finger of God', desc: 'Reach 1B click power.', title: 'Divine Finger', rarity: 'epic', badge: '☝️', stat: 'clickPower', target: 1e9 },
        { key: 'x_cp_1t', cat: 'Clicking', name: 'The Click Heard Round the World', desc: 'Reach 1T click power.', title: 'Seismic Clicker', rarity: 'legendary', badge: '🌋', stat: 'clickPower', target: 1e12 },
        // ---- CPS ----
        { key: 'x_cps_1m', cat: 'Income', name: 'Passive Income', desc: 'Reach 1M CPS.', title: 'Landlord', rarity: 'uncommon', badge: '🏠', stat: 'cps', target: 1e6 },
        { key: 'x_cps_1t', cat: 'Income', name: 'Trillionaire Behavior', desc: 'Reach 1T CPS.', title: 'Market Mover', rarity: 'epic', badge: '📈', stat: 'cps', target: 1e12 },
        { key: 'x_cps_1qi', cat: 'Income', name: 'The Economy Is Fine', desc: 'Reach 1Qi CPS.', title: 'What Happened Tycoon', rarity: 'legendary', badge: '💸', stat: 'cps', target: 1e18 },
        // ---- prestige & Golden ----
        { key: 'x_prestige_50', cat: 'Prestige', name: 'Groundhog Day', desc: 'Prestige 50 times.', title: 'Loop Breaker', rarity: 'epic', badge: '🔁', stat: 'prestiges', target: 50 },
        { key: 'x_prestige_100', cat: 'Prestige', name: 'What Happened... Again?', desc: 'Prestige 100 times.', title: 'Lord of the Loop', rarity: 'mythic', badge: '♾️', stat: 'prestiges', target: 100 },
        { key: 'x_golden_10', cat: 'Prestige', name: 'Golden Touch', desc: 'Earn 10 Golden What Happeneds in total.', title: 'Gold Digger', rarity: 'uncommon', badge: '🪙', stat: 'goldenEver', target: 10 },
        { key: 'x_golden_100', cat: 'Prestige', name: 'Fort Knox', desc: 'Earn 100 Golden What Happeneds in total.', title: 'Golden Child', rarity: 'rare', badge: '🏦', stat: 'goldenEver', target: 100 },
        { key: 'x_golden_1000', cat: 'Prestige', name: 'Midas Would Be Proud', desc: 'Earn 1,000 Golden What Happeneds in total.', title: 'Midas', rarity: 'legendary', badge: '👑', stat: 'goldenEver', target: 1000 },
        // ---- Divine ----
        { key: 'x_divine_first', cat: 'Divine', name: 'Touched by the Divine', desc: 'Buy any Divine upgrade.', title: 'Blessed', rarity: 'common', badge: '✨', stat: 'divineTotal', target: 1 },
        { key: 'x_divine_25', cat: 'Divine', name: 'Pantheon', desc: 'Reach 25 total Divine upgrade levels.', title: 'Demigod', rarity: 'epic', badge: '🏛️', stat: 'divineTotal', target: 25 },
        { key: 'x_argon_5', cat: 'Divine', name: 'Hist Whisperer', desc: 'Get Divine Argonian to level 5.', title: 'Hist Chosen', rarity: 'rare', badge: '🦎', stat: 'divineArgon', target: 5 },
        { key: 'x_assassin_max', cat: 'Divine', name: 'Every Click a Crit', desc: 'Max out Divine Assassin (level 19).', title: 'Silent Blade', rarity: 'legendary', badge: '🗡️', stat: 'divineAssassin', target: 19 },
        // ---- specials ----
        { key: 'x_specials_10', cat: 'Specials', name: 'Special Treatment', desc: 'Own 10 special upgrades in one run.', title: 'Special Snowflake', rarity: 'common', badge: '❄️', stat: 'specialsOwned', target: 10 },
        { key: 'x_specials_set', cat: 'Specials', name: 'Full Set', desc: 'Own every special upgrade of a single upgrade.', title: 'Completionist', rarity: 'uncommon', badge: '🧩', stat: 'specialsFullSets', target: 1 },
        { key: 'x_specials_50', cat: 'Specials', name: 'Specialist', desc: 'Own 50 special upgrades in one run.', title: 'Certified Special', rarity: 'rare', badge: '🎖️', stat: 'specialsOwned', target: 50 },
        { key: 'x_specials_all', cat: 'Specials', name: 'Everything Is Special', desc: 'Own every special upgrade in one run.', title: 'Most Special', rarity: 'legendary', badge: '🌟', stat: s => (s.specialsTotal && s.specialsOwned >= s.specialsTotal ? 1 : 0), target: 1 },
        // ---- upgrades ----
        { key: 'x_upgrade_100', cat: 'Upgrades', name: 'Triple Digits', desc: 'Get any upgrade to level 100.', title: 'Dedicated', rarity: 'common', badge: '💯', stat: 'upgradeMax', target: 100 },
        { key: 'x_levels_5000', cat: 'Upgrades', name: 'Level Hoarder', desc: 'Have 5,000 total upgrade levels in one run.', title: 'Grinder', rarity: 'rare', badge: '📊', stat: 'upgradeTotal', target: 5000 },
        { key: 'x_roster', cat: 'Upgrades', name: 'Full Roster', desc: 'Own at least one of all 28 upgrades.', title: 'What Collector', rarity: 'epic', badge: '📚', stat: 'upgradesOwned', target: 28 },
        { key: 'x_opmouse_1000', cat: 'Upgrades', name: 'Mouse Supremacy', desc: 'Get OP mouse to level 1000.', title: 'Click Lord', rarity: 'epic', badge: '🖱️', stat: s => s.upgrades[1], target: 1000 },
        { key: 'x_goonsaw_1000', cat: 'Upgrades', name: 'Saw It All', desc: 'Get Goonsaw Man to level 1000.', title: 'Lumberjack', rarity: 'epic', badge: '🪚', stat: s => s.upgrades[3], target: 1000 },
        { key: 'x_grape_1000', cat: 'Upgrades', name: 'Wine Not?', desc: 'Get Grape God to level 1000.', title: 'Sommelier', rarity: 'epic', badge: '🍇', stat: s => s.upgrades[6], target: 1000 },
        { key: 'x_goatis_1000', cat: 'Upgrades', name: 'Greatest of All Time', desc: 'Get The Goatis to level 1000.', title: 'G.O.A.T.', rarity: 'epic', badge: '🐐', stat: s => s.upgrades[18], target: 1000 },
        { key: 'x_noodles_1000', cat: 'Upgrades', name: 'We Eating Good', desc: 'Get Good Noodles to level 1000.', title: 'Noodle Enjoyer', rarity: 'epic', badge: '🍜', stat: s => s.upgrades[22], target: 1000 },
        { key: 'x_easton_1000', cat: 'Upgrades', name: 'The Bundy Empire', desc: 'Get Easton Bundy to level 1000.', title: 'Executive', rarity: 'legendary', badge: '💼', stat: s => s.upgrades[24], target: 1000 },
        // ---- followers ----
        { key: 'x_f_first', cat: 'Followers', name: 'Day One Fan', desc: 'Get your first follower.', title: 'Influencer', rarity: 'common', badge: '🦎', stat: 'followers', target: 1 },
        { key: 'x_f_25', cat: 'Followers', name: 'Fan Club', desc: 'Have 25 followers at once.', title: 'Cult Leader', rarity: 'uncommon', badge: '👥', stat: 'followers', target: 25 },
        { key: 'x_f_baby', cat: 'Followers', name: 'It\'s a Baby!', desc: 'Hatch a follower from the nursery.', title: 'Proud Parent', rarity: 'common', badge: '🥚', stat: 'followersBabies', target: 1 },
        { key: 'x_f_bred25', cat: 'Followers', name: 'Breeding Program', desc: 'Breed 25 times.', title: 'Geneticist', rarity: 'rare', badge: '🧬', stat: 'followersBred', target: 25 },
        { key: 'x_f_shiny', cat: 'Followers', name: 'Shiny Hunter', desc: 'Own a shiny follower.', title: 'Shiny Hunter', rarity: 'rare', badge: '✦', stat: 'followersShiny', target: 1 },
        { key: 'x_f_mythic', cat: 'Followers', name: 'Mythical Encounter', desc: 'Own a Mythic follower.', title: 'Mythbuster', rarity: 'epic', badge: '🌠', stat: 'followersMythic', target: 1 },
        { key: 'x_f_maxed', cat: 'Followers', name: 'Maxed Out', desc: 'Level a follower to its max level.', title: 'Trainer', rarity: 'epic', badge: '🏋️', stat: 'followersMaxed', target: 1 },
        { key: 'x_f_slots', cat: 'Followers', name: 'Full House', desc: 'Unlock all 8 team slots.', title: 'Party Leader', rarity: 'epic', badge: '🎉', stat: 'followerSlots', target: 8 },
        { key: 'x_f_dex36', cat: 'Followers', name: 'Halfway Catalogued', desc: 'Discover 36 follower species.', title: 'Naturalist', rarity: 'rare', badge: '📖', stat: 'followersSeen', target: 36 },
        { key: 'x_f_dex72', cat: 'Followers', name: 'Followerdex Complete', desc: 'Discover all 72 follower species.', title: 'Professor', rarity: 'mythic', badge: '🎓', stat: 'followersSeen', target: 72 },
        // ---- casino ----
        { key: 'x_casino_25', cat: 'Casino', name: 'Regular', desc: 'Play 25 rounds at the casino.', title: 'Regular', rarity: 'common', badge: '🎲', stat: 'casinoRounds', target: 25 },
        { key: 'x_casino_500', cat: 'Casino', name: 'The House Knows Your Name', desc: 'Play 500 rounds at the casino.', title: 'Casino Rat', rarity: 'rare', badge: '🐀', stat: 'casinoRounds', target: 500 },
        { key: 'x_bj_25', cat: 'Casino', name: 'Counting Cards', desc: 'Win 25 hands of blackjack.', title: 'Card Shark', rarity: 'uncommon', badge: '🃏', stat: 'bjWins', target: 25 },
        { key: 'x_bj_double', cat: 'Casino', name: 'Double Trouble', desc: 'Win a blackjack hand after doubling down.', title: 'Risk Taker', rarity: 'uncommon', badge: '✌️', stat: 'bjDoubleWins', target: 1 },
        { key: 'x_slots_triple', cat: 'Casino', name: 'Three of a Kind', desc: 'Line up three matching symbols in the slots.', title: 'Lucky', rarity: 'common', badge: '🎰', stat: 'slotsTriples', target: 1 },
        { key: 'x_slots_jackpot', cat: 'Casino', name: 'JACKPOT!', desc: 'Line up three Golden What Happeneds in the slots.', title: 'Jackpot', rarity: 'legendary', badge: '💰', stat: 'slotsJackpots', target: 1 },
        { key: 'x_rocket_10', cat: 'Casino', name: 'To the Moon', desc: 'Cash out a rocket at 10× or higher.', title: 'Astronaut', rarity: 'rare', badge: '🚀', stat: 'rocketBest', target: 10 },
        { key: 'x_rocket_50', cat: 'Casino', name: 'Diamond Hands', desc: 'Cash out a rocket at 50× or higher.', title: 'Diamond Hands', rarity: 'legendary', badge: '💎', stat: 'rocketBest', target: 50 },
        { key: 'x_casino_whale', cat: 'Casino', name: 'Whale Spotted', desc: 'Win 1B What Happeneds on a single bet.', title: 'Whale', rarity: 'epic', badge: '🐋', stat: 'casinoBestWH', target: 1e9 },
        // ---- clans ----
        { key: 'x_clan_streak7', cat: 'Clans', name: 'Clocked In', desc: 'Check in with your clan 7 days in a row.', title: 'Loyal', rarity: 'uncommon', badge: '📅', stat: 'clanStreakBest', target: 7 },
        { key: 'x_clan_donate1k', cat: 'Clans', name: 'Team Player', desc: 'Put 1,000 Clan Points into clan buffs.', title: 'Patron', rarity: 'rare', badge: '🤝', stat: 'clanDonated', target: 1000 },
        { key: 'x_clan_lvl10', cat: 'Clans', name: 'Rising Power', desc: 'Be in a level 10 clan.', title: 'Banner Bearer', rarity: 'rare', badge: '🚩', stat: 'clanLevel', target: 10 },
        { key: 'x_clan_lvl20', cat: 'Clans', name: 'Legendary Clan', desc: 'Be in a max level (20) clan.', title: 'Overlord', rarity: 'legendary', badge: '⚔️', stat: 'clanLevel', target: 20 },
        // ---- lootboxes and items (items.js) ----
        { key: 'x_box_first', cat: 'Lootboxes', name: 'Finders Keepers', desc: 'Grab a lootbox before it vanishes.', title: 'Treasure Hunter', rarity: 'common', badge: '🎁', stat: 'boxesCollected', target: 1 },
        { key: 'x_box_merge', cat: 'Lootboxes', name: 'Three Become One', desc: 'Merge three lootboxes into a better one.', title: 'Alchemist', rarity: 'common', badge: '⚗️', stat: 'boxesMerged', target: 1 },
        { key: 'x_box_open50', cat: 'Lootboxes', name: 'Unboxing Channel', desc: 'Open 50 lootboxes.', title: 'Unboxer', rarity: 'uncommon', badge: '📦', stat: 'boxesOpened', target: 50 },
        { key: 'x_box_diamond', cat: 'Lootboxes', name: 'Shine Bright', desc: 'Get a Diamond Chest.', title: 'Diamond Digger', rarity: 'rare', badge: '💠', stat: 'bestBoxTier', target: 4 },
        { key: 'x_box_mythic', cat: 'Lootboxes', name: 'Into the Vault', desc: 'Get a Mythic Vault.', title: 'Vault Breaker', rarity: 'legendary', badge: '🌌', stat: 'bestBoxTier', target: 5 },
        { key: 'x_charms_all', cat: 'Lootboxes', name: 'Charmed, I\'m Sure', desc: 'Find all 15 charms.', title: 'Charmer', rarity: 'epic', badge: '🧿', stat: 'charmsSeen', target: 15 },
        // ---- misc ----
        { key: 'x_gems_100', cat: 'Collector', name: 'Shiny Rocks', desc: 'Hold 100 gems at once.', title: 'Gem Hoarder', rarity: 'uncommon', badge: '💎', stat: 'gems', target: 100 },
    ];

    const RARITY_COLORS = { common: '#bfc7c9', uncommon: '#6bd26b', rare: '#4da6ff', epic: '#b86cff', legendary: '#ffb84d', mythic: '#ff5bd0' };

    function readJSON(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
    function num(key) { try { return Number(localStorage.getItem(key)) || 0; } catch (e) { return 0; } }

    // Everything the achievements look at, from storage. `live` (from the running game) overrides fields.
    function snapshot(live) {
        const s = readJSON(SAVE_KEY) || readJSON(SAVE_KEY_LEGACY) || {};
        const f = readJSON(FOLLOWERS_KEY) || {};
        const items = (readJSON(ITEMS_KEY) || {}).stats || {};
        const list = Array.isArray(f.list) ? f.list : [];
        const W = window.WHF;
        const sp = id => (W && W.SPECIES_BY_ID[id]) || null;
        const upgrades = [0];
        for (let i = 1; i <= 28; i++) upgrades.push(Number(s['upgrade' + i + 'Level']) || 0);
        const divine = {
            divineArgon: Number(s.divineArgonLevel) || 0, divineSomalian: Number(s.divineSomalianLevel) || 0,
            divineAssassin: Number(s.divineAssassinLevel) || 0, divineCollector: Number(s.divineCollectorLevel) || 0,
            divineMoneyMan: Number(s.divineMoneyManLevel) || 0, divineSpirit: Number(s.divineSpiritLevel) || 0,
            divineVillager: Number(s.divineSimpleVillagerLevel) || 0, divineBrileyism: Number(s.divineBrileyismLevel) || 0,
        };
        const cs = readJSON('whathappened_casino_stats') || {};
        const checkin = readJSON('whathappened_clan_checkin') || {};
        const inClan = (() => { try { const c = localStorage.getItem('player_clanId'); return !!c && c !== 'undefined'; } catch (e) { return false; } })();
        const clanRole = (() => { try { return String(localStorage.getItem('player_clanRole') || '').toLowerCase(); } catch (e) { return ''; } })();
        const snap = Object.assign({
            clicks: Math.max(num('whathappened_lifetime_clicks'), num('ach_clicks')),
            cps: num('whathappened_current_cps'),
            clickPower: num('whathappened_current_clickpower'),
            prestiges: Math.max(Number(s.prestigeTimes) || 0, num('whathappened_prestige_times')),
            goldenEver: Math.max(Number(s.totalGoldenEver) || 0, num('whathappened_total_golden')),
            gems: Number(s.diamonds) || 0,
            upgrades,
            specialsOwned: num('whathappened_specials_owned'),
            specialsFullSets: num('whathappened_specials_fullsets'),
            specialsTotal: num('whathappened_specials_total'),
            followers: list.length,
            followersSeen: Object.keys(f.seen || {}).length,
            followersBred: Number(f.bred) || 0,
            followersBabies: list.filter(x => (Number(x.gen) || 1) > 1).length,
            followersShiny: list.filter(x => x.shiny).length,
            followersMythic: list.filter(x => sp(x.sp) && sp(x.sp).rarity === 5).length,
            followersMaxed: W ? list.filter(x => sp(x.sp) && x.lvl >= W.maxLevel(x)).length : 0,
            followerSlots: Number(f.slots) || 2,
            casinoRounds: Number(cs.rounds) || 0,
            bjWins: Math.max(Number(s.casino_total_wins) || 0, num('gamba_total_wins')),
            bjDoubleWins: Number(cs.bjDoubleWins) || 0,
            slotsTriples: Number(cs.slotsTriples) || 0,
            slotsJackpots: Number(cs.slotsJackpots) || 0,
            rocketBest: Number(cs.rocketBest) || 0,
            casinoBestWH: Number(cs.best && cs.best.count) || 0,
            clanLevel: inClan ? num('whathappened_clan_level') : 0,
            clanStreakBest: Number(checkin.best) || 0,
            clanDonated: num('whathappened_clan_donated'),
            inClan, clanRole,
            playHours: num('whathappened_playtime_seconds') / 3600,
            boxesCollected: Number(items.collected) || 0,
            boxesOpened: Number(items.opened) || 0,
            boxesMerged: Number(items.merged) || 0,
            bestBoxTier: Number(items.bestTier) || 0, // 1 = Wooden Crate ... 5 = Mythic Vault
            charmsSeen: Number(items.charmsSeen) || 0,
        }, divine, live || {});
        const ups = snap.upgrades.slice(1);
        snap.upgradeMax = Math.max(0, ...ups);
        snap.upgradeTotal = ups.reduce((a, b) => a + b, 0);
        snap.upgradesOwned = ups.filter(l => l >= 1).length;
        snap.divineTotal = snap.divineArgon + snap.divineSomalian + snap.divineAssassin + snap.divineCollector + snap.divineMoneyMan + snap.divineSpirit + snap.divineVillager + snap.divineBrileyism;
        return snap;
    }

    const BY_KEY = {};
    ACHIEVEMENTS.forEach(a => { BY_KEY[a.key] = a; });
    const NEW_KEY = 'whathappened_ach_new';   // keys unlocked since the player last opened the achievements page

    function isUnlocked(a) { try { return localStorage.getItem('ach_' + a.key) === '1'; } catch (e) { return false; } }
    function value(a, snap) {
        if (a.event) return isUnlocked(a) ? 1 : 0;
        const v = typeof a.stat === 'function' ? a.stat(snap) : snap[a.stat];
        return Number(v) || 0;
    }
    function progress(a, snap) { const target = a.target || 1; const v = value(a, snap); return { value: Math.min(v, target), target, done: isUnlocked(a) || v >= target }; }

    // Make sure every unlocked achievement's title is in `unlocked_titles` (some pages set only the flag)
    function grantTitles(list) {
        try {
            const stored = readJSON('unlocked_titles');
            const arr = Array.isArray(stored) ? stored : [];
            const have = new Set(arr.map(t => (typeof t === 'string' ? t : t && t.name)));
            let changed = false;
            for (const a of list) {
                if (a.title && !have.has(a.title)) { arr.push({ name: a.title, rarity: a.rarity || 'common' }); have.add(a.title); changed = true; }
            }
            if (changed) localStorage.setItem('unlocked_titles', JSON.stringify(arr));
        } catch (e) {}
    }
    function recordNew(list) {
        if (!list.length) return;
        try {
            const cur = readJSON(NEW_KEY);
            const arr = Array.isArray(cur) ? cur : [];
            list.forEach(a => { if (!arr.includes(a.key)) arr.push(a.key); });
            localStorage.setItem(NEW_KEY, JSON.stringify(arr));
        } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('wh:achievements', { detail: list })); } catch (e) {}
    }
    // Unlock one achievement now (event achievements). Returns it when newly unlocked, otherwise null.
    function unlock(key) {
        const a = BY_KEY[key];
        if (!a || isUnlocked(a)) return null;
        try { localStorage.setItem('ach_' + a.key, '1'); } catch (e) {}
        grantTitles([a]);
        recordNew([a]);
        return a;
    }
    // Unlock everything whose condition is met. Returns the newly unlocked achievements.
    function checkAll(snap) {
        snap = snap || snapshot();
        const fresh = [], unlocked = [];
        for (const a of ACHIEVEMENTS) {
            if (isUnlocked(a)) { unlocked.push(a); continue; }
            if (a.event) continue;
            if (value(a, snap) >= a.target) {
                try { localStorage.setItem('ach_' + a.key, '1'); } catch (e) {}
                unlocked.push(a);
                fresh.push(a);
            }
        }
        grantTitles(unlocked);
        recordNew(fresh);
        return fresh;
    }
    function titleRarity(name) { const a = ACHIEVEMENTS.find(x => x.title === name); return a ? a.rarity : null; }
    function newKeys() { const v = readJSON(NEW_KEY); return Array.isArray(v) ? v : []; }
    function clearNew() {
        try { localStorage.removeItem(NEW_KEY); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('wh:achievements', { detail: [] })); } catch (e) {}
    }
    function unlockedCount() { return ACHIEVEMENTS.filter(isUnlocked).length; }

    window.WHA = { ACHIEVEMENTS, CATEGORIES, BY_KEY, RARITY_COLORS, snapshot, progress, isUnlocked, checkAll, unlock, titleRarity, newKeys, clearNew, unlockedCount };
})();
