/**
 * Special Upgrades menu: every special's name, effect and flavor text, and the tile UI.
 * Game state (purchased flags, costs, multipliers, buy functions) lives in main.js; this file reads it by name.
 * main.js calls updateSpecialsMenu() from updateDisplays().
 */
(function () {
    'use strict';

    // read a top-level main.js binding by name (let/const bindings aren't on window, so compile a tiny getter)
    const getters = {};
    function read(name) {
        if (!getters[name]) {
            try { getters[name] = new Function('try { return ' + name + '; } catch (e) { return undefined; }'); }
            catch (e) { getters[name] = () => undefined; }
        }
        return getters[name]();
    }

    // what each kind of effect multiplies
    const KINDS = {
        click: 'Click power',
        pirate: 'Somalian Pirate CPS',
        allButPirate: 'All CPS except the Pirate',
        crew: 'Crew CPS',
        total: 'Total CPS',
        phonk: 'The Phonk Man\'s CPS',
        jonathan: 'Jonathan\'s CPS',
        cr: 'CR lurker\'s CPS',
        roping: 'ropingnecurse CPS',
        skibidi: 'skibbidi scimitar CPS',
        beats: 'What Happened Beats CPS',
        ez: 'ez villager CPS',
        scp: 'scp CPS',
        goatis: 'The Goatis CPS',
        raw: 'goatises raw liver CPS',
        landon: 'The Landon Stream CPS',
        bass: 'The Bass CPS',
        noodles: 'Good Noodles CPS',
        mobile: 'Mobile Man 38 CPS',
        easton: 'Easton Bundy CPS',
        tomPearl: 'Tom Pearl CPS',
        hypergamy: 'Hypergamy CPS',
        evilPirate: 'Evil Somalian Pirate CPS',
        oalgo: 'O\'algo CPS',
        siberianHitman: 'Siberian Hitman CPS',
    };
    const CREW_NOTE = 'Crew = every upgrade except the Pirate, Jonathan, CR lurker and The Phonk Man.';
    const TIER_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

    // [id, unlock level, buy function, purchased flag, cost variable, effect kind, multiplier variable or null, value, name, flavor]
    // kind 'base' adds `value` CPS; every other kind multiplies by the multiplier variable (falling back to `value`).
    const GROUPS = [
        { key: 'op', up: 1, img: 'opmouse.png', items: [
            ['special1', 10, 'buySpecial1', 'special1Purchased', 'special1Cost', 'click', 'special1Multiplier', 1.5, 'Mousepad of Destiny', 'Fresh out of the box, it already feels faster. It isn\'t. It\'s a mousepad.'],
            ['special2', 25, 'buySpecial2', 'special2Purchased', 'special2Cost', 'click', 'special2Multiplier', 2, 'RGB Underglow', 'Everyone knows RGB adds at least 20% performance. The rest is placebo, and placebo is free.'],
            ['special3', 50, 'buySpecial3', 'special3Purchased', 'special3Cost', 'click', 'special3Multiplier', 2, 'Weighted Clicks', 'Six tiny tungsten weights, each one hand-forged by a guy named Greg in his garage.'],
            ['special4', 100, 'buySpecial4', 'special4Purchased', 'special4Cost', 'click', 'special4Multiplier', 2.5, 'Optical Overdrive', 'The sensor now tracks movements you haven\'t made yet.'],
            ['special5', 150, 'buySpecial5', 'special5Purchased', 'special5Cost', 'click', 'special5Multiplier', 3, 'Butterfly Switches', 'Accidental double clicks are a feature now. The warranty department has stopped answering calls.'],
            ['special6', 200, 'buySpecial6', 'special6Purchased', 'special6Cost', 'click', 'special6Multiplier', 3.5, 'Carpal Tunnel Vision', 'You can no longer feel your wrist. You can, however, feel the What Happeneds.'],
            ['special7', 250, 'buySpecial7', 'special7Purchased', 'special7Cost', 'click', 'special7Multiplier', 3.5, 'Mouse of Theseus', 'Every part has been replaced at least twice. Is it still the same mouse? It\'s still OP.'],
            ['special8', 300, 'buySpecial8', 'special8Purchased', 'special8Cost', 'click', 'special8Multiplier', 4, 'The Final Click', 'Legends say a single click from this mouse was heard across the entire server.'],
        ] },
        { key: 'pirate', up: 2, img: 'somaliflag.png', items: [
            ['pirate1', 10, 'buyPirate1', 'pirateSpec1Purchased', 'pirateSpec1Cost', 'pirate', 'pirateSpec1Multiplier', 1.5, 'Bigger Speedboat', 'Twice the horsepower, half the seatbelts.'],
            ['pirate2', 25, 'buyPirate2', 'pirateSpec2Purchased', 'pirateSpec2Cost', 'pirate', 'pirateSpec2Multiplier', 1.5, 'Plunder Insurance', 'Covers loss, theft, and anything that "fell off the ship".'],
            ['pirate3', 50, 'buyPirate3', 'pirateSpec3Purchased', 'pirateSpec3Cost', 'pirate', 'pirateSpec3Multiplier', 2, 'The Captain\'s Hat', 'He found it floating in the sea and declared himself captain. Nobody argued.'],
            ['pirate4', 100, 'buyPirate4', 'pirateSpec4Purchased', 'pirateSpec4Cost', 'pirate', 'pirateSpec4Multiplier', 1.25, 'Ransom Negotiator', 'Hostage: one What Happened. Demands: more What Happeneds.'],
        ] },
        { key: 'goon', up: 3, img: 'goonsawman.png', items: [
            ['goon1', 10, 'buyGoon1', 'goonSpec1Purchased', 'goonSpec1Cost', 'allButPirate', 'goonSpec1Multiplier', 2, 'Second Chainsaw', 'One chainsaw is a tool. Two chainsaws is a lifestyle.'],
            ['goon2', 25, 'buyGoon2', 'goonSpec2Purchased', 'goonSpec2Cost', 'allButPirate', 'goonSpec2Multiplier', 2, 'Premium Bar Oil', 'Smoother cuts, smoother vibes. The whole crew works faster once the saws stop screaming.'],
            ['goon3', 50, 'buyGoon3', 'goonSpec3Purchased', 'goonSpec3Cost', 'allButPirate', 'goonSpec3Multiplier', 1.5, 'Safety Goggles', '"Optional," he said. The crew insisted. Productivity went up anyway.'],
            ['goon4', 100, 'buyGoon4', 'goonSpec4Purchased', 'goonSpec4Cost', 'allButPirate', 'goonSpec4Multiplier', 2.5, 'Chainsaw Choir', 'When every saw in town revs in harmony, everyone picks up the pace.'],
        ] },
        { key: 'diddy', up: 4, img: 'diddyblud.png', items: [
            ['diddy1', 10, 'buyDiddy1', 'diddy1Purchased', 'diddy1Cost', 'base', null, 50, 'Party Invitation', 'Everyone who\'s anyone got an invite. Nobody asks what the party is for.'],
            ['diddy2', 25, 'buyDiddy2', 'diddy2Purchased', 'diddy2Cost', 'crew', null, 2, 'VIP Wristbands', 'The whole crew gets in. The whole crew works twice as hard to stay in.'],
            ['diddy3', 50, 'buyDiddy3', 'diddy3Purchased', 'diddy3Cost', 'click', null, 1.5, 'Hype Man', 'Every click gets a guy in the background shouting "LET\'S GO!" It helps more than it should.'],
            ['diddy4', 100, 'buyDiddy4', 'diddy4Purchased', 'diddy4Cost', 'total', null, 1.25, 'Platinum Record', 'Hung in the hallway where everyone can see it. Morale is up 25%.'],
        ] },
        { key: 'argon', up: 5, img: 'argoonion.png', items: [
            ['argon1', 10, 'buyArgon1', 'argon1Purchased', 'argon1Cost', 'click', 'argon1Multiplier', 1.5, 'Hist Sap Drip', 'A single drop of sap from the Hist. The scales tingle. The clicks hit harder.'],
            ['argon2', 25, 'buyArgon2', 'argon2Purchased', 'argon2Cost', 'crew', 'argon2Multiplier', 2, 'Black Marsh Work Ethic', 'In the marsh, nobody sleeps. Your crew has quietly adopted this policy.'],
            ['argon3', 50, 'buyArgon3', 'argon3Purchased', 'argon3Cost', 'click', 'argon3Multiplier', 2, 'Tail Click Technique', 'Why click with one hand when you could also click with your tail?'],
            ['argon4', 100, 'buyArgon4', 'argon4Purchased', 'argon4Cost', 'total', 'argon4Multiplier', 1.5, 'Saxhleel Ascension', 'The Hist has chosen you. Everything you own is now 50% more lizard.'],
        ] },
        { key: 'grape', up: 6, img: 'grapegod.png', items: [
            ['grape1', 10, 'buyGrape1', 'grape1Purchased', 'grape1Cost', 'base', null, 1000, 'Vineyard Tithe', 'The faithful leave grapes at the altar. The God counts them as income.'],
            ['grape2', 25, 'buyGrape2', 'grape2Purchased', 'grape2Cost', 'crew', 'grape2Multiplier', 2, 'Fermentation', 'Leave grapes alone long enough and they turn into something your crew really likes.'],
            ['grape3', 50, 'buyGrape3', 'grape3Purchased', 'grape3Cost', 'click', 'grape3Multiplier', 2, 'Holy Raisin', 'A grape that has seen things. Shriveled, wise, and surprisingly good at clicking.'],
            ['grape4', 100, 'buyGrape4', 'grape4Purchased', 'grape4Cost', 'total', 'grape4Multiplier', 2, 'Divine Harvest', 'Once a season the Grape God remembers he\'s a god. Everything doubles. Then he forgets again.'],
        ] },
        { key: 'skippie', up: 7, img: 'skippytoilet.png', items: [
            ['skippie1', 10, 'buySkippie1', 'skippie1Purchased', 'skippie1Cost', 'base', null, 5000, 'Extra Ply', 'Luxury has a price, and that price turns out to be very profitable.'],
            ['skippie2', 25, 'buySkippie2', 'skippie2Purchased', 'skippie2Cost', 'crew', 'skippie2Multiplier', 2, 'Flush Protocol', 'Skippie the toilet, skippie the skippie the... whatever it means, the crew gets it.'],
            ['skippie3', 50, 'buySkippie3', 'skippie3Purchased', 'skippie3Cost', 'click', 'skippie3Multiplier', 2, 'Porcelain Polish', 'So shiny you can watch your own reflection clicking faster.'],
            ['skippie4', 100, 'buySkippie4', 'skippie4Purchased', 'skippie4Cost', 'total', 'skippie4Multiplier', 2, 'The Golden Throne', 'Every empire needs a throne. This one happens to flush.'],
        ] },
        { key: 'island', up: 8, img: 'island.png', items: [
            ['island1', 10, 'buyIsland1', 'island1Purchased', 'island1Cost', 'base', null, 50000, 'Washed-Up Crate', 'Nobody knows where it came from. Nobody\'s sending it back.'],
            ['island2', 25, 'buyIsland2', 'island2Purchased', 'island2Cost', 'crew', 'island2Multiplier', 2, 'Unmarked Map', 'X marks the spot. There are forty X\'s. Your crew is digging up all of them.'],
            ['island3', 50, 'buyIsland3', 'island3Purchased', 'island3Cost', 'click', 'island3Multiplier', 2, 'Coconut Telephone', 'Long-distance clicks, routed through a coconut. The signal is somehow perfect.'],
            ['island4', 100, 'buyIsland4', 'island4Purchased', 'island4Cost', 'total', 'island4Multiplier', 2, 'Smoke on the Horizon', 'Something on the island woke up. Best not to ask questions. Everything doubles.'],
        ] },
        { key: 'tribal', up: 9, img: 'tribalcamp.png', items: [
            ['tribal1', 10, 'buyTribal1', 'tribal1Purchased', 'tribal1Cost', 'base', null, 200000, 'Bonfire Rituals', 'Dance around the fire until What Happeneds start falling from the sky.'],
            ['tribal2', 25, 'buyTribal2', 'tribal2Purchased', 'tribal2Cost', 'crew', 'tribal2Multiplier', 2, 'War Drums', 'The rhythm carries across the valley, and every worker falls into step.'],
            ['tribal3', 50, 'buyTribal3', 'tribal3Purchased', 'tribal3Cost', 'click', 'tribal3Multiplier', 2, 'Totem Carving', 'Every face on the totem is clicking. You\'re not sure when that started.'],
            ['tribal4', 100, 'buyTribal4', 'tribal4Purchased', 'tribal4Cost', 'total', 'tribal4Multiplier', 2, 'Ancestral Spirits', 'The elders have returned to help. They are very, very good at this game.'],
        ] },
        { key: 'phonk', up: 10, img: 'phonkman.png', items: [
            ['phonk1', 10, 'buyPhonk1', 'phonk1Purchased', 'phonk1Cost', 'total', 'phonk1Multiplier', 1.25, 'Cowbell Loop', 'More cowbell. Always more cowbell.'],
            ['phonk2', 25, 'buyPhonk2', 'phonk2Purchased', 'phonk2Cost', 'total', 'phonk2Multiplier', 1.25, 'Bass Boosted', 'The subwoofer is now louder than the factory. The factory doesn\'t mind.'],
            ['phonk3', 50, 'buyPhonk3', 'phonk3Purchased', 'phonk3Cost', 'total', 'phonk3Multiplier', 1.5, 'Drift Edit', 'Every upgrade now moves like it\'s sliding sideways through a parking garage at 2 AM.'],
            ['phonk4', 75, 'buyPhonk4', 'phonk4Purchased', 'phonk4Cost', 'phonk', 'phonk4Multiplier', 2, 'Memphis Tapes', 'The Phonk Man digs through crates of old cassettes. His own output doubles.'],
            ['phonk5', 100, 'buyPhonk5', 'phonk5Purchased', 'phonk5Cost', 'total', 'phonk5Multiplier', 2, 'The Drop', 'The beat drops. So does your jaw. Everything doubles.'],
        ] },
        { key: 'jonathan', up: 11, img: 'jonathan.png', items: [
            ['jonathan1', 10, 'buyJonathan1', 'jonathan1Purchased', 'jonathan1Cost', 'jonathan', 'jonathan1Multiplier', 1.5, 'Morning Coffee', 'He seems like a normal guy drinking a normal coffee. His output is not normal.'],
            ['jonathan2', 25, 'buyJonathan2', 'jonathan2Purchased', 'jonathan2Cost', 'jonathan', 'jonathan2Multiplier', 1.5, 'The Spreadsheet', 'Every What Happened logged, cross-referenced and color coded. His dedication is unmatched.'],
            ['jonathan3', 50, 'buyJonathan3', 'jonathan3Purchased', 'jonathan3Cost', 'click', 'jonathan3Multiplier', 4, 'Jonathan\'s Index Finger', 'Four times stronger than a regular finger. Nobody knows how he trained it.'],
            ['jonathan4', 75, 'buyJonathan4', 'jonathan4Purchased', 'jonathan4Cost', 'jonathan', 'jonathan4Multiplier', 2, 'Employee of the Month', 'Every month, for years. They ran out of plaques and just gave him the wall.'],
        ] },
        { key: 'cr', up: 12, img: 'cr_lurker.png', items: [
            ['cr1', 10, 'buyCr1', 'cr1Purchased', 'cr1Cost', 'cr', 'cr1Multiplier', 1.5, 'Lurk Mode', 'Nobody knows what CR stands for. He\'s been watching the whole time, though.'],
            ['cr2', 25, 'buyCr2', 'cr2Purchased', 'cr2Cost', 'cr', 'cr2Multiplier', 1.5, 'Night Shift', 'He doesn\'t sleep. He lurks. Lurking is more productive anyway.'],
            ['cr3', 50, 'buyCr3', 'cr3Purchased', 'cr3Cost', 'click', 'cr3Multiplier', 3, 'Read Receipts', 'He saw your message. He saw every message. Your clicks hit three times harder.'],
            ['cr4', 75, 'buyCr4', 'cr4Purchased', 'cr4Cost', 'cr', 'cr4Multiplier', 2, 'What CR Stands For', 'He finally told someone what CR stands for. They were never the same. His output doubles.'],
            ['cr5', 100, 'buyCr5', 'cr5Purchased', 'cr5Cost', 'allButPirate', 'cr5Multiplier', 2, 'Army of Lurkers', 'There were always more of them. Now they all work for you.'],
        ] },
        { key: 'roping', up: 13, img: 'ropingnecurse.png', items: [
            ['roping1', 10, 'buyRoping1', 'roping1Purchased', 'roping1Cost', 'roping', 'roping1Multiplier', 1.5, 'Frayed Ends', 'The more the rope frays, the stronger the curse gets.'],
            ['roping2', 25, 'buyRoping2', 'roping2Purchased', 'roping2Cost', 'roping', 'roping2Multiplier', 2, 'Knot of Binding', 'Tied in a knot nobody can name. Untying it is considered extremely rude.'],
            ['roping3', 50, 'buyRoping3', 'roping3Purchased', 'roping3Cost', 'roping', 'roping3Multiplier', 2, 'Hex Lasso', 'Rope in one passing What Happened, then rope in all of its friends.'],
            ['roping4', 75, 'buyRoping4', 'roping4Purchased', 'roping4Cost', 'roping', 'roping4Multiplier', 2.25, 'The Endless Loop', 'The rope no longer has an end. Neither does the CPS.'],
        ] },
        { key: 'skibbidi', up: 14, img: 'skibbidi.png', items: [
            ['skibidi1', 10, 'buySkibidi1', 'skibidi1Purchased', 'skibidi1Cost', 'skibidi', 'skibidi1Multiplier', 1.5, 'Whetstone', 'A sharper blade means sharper What Happeneds. That\'s just science.'],
            ['skibidi2', 25, 'buySkibidi2', 'skibidi2Purchased', 'skibidi2Cost', 'skibidi', 'skibidi2Multiplier', 2, 'Toilet-Tempered Steel', 'Quenched in the finest porcelain. Do not ask about the smell.'],
            ['skibidi3', 50, 'buySkibidi3', 'skibidi3Purchased', 'skibidi3Cost', 'skibidi', 'skibidi3Multiplier', 2, 'Dual Wield', 'One scimitar for each hand. Both of them doing skibidi.'],
            ['skibidi4', 75, 'buySkibidi4', 'skibidi4Purchased', 'skibidi4Cost', 'skibidi', 'skibidi4Multiplier', 2.25, 'Blade of a Thousand Flushes', 'It has cut through every timeline where the toilets won.'],
        ] },
        { key: 'beats', up: 15, img: 'beats.png', items: [
            ['beats1', 10, 'buyBeats1', 'beats1Purchased', 'beats1Cost', 'beats', 'beats1Multiplier', 1.5, 'Metronome', 'A steady 140 BPM. The What Happeneds arrive right on the beat.'],
            ['beats2', 25, 'buyBeats2', 'beats2Purchased', 'beats2Cost', 'beats', 'beats2Multiplier', 2, 'Sample Pack', 'Every sound in it is someone asking "what happened?" Somehow, it slaps.'],
            ['beats3', 50, 'buyBeats3', 'beats3Purchased', 'beats3Cost', 'beats', 'beats3Multiplier', 2.5, 'Platinum Mixtape', 'Certified platinum by a panel of one guy. Still counts.'],
        ] },
        { key: 'ez', up: 16, img: 'ezvillager.png', items: [
            ['ez1', 10, 'buyEz1', 'ez1Purchased', 'ez1Cost', 'ez', 'ez1Multiplier', 1.5, 'Hrmm Contract', '"Hrmm." "Hmm." "Hrrmm." (The villagers agree to work slightly harder.)'],
            ['ez2', 25, 'buyEz2', 'ez2Purchased', 'ez2Cost', 'ez', 'ez2Multiplier', 2, 'Iron Golem Supervisor', 'Nobody slacks off while a three-meter iron giant is watching.'],
            ['ez3', 50, 'buyEz3', 'ez3Purchased', 'ez3Cost', 'ez', 'ez3Multiplier', 2, 'Emerald Bonuses', 'Pay them in emeralds and they\'ll do anything. Mostly they stand still, but faster.'],
            ['ez4', 100, 'buyEz4', 'ez4Purchased', 'ez4Cost', 'ez', 'ez4Multiplier', 2, 'Trading Hall', 'Hundreds of villagers, perfectly organized, each doing nothing at maximum efficiency.'],
        ] },
        { key: 'scp', up: 17, img: 'scp.png', items: [
            ['scp1', 10, 'buyScp1', 'scp1Purchased', 'scp1Cost', 'scp', null, 2, 'Containment Breach', 'Wish I knew. Wish I knew. Wish I knew. The anomaly now produces twice as much.'],
            ['scp2', 25, 'buyScp2', 'scp2Purchased', 'scp2Cost', 'scp', null, 2, 'Class-D Volunteers', '"Volunteers" is a strong word.'],
            ['scp3', 50, 'buyScp3', 'scp3Purchased', 'scp3Cost', 'scp', null, 2, 'Keter Classification', 'Officially too dangerous to contain. Unofficially, too profitable to stop.'],
            ['scp4', 75, 'buyScp4', 'scp4Purchased', 'scp4Cost', 'scp', null, 2, '[REDACTED]', '████ █████ ██ ████ ███████. Output doubled. ████.'],
        ] },
        { key: 'goatis', up: 18, img: 'goatis.png', items: [
            ['goatis1', 10, 'buyGoatis1', 'goatis1Purchased', 'goatis1Cost', 'goatis', 'goatis1Multiplier', 1.5, 'Chocolate Ban', 'You never wanted chocolate. Now nobody gets chocolate.'],
            ['goatis2', 25, 'buyGoatis2', 'goatis2Purchased', 'goatis2Cost', 'goatis', 'goatis2Multiplier', 2, 'Goat Yoga', 'Excellent for the spine. Terrible for the yoga mat.'],
            ['goatis3', 50, 'buyGoatis3', 'goatis3Purchased', 'goatis3Cost', 'goatis', 'goatis3Multiplier', 2, 'Horns of Plenty', 'Grab the goat by the horns. Turns out they\'re made of What Happeneds.'],
            ['goatis4', 100, 'buyGoatis4', 'goatis4Purchased', 'goatis4Cost', 'goatis', 'goatis4Multiplier', 2.25, 'G.O.A.T. Status', 'Greatest of all time. It\'s literally in the name.'],
        ] },
        { key: 'raw', up: 19, img: 'rawliver.png', items: [
            ['raw1', 10, 'buyRaw1', 'raw1Purchased', 'raw1Cost', 'raw', 'raw1Multiplier', 1.5, 'Freshly Harvested', '...you wanted raw liver. And it is so, so fresh.'],
            ['raw2', 25, 'buyRaw2', 'raw2Purchased', 'raw2Cost', 'raw', 'raw2Multiplier', 2, 'Iron Supplement', 'Packed with iron. Your workers feel like they could lift a car.'],
            ['raw3', 50, 'buyRaw3', 'raw3Purchased', 'raw3Cost', 'raw', 'raw3Multiplier', 2, 'Ancestral Diet', 'Primal living has never been this profitable, or this smelly.'],
            ['raw4', 100, 'buyRaw4', 'raw4Purchased', 'raw4Cost', 'raw', 'raw4Multiplier', 2.25, 'Organ Overdrive', 'Raw liver. Raw power. Raw CPS.'],
        ] },
        { key: 'landon', up: 20, img: 'landonstream.png', items: [
            ['landon1', 10, 'buyLandon1', 'landon1Purchased', 'landon1Cost', 'landon', 'landon1Multiplier', 1.5, 'Stream Starting Soon', 'The chat is filling up. Everyone is waiting very respectfully.'],
            ['landon2', 25, 'buyLandon2', 'landon2Purchased', 'landon2Cost', 'landon', 'landon2Multiplier', 2, 'Wholesome Chat', 'No spam, no swearing, just good vibes and a lot of What Happeneds.'],
            ['landon3', 50, 'buyLandon3', 'landon3Purchased', 'landon3Cost', 'landon', 'landon3Multiplier', 2, 'Sunday Marathon', 'Twelve hours live, and the donations never stop rolling in.'],
            ['landon4', 100, 'buyLandon4', 'landon4Purchased', 'landon4Cost', 'landon', 'landon4Multiplier', 2.25, 'Most Respectful Main', 'Blessed, focused and absolutely cracked. The stream has gone viral.'],
        ] },
        { key: 'theBass', up: 21, img: 'seabass.png', items: [
            ['theBass1', 10, 'buyTheBass1', 'theBass1Purchased', 'theBass1Cost', 'bass', 'theBass1Multiplier', 1.5, 'What Is the Cat\'s Name?', 'Nobody has ever answered correctly. The Bass grows stronger every time someone asks.'],
            ['theBass2', 25, 'buyTheBass2', 'theBass2Purchased', 'theBass2Cost', 'bass', 'theBass2Multiplier', 2, 'Deep Water', 'The Bass lives deep. So does the CPS.'],
            ['theBass3', 50, 'buyTheBass3', 'theBass3Purchased', 'theBass3Cost', 'bass', 'theBass3Multiplier', 2, 'Drop the Bass', 'Literally. It fell off the table. Production doubled anyway.'],
            ['theBass4', 100, 'buyTheBass4', 'theBass4Purchased', 'theBass4Cost', 'bass', 'theBass4Multiplier', 2.25, 'King of the Lake', 'Every fish bows before The Bass. The cat is still unnamed.'],
        ] },
        { key: 'goodNoodles', up: 22, img: 'goodNoodles.png', items: [
            ['goodNoodles1', 10, 'buyGoodNoodles1', 'goodNoodles1Purchased', 'goodNoodles1Cost', 'noodles', null, 1.5, 'Extra Broth', 'We eating good noodles every day.'],
            ['goodNoodles2', 25, 'buyGoodNoodles2', 'goodNoodles2Purchased', 'goodNoodles2Cost', 'noodles', null, 2, 'Hand-Pulled Strands', 'Stretched, folded and slapped on the counter. Twice the noodle, twice the output.'],
            ['goodNoodles3', 50, 'buyGoodNoodles3', 'goodNoodles3Purchased', 'goodNoodles3Cost', 'noodles', null, 2.5, 'Secret Spice Blend', 'The recipe is locked in a vault. The vault is also full of noodles.'],
            ['goodNoodles4', 100, 'buyGoodNoodles4', 'goodNoodles4Purchased', 'goodNoodles4Cost', 'noodles', null, 3, 'Bottomless Bowl', 'Every day. Every meal. Forever. We eating good.'],
        ] },
        { key: 'mobileMan38', up: 23, img: 'mobile.png', items: [
            ['mobileMan381', 10, 'buyMobileMan381', 'mobileMan381Purchased', 'mobileMan381Cost', 'mobile', null, 1.5, 'Signal Booster', 'Five bars, everywhere, all the time. Even in the elevator.'],
            ['mobileMan382', 25, 'buyMobileMan382', 'mobileMan382Purchased', 'mobileMan382Cost', 'mobile', null, 2, 'Unlimited Data Plan', 'No throttling, no overage fees, no mercy.'],
            ['mobileMan383', 50, 'buyMobileMan383', 'mobileMan383Purchased', 'mobileMan383Cost', 'mobile', null, 2.5, 'Tower 38', 'There were 37 towers before this one. Nobody talks about them.'],
            ['mobileMan384', 100, 'buyMobileMan384', 'mobileMan384Purchased', 'mobileMan384Cost', 'mobile', null, 3, 'Full Coverage', 'What Happeneds delivered straight to your pocket, at gigabit speeds.'],
        ] },
        { key: 'easton', up: 24, img: 'eastonBundy.png', items: [
            ['eastonBundy1', 10, 'buyEastonBundy1', 'eastonBundy1Purchased', 'eastonBundy1Cost', 'easton', null, 1.5, 'Overtime Shift', 'An exceptional operator who never clocks out.'],
            ['eastonBundy2', 25, 'buyEastonBundy2', 'eastonBundy2Purchased', 'eastonBundy2Cost', 'easton', null, 2, 'Corner Office', 'Great view, comfy chair, triple monitors. Output doubles.'],
            ['eastonBundy3', 50, 'buyEastonBundy3', 'eastonBundy3Purchased', 'eastonBundy3Cost', 'easton', null, 2.5, 'Silent Partner', 'He doesn\'t just run operations anymore. He is the operation.'],
            ['eastonBundy4', 100, 'buyEastonBundy4', 'eastonBundy4Purchased', 'eastonBundy4Cost', 'easton', null, 3, 'The Bundy Empire', 'Everything you can see belongs to Easton Bundy. Somehow, that includes you.'],
        ] },
        { key: 'tomPearl', up: 25, img: 'tompearl.webp', items: [
            ['tomPearl1', 10, 'buyTomPearl1', 'tomPearl1Purchased', 'tomPearl1Cost', 'tomPearl', null, 1.5, 'Purple Shades', 'They block out 100% of sunlight and 0% of the vibes.'],
            ['tomPearl2', 25, 'buyTomPearl2', 'tomPearl2Purchased', 'tomPearl2Cost', 'tomPearl', null, 2, 'Phonk Remix', 'Somebody slowed it down and added cowbell. It is now twice as powerful.'],
            ['tomPearl3', 50, 'buyTomPearl3', 'tomPearl3Purchased', 'tomPearl3Cost', 'tomPearl', null, 2.5, 'Electric Grin', 'That smile has been measured at 40,000 volts.'],
            ['tomPearl4', 100, 'buyTomPearl4', 'tomPearl4Purchased', 'tomPearl4Cost', 'tomPearl', null, 3, 'Pearl Jam', 'The whole server is listening. Nobody can turn it off.'],
        ] },
        { key: 'hypergamy', up: 26, img: 'hypergamy.webp', items: [
            ['hypergamy1', 10, 'buyHypergamy1', 'hypergamy1Purchased', 'hypergamy1Cost', 'hypergamy', null, 1.5, 'More Arrows', 'The diagram needed more arrows. Productivity agrees.'],
            ['hypergamy2', 25, 'buyHypergamy2', 'hypergamy2Purchased', 'hypergamy2Cost', 'hypergamy', null, 2, 'Expectation Arrow', 'Anything above the arrow is a catch. Your CPS is now above the arrow.'],
            ['hypergamy3', 50, 'buyHypergamy3', 'hypergamy3Purchased', 'hypergamy3Cost', 'hypergamy', null, 2.5, 'Peer Review', 'Three guys on a forum looked at it and said "true." Science.'],
            ['hypergamy4', 100, 'buyHypergamy4', 'hypergamy4Purchased', 'hypergamy4Cost', 'hypergamy', null, 3, 'The Top 20%', 'Every What Happened now wants to be in your portfolio.'],
        ] },
        { key: 'evilPirate', up: 27, img: 'evilpirate.webp', items: [
            ['evilPirate1', 10, 'buyEvilPirate1', 'evilPirate1Purchased', 'evilPirate1Cost', 'evilPirate', null, 1.5, 'Black Flag', 'The good pirate flies a blue flag. This one does not.'],
            ['evilPirate2', 25, 'buyEvilPirate2', 'evilPirate2Purchased', 'evilPirate2Cost', 'evilPirate', null, 2, 'Mutiny', 'He took over the good pirate\'s ship. And his speedboat. And his hat.'],
            ['evilPirate3', 50, 'buyEvilPirate3', 'evilPirate3Purchased', 'evilPirate3Cost', 'evilPirate', null, 2.5, 'No Ransom', 'He doesn\'t negotiate. He just takes the What Happeneds.'],
            ['evilPirate4', 100, 'buyEvilPirate4', 'evilPirate4Purchased', 'evilPirate4Cost', 'evilPirate', null, 3, 'Scourge of the Gulf', 'Every ship on the horizon now belongs to him. Every single one.'],
        ] },
        { key: 'oalgo', up: 28, img: 'oalgo.webp', items: [
            ['oalgo1', 10, 'buyOalgo1', 'oalgo1Purchased', 'oalgo1Cost', 'oalgo', null, 1.5, 'Chapter One', 'Ad hominem, strawman, slippery slope. He took notes.'],
            ['oalgo2', 25, 'buyOalgo2', 'oalgo2Purchased', 'oalgo2Cost', 'oalgo', null, 2, 'The Queen of Spades', 'A small pin, a big statement. Output doubles.'],
            ['oalgo3', 50, 'buyOalgo3', 'oalgo3Purchased', 'oalgo3Cost', 'oalgo', null, 2.5, 'Socratic Method', 'He asks one question. The CPS answers it.'],
            ['oalgo4', 100, 'buyOalgo4', 'oalgo4Purchased', 'oalgo4Cost', 'oalgo', null, 3, 'Philosopher King', 'He finished the book. He wrote the sequel. Every argument is now his.'],
        ] },
        { key: 'siberianHitman', up: 29, img: 'mainimage/siberianHitman.webp', items: [
            ['siberianHitman1', 10, 'buySiberianHitman1', 'siberianHitman1Purchased', 'siberianHitman1Cost', 'siberianHitman', 'siberianHitmanMultiplier', 1.5, 'Cold Precision', 'Every target is acquired. Every What Happened lands exactly where it should.'],
            ['siberianHitman2', 25, 'buySiberianHitman2', 'siberianHitman2Purchased', 'siberianHitman2Cost', 'siberianHitman', 'siberianHitmanMultiplier', 2, 'Winter Operations', 'The Siberian cold slows everyone else down. The Hitman works twice as fast.'],
            ['siberianHitman3', 50, 'buySiberianHitman3', 'siberianHitman3Purchased', 'siberianHitman3Cost', 'siberianHitman', 'siberianHitmanMultiplier', 2.5, 'No Witnesses', 'No loose ends, no wasted What Happeneds.'],
            ['siberianHitman4', 100, 'buySiberianHitman4', 'siberianHitman4Purchased', 'siberianHitman4Cost', 'siberianHitman', 'siberianHitmanMultiplier', 3, 'The Last Contract', 'The contract is complete. Siberian Hitman output triples.'],
        ] },
    ];

    const SPECIALS = [];
    GROUPS.forEach(g => {
        g.name = (typeof UPGRADE_NAMES !== 'undefined' && UPGRADE_NAMES[g.up]) || g.key;
        g.items = g.items.map((r, i) => {
            const sp = { id: r[0], lvl: r[1], buy: r[2], owned: r[3], cost: r[4], kind: r[5], multVar: r[6], value: r[7], name: r[8], flavor: r[9], tier: i, group: g };
            SPECIALS.push(sp);
            return sp;
        });
    });
    const BY_ID = {};
    SPECIALS.forEach(s => { BY_ID[s.id] = s; });

    // ---------------- state ----------------
    function fmt(n) { try { return formatNumber(n); } catch (e) { return String(n); } }
    function upgradeLevel(up) { try { return numericLevel(getUpgradeLevel(up)); } catch (e) { return 0; } }
    function isOwned(sp) { return !!read(sp.owned); }
    function costOf(sp) { return read(sp.cost); }
    function affordable(sp) {
        const c = costOf(sp);
        try { return canAfford(c); } catch (e) { return Number(read('count')) >= Number(c); }
    }
    function multOf(sp) {
        if (sp.multVar) { const v = Number(read(sp.multVar)); if (isFinite(v) && v > 0) return v; }
        return sp.value;
    }
    function effectText(sp) {
        if (sp.kind === 'base') return `+${fmt(sp.value)} base CPS`;
        const m = multOf(sp);
        return `${KINDS[sp.kind]} ×${Number.isInteger(m) ? m : m.toFixed(2).replace(/0$/, '')}`;
    }
    // 'owned' | 'ready' | 'poor' (unlocked, can't afford) | 'locked'
    function stateOf(sp) {
        if (isOwned(sp)) return 'owned';
        if (upgradeLevel(sp.group.up) < sp.lvl) return 'locked';
        return affordable(sp) ? 'ready' : 'poor';
    }

    // ---------------- DOM ----------------
    let built = false;
    let filter = 'all';
    const tiles = {};
    let tipFor = null, tipPinned = false;
    const touchUI = () => window.matchMedia && window.matchMedia('(hover: none)').matches;

    function build() {
        const root = document.getElementById('specialContent');
        if (!root) return false;
        root.innerHTML = GROUPS.map(g => {
            const image = g.img.startsWith('mainimage/') ? g.img : `mainimage/upgrades/thumbs/${g.img.replace(/\.png$/, '.webp')}`;
            return `<section class="sp-group" data-group="${g.key}" hidden>
            <header class="sp-group-head"><img src="${image}" alt=""><span class="sp-group-name">${g.name}</span><span class="sp-group-count"></span></header>
            <div class="sp-tiles">${g.items.map(sp => `<button type="button" class="sp-tile sp-tier-${sp.tier + 1}" data-sp="${sp.id}" aria-label="${sp.name}">
                <img src="${image}" alt="" loading="lazy" draggable="false">
                <span class="sp-numeral">${TIER_NUMERALS[sp.tier]}</span><span class="sp-mark" aria-hidden="true"></span>
            </button>`).join('')}</div>
        </section>`;
        }).join('') + '<p class="sp-empty" hidden></p><p class="sp-more" hidden></p>';
        root.querySelectorAll('.sp-tile').forEach(el => { tiles[el.dataset.sp] = el; });
        root.addEventListener('click', onTileClick);
        root.addEventListener('mouseover', e => { const t = e.target.closest('.sp-tile'); if (t && !touchUI() && !tipPinned) showTip(t.dataset.sp, t); });
        root.addEventListener('mouseout', e => { const t = e.target.closest('.sp-tile'); if (t && !touchUI() && !tipPinned && !t.contains(e.relatedTarget)) hideTip(); });
        root.addEventListener('focusin', e => { const t = e.target.closest('.sp-tile'); if (t && !tipPinned) showTip(t.dataset.sp, t); });
        root.addEventListener('focusout', () => { if (!tipPinned) hideTip(); });
        root.addEventListener('scroll', () => { if (!tipPinned) hideTip(); });
        document.querySelectorAll('[data-spf]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.spf; updateSpecialsMenu(); }));
        const all = document.getElementById('spBuyAll');
        if (all) all.addEventListener('click', buyAllReady);
        document.addEventListener('click', e => {
            if (tipPinned && !e.target.closest('.sp-tip') && !e.target.closest('.sp-tile')) hideTip(true);
        });
        built = true;
        return true;
    }

    function onTileClick(e) {
        const t = e.target.closest('.sp-tile');
        if (!t) return;
        const sp = BY_ID[t.dataset.sp];
        // touch: first tap shows the card (with a Buy button); desktop: click buys straight away
        if (touchUI()) { showTip(sp.id, t, true); return; }
        tryBuy(sp, t);
    }
    function tryBuy(sp, tile) {
        const st = stateOf(sp);
        if (st === 'owned') return;
        if (st !== 'ready') {
            if (tile) { tile.classList.remove('sp-shake'); void tile.offsetWidth; tile.classList.add('sp-shake'); }
        }
        // the buy function explains why it can't be bought (locked / not enough What Happeneds)
        try { window[sp.buy](); } catch (err) { console.warn('special buy failed', sp.id, err); }
        if (isOwned(sp) && tile) { tile.classList.add('sp-just-bought'); setTimeout(() => tile.classList.remove('sp-just-bought'), 700); }
        if (tipFor === sp.id) renderTip();
    }
    function buyAllReady() {
        const ready = SPECIALS.filter(sp => stateOf(sp) === 'ready').sort((a, b) => Number(costOf(a)) - Number(costOf(b)));
        let bought = 0;
        for (const sp of ready) {
            if (stateOf(sp) !== 'ready') continue;
            try { window[sp.buy](); } catch (e) {}
            if (isOwned(sp)) { bought++; const t = tiles[sp.id]; if (t) { t.classList.add('sp-just-bought'); setTimeout(() => t.classList.remove('sp-just-bought'), 700); } }
        }
        try { if (bought) notify(`Bought ${bought} special upgrade${bought === 1 ? '' : 's'}.`); } catch (e) {}
        updateSpecialsMenu();
    }

    // ---------------- hover card ----------------
    function tipEl() {
        let el = document.getElementById('spTip');
        if (!el) {
            el = document.createElement('div');
            el.id = 'spTip';
            el.className = 'sp-tip';
            el.setAttribute('role', 'tooltip');
            el.hidden = true;
            document.body.appendChild(el);
            el.addEventListener('click', e => {
                if (e.target.closest('.sp-tip-buy') && tipFor) tryBuy(BY_ID[tipFor], tiles[tipFor]);
                if (e.target.closest('.sp-tip-close')) hideTip(true);
            });
        }
        return el;
    }
    function renderTip() {
        const sp = BY_ID[tipFor];
        if (!sp) return;
        const el = tipEl();
        const st = stateOf(sp);
        const lvl = upgradeLevel(sp.group.up);
        let status;
        if (st === 'owned') status = '<span class="sp-st sp-st--owned">✓ Owned</span>';
        else if (st === 'locked') status = `<span class="sp-st sp-st--locked">🔒 Unlocks at ${sp.group.name} level ${sp.lvl} <em>(now ${fmt(lvl)})</em></span>`;
        else status = `<span class="sp-st ${st === 'ready' ? 'sp-st--ready' : 'sp-st--poor'}">Cost: ${fmt(costOf(sp))} What Happeneds</span>`;
        const note = sp.kind === 'crew' ? `<div class="sp-tip-note">${CREW_NOTE}</div>` : '';
        const pinned = tipPinned;
        el.className = `sp-tip sp-tip--${st}${pinned ? ' sp-tip--pinned' : ''}`;
        el.innerHTML = `<div class="sp-tip-head"><img src="mainimage/upgrades/thumbs/${sp.group.img.replace(/\.png$/, '.webp')}" alt=""><div><b>${sp.name}</b><span>${sp.group.name} · Tier ${TIER_NUMERALS[sp.tier]}</span></div>
                ${pinned ? '<button type="button" class="sp-tip-close" aria-label="Close">✕</button>' : ''}</div>
            <div class="sp-tip-effect">${effectText(sp)}</div>
            <div class="sp-tip-status">${status}</div>
            <p class="sp-tip-flavor">“${sp.flavor}”</p>${note}
            ${pinned && st !== 'owned' ? `<button type="button" class="btn ${st === 'ready' ? 'btn-gold' : 'btn-ghost'} btn-sm btn-block sp-tip-buy"${st === 'ready' ? '' : ' disabled'}>${st === 'ready' ? 'Buy' : (st === 'locked' ? 'Locked' : 'Not enough What Happeneds')}</button>` : ''}`;
    }
    function showTip(id, tile, pin) {
        tipFor = id;
        tipPinned = !!pin;
        renderTip();
        const el = tipEl();
        el.hidden = false;
        if (tipPinned && touchUI()) { el.style.left = ''; el.style.top = ''; return; } // CSS docks it on touch screens
        const r = tile.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
        const menu = document.getElementById('specialMenu');
        // layout position (ignores the slide-in transform, so it's right even mid-animation)
        const panelLeft = menu ? menu.offsetLeft : r.left;
        let x, y;
        if (panelLeft - w - 12 >= 8) {
            // beside the panel (it sits on the right), level with the tile, so it never covers other tiles
            x = panelLeft - w - 12;
            y = r.top + r.height / 2 - h / 2;
        } else {
            // narrow screens: centred above the tile, or below it if there's no room
            x = r.left + r.width / 2 - w / 2;
            y = r.top - h - 10 >= 8 ? r.top - h - 10 : r.bottom + 10;
        }
        el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x)) + 'px';
        el.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y)) + 'px';
    }
    function hideTip(force) {
        if (tipPinned && !force) return;
        tipFor = null; tipPinned = false;
        const el = document.getElementById('spTip');
        if (el) el.hidden = true;
    }

    // ---------------- update (called from updateDisplays) ----------------
    let lastOwnedCount = -1;
    function updateSpecialsMenu() {
        // which special each upgrade unlocks next (upgrade tooltips show "next special in N levels")
        const next = {};
        let ready = 0, owned = 0, fullSets = 0;
        const states = {};
        for (const g of GROUPS) {
            let gOwned = 0;
            for (const sp of g.items) {
                const st = stateOf(sp);
                states[sp.id] = st;
                if (st === 'owned') { owned++; gOwned++; continue; }
                if (st === 'ready') ready++;
                if (next[g.up] === undefined || sp.lvl < next[g.up]) next[g.up] = sp.lvl;
            }
            if (gOwned === g.items.length) fullSets++;
            g._owned = gOwned;
        }
        window.__nextSpecialFor = next;
        if (owned !== lastOwnedCount) {
            lastOwnedCount = owned;
            // the achievements page reads these (it doesn't load the game)
            try {
                localStorage.setItem('whathappened_specials_owned', String(owned));
                localStorage.setItem('whathappened_specials_fullsets', String(fullSets));
                localStorage.setItem('whathappened_specials_total', String(SPECIALS.length));
            } catch (e) {}
        }
        // ready-to-buy count on the Specials nav button
        const navBtn = document.getElementById('specialMenuBtn');
        if (navBtn) {
            let badge = navBtn.querySelector('.nav-count');
            if (ready > 0) {
                if (!badge) { badge = document.createElement('span'); badge.className = 'nav-count'; navBtn.appendChild(badge); }
                if (badge.textContent !== String(ready)) badge.textContent = ready;
            } else if (badge) badge.remove();
        }
        const menu = document.getElementById('specialMenu');
        if (!menu || !menu.classList.contains('open')) { if (tipFor && !tipPinned) hideTip(); return; }
        if (!built && !build()) return;

        let visibleGroups = 0, hiddenGroups = 0;
        for (const g of GROUPS) {
            const section = document.querySelector(`.sp-group[data-group="${g.key}"]`);
            const discovered = upgradeLevel(g.up) >= 1;
            let shown = 0;
            for (const sp of g.items) {
                const t = tiles[sp.id], st = states[sp.id];
                const cls = 'sp-tile sp-tier-' + (sp.tier + 1) + ' is-' + st;
                if (t.className.replace(/ sp-(shake|just-bought)/g, '') !== cls) {
                    const extra = (t.classList.contains('sp-just-bought') ? ' sp-just-bought' : '') + (t.classList.contains('sp-shake') ? ' sp-shake' : '');
                    t.className = cls + extra;
                }
                const vis = discovered && (filter === 'all' || st === 'ready');
                t.hidden = !vis;
                if (vis) shown++;
            }
            const count = section.querySelector('.sp-group-count');
            const txt = `${g._owned}/${g.items.length}`;
            if (count.textContent !== txt) count.textContent = txt;
            section.classList.toggle('is-complete', g._owned === g.items.length);
            section.hidden = !shown;
            if (shown) visibleGroups++;
            if (!discovered) hiddenGroups++;
        }
        const empty = document.querySelector('#specialContent .sp-empty');
        if (empty) {
            empty.hidden = visibleGroups > 0;
            empty.textContent = filter === 'ready' ? 'Nothing ready to buy right now. Keep levelling your upgrades!' : 'Buy your first upgrades to discover their specials.';
        }
        const more = document.querySelector('#specialContent .sp-more');
        if (more) {
            more.hidden = !hiddenGroups || filter !== 'all';
            more.textContent = `${hiddenGroups} more upgrade${hiddenGroups === 1 ? ' has' : 's have'} specials waiting to be discovered.`;
        }
        const total = SPECIALS.length;
        const setText = (id, v) => { const el = document.getElementById(id); if (el && el.textContent !== String(v)) el.textContent = v; };
        setText('spReadyCount', ready);
        setText('spOwnedText', `${owned} / ${total} owned`);
        const bar = document.getElementById('spOwnedBar');
        if (bar) bar.style.width = (owned / total * 100) + '%';
        document.querySelectorAll('[data-spf]').forEach(b => b.classList.toggle('active', b.dataset.spf === filter));
        const buyAll = document.getElementById('spBuyAll');
        if (buyAll) { buyAll.disabled = ready === 0; buyAll.textContent = ready ? `Buy all (${ready})` : 'Buy all'; }
        if (tipFor) renderTip();
    }

    window.SPECIAL_UPGRADES = SPECIALS;
    // plain data for the first-run guide: each special, the upgrade it belongs to, the level that unlocks it, and whether it is owned
    window.specialsSnapshot = () => SPECIALS.map(sp => ({ name: sp.name, upgrade: sp.group.up, upgradeName: sp.group.name, level: sp.lvl, owned: isOwned(sp) }));
    window.updateSpecialsMenu = updateSpecialsMenu;
    window.hideSpecialTip = () => hideTip(true);
})();
